/**
 * Minimal Jellyfin API client (native API, not Subsonic-compatible).
 *
 * Session-based authentication: on login (`makeAuth`),
 * `/Users/AuthenticateByName` is called and the token and user id are saved in
 * the profile (`jfToken`/`jfUserId`); each request carries the
 * `Authorization: MediaBrowser ... Token="..."` header. URLs consumed by
 * native views (cover art, streaming) cannot carry headers, so they use the
 * `api_key` parameter.
 *
 * The exported functions mirror the signatures of `subsonic.ts`; the
 * `backend.ts` module picks one implementation or the other based on server
 * type.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

import {
  CLIENT_NAME,
  normalizeUrl,
  SubsonicRequestError,
  type Album,
  type AlbumListType,
  type Artist,
  type ArtistInfo,
  type Genre,
  type GuestAlbum,
  type MusicFolder,
  type PlaybackState,
  type Playlist,
  type RadioStation,
  type SavedQueue,
  type ScanStatus,
  type SearchResult,
  type Song,
  type SongListSort,
  type SongLyrics,
  type SortDirection,
  type Starred,
  type StarType,
  type SubsonicAuth,
} from './subsonic';
// Not the global `fetch`: it never resolves in the background. See the note
// in `src/api/subsonic.ts`.
import { fetch } from 'expo/fetch';
import { assertCanRequest } from './netGate';

const CLIENT_VERSION = Constants.expoConfig?.version ?? '0.0.0';
/**
 * The phone's model (`Build.MODEL` on Android), which is what the server's
 * dashboard lists this session under.
 *
 * Percent-encoded because Jellyfin decodes every value of the authorization
 * header (`WebUtility.UrlDecode` in `AuthorizationContext.GetParts`, and it
 * has done since 10.8), so encoding it here is what makes a name with a space
 * or a `+` in it arrive whole. It also keeps the header ASCII, which is not
 * optional: the request goes out through OkHttp, which throws on any byte
 * outside 0x20..0x7e in a header value, and this header rides on every
 * request. A model with an accent or a CJK character in it would take the
 * whole account down with it, not just the name on the dashboard.
 */
const CLIENT_DEVICE = encodeURIComponent(Constants.deviceName?.trim() || 'Android');
const REQUEST_TIMEOUT_MS = 15000;

/** A Jellyfin tick is 100 ns; API times come in ticks. */
const TICKS_PER_SECOND = 10_000_000;
const TICKS_PER_MS = 10_000;

/** Extra fields that must be requested explicitly for each item type. */
const ALBUM_FIELDS = 'ChildCount,DateCreated,Genres';
const SONG_FIELDS = 'MediaSources,DateCreated,NormalizationGain,Genres';
const PLAYLIST_FIELDS = 'ChildCount,DateCreated,DateLastMediaAdded';
/**
 * How many albums an artist or a genre has. Jellyfin does not put counts on an
 * item unless they are asked for, and an artist row that says "0 albums" is
 * what happens when nobody asks (#129). It is one field on a request that is
 * already being made, not a request per name.
 */
const ITEM_COUNTS = 'ItemCounts';

/** Subset of BaseItemDto that the app uses. */
interface JfItem {
  Id: string;
  Name?: string;
  Overview?: string;
  Album?: string;
  AlbumId?: string;
  AlbumArtist?: string;
  AlbumArtists?: { Id: string; Name?: string }[];
  Artists?: string[];
  ArtistItems?: { Id: string; Name?: string }[];
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  ChildCount?: number;
  /** Present only when `ItemCounts` is among the requested fields. */
  AlbumCount?: number;
  SongCount?: number;
  DateCreated?: string;
  DateLastMediaAdded?: string;
  ParentId?: string;
  ParentIds?: string[];
  Genres?: string[];
  ImageTags?: { Primary?: string };
  AlbumPrimaryImageTag?: string;
  UserData?: { IsFavorite?: boolean; LastPlayedDate?: string; PlayCount?: number };
  /** Normalization gain in dB (server LUFS analysis, 10.9+). */
  NormalizationGain?: number;
  /**
   * Live-TV playback sources, present when a channel is opened as playback
   * (`AutoOpenLiveStream`). Each is how the server wants this client to take it.
   * Only used for Live-TV; the rest of the library never carries them.
   */
  MediaSources?: {
    /** This source's id, which the transcoded URL carries back to the player. */
    Id?: string;
    /**
     * The URL of the source itself: a stored device stream, or an external one
     * (HLS on the cloud). A direct-play source, which nothing here rewrites.
     */
    Path?: string;
    /**
     * The URL the server built for the client's playback. This is the URL to
     * play when it exists: it carries the stream id, the session and the codecs,
     * which is why a client guesses nothing about them and takes it whole.
     */
    TranscodingUrl?: string;
    /** An infinite (radio-style) stream: a live feed that never ends. */
    IsInfiniteStream?: boolean;
    /** True if the server wants a live stream opened for this source. */
    RequiresOpening?: boolean;
    /** True if the server wants it closed once done. */
    RequiresClosing?: boolean;
    Container?: string;
    LiveStreamId?: string;
    MediaStreams?: { Type?: string; BitDepth?: number; SampleRate?: number }[];
    /** The server built this stream: prefer it over a direct source. */
    SupportsTranscoding?: boolean;
    /** Can the client play the source as-is, without the server rewriting it? */
    SupportsDirectPlay?: boolean;
    /** Can the client stream the source's data, whether or not the client can play it? */
    SupportsDirectStream?: boolean;
    /** The server built a transcode: this is a transcoded stream, prefer it. */
    SupportsTranscode?: boolean;
    /** The bitrate in kbps for the transcode, when the server gives one. */
    Bitrate?: number;
  }[];
}

interface JfItems {
  Items?: JfItem[];
}

interface JfPlaybackInfo {
  ItemId: string;
  PositionTicks: number;
  IsPaused?: boolean;
  IsMuted?: boolean;
  CanSeek?: boolean;
  PlayMethod?: 'Transcode' | 'DirectStream' | 'DirectPlay';
  PlaySessionId?: string;
  /**
   * The source the client receives from opening the stream. Present when
   * `AutoOpenLiveStream` opens a live stream, and each item is one the server
   * tells the client to stream.
   */
  MediaSources?: JfItem['MediaSources'];
}

/** Per track/session bookkeeping for Jellyfin playback state events. */
let activePlaySessionId: string | null = null;
let activePlayItemId: string | null = null;
let activePlayStarted = false;

function resetPlaybackSession(): void {
  activePlayStarted = false;
  activePlayItemId = null;
  activePlaySessionId = null;
}

interface JfClientCapabilities {
  PlayableMediaTypes: ('Audio' | 'Video' | 'Book' | 'Photo')[];
  SupportsMediaControl: boolean;
  SupportsPersistentIdentifier: boolean;
  SupportedCommands: string[];
}

const CLIENT_CAPABILITIES: JfClientCapabilities = {
  PlayableMediaTypes: ['Audio'],
  SupportsMediaControl: true,
  SupportsPersistentIdentifier: true,
  SupportedCommands: ['Play', 'Pause', 'Stop', 'Seek', 'NextTrack', 'PreviousTrack'],
};

function randomHex(bytes: number): string {
  return Array.from(Crypto.getRandomBytes(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function authHeader(auth: SubsonicAuth): string {
  return (
    `MediaBrowser Client="${CLIENT_NAME}", Device="${CLIENT_DEVICE}", ` +
    `DeviceId="${auth.jfDeviceId}", Version="${CLIENT_VERSION}", Token="${auth.jfToken}"`
  );
}

type Params = Record<string, string | number | boolean | undefined>;

function buildUrl(auth: SubsonicAuth, path: string, params: Params = {}): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) q.set(key, String(value));
  }
  const qs = q.toString();
  return `${auth.serverUrl}${path}${qs ? `?${qs}` : ''}`;
}

/** Authenticated request; returns the JSON (or undefined if no body). */
async function request<T>(
  auth: SubsonicAuth,
  path: string,
  params: Params = {},
  init: { method?: string; body?: unknown } = {},
  allowOffline = false,
): Promise<T> {
  // Offline mode stops here, before the socket (see netGate).
  assertCanRequest(allowOffline);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(buildUrl(auth, path, params), {
      method: init.method ?? 'GET',
      headers: {
        Authorization: authHeader(auth),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new SubsonicRequestError('El servidor tardó demasiado en responder', true);
    }
    throw new SubsonicRequestError('No se pudo conectar con el servidor', true);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    throw new SubsonicRequestError('Sesión caducada: vuelve a iniciar sesión', false);
  }
  if (!res.ok) throw new SubsonicRequestError(`Error de red (${res.status})`, false, res.status);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Logs in against `/Users/AuthenticateByName` and builds the profile.
 * The device id is generated here and kept in the profile (Jellyfin
 * associates the session with that id).
 */
export async function makeAuth(
  serverUrl: string,
  username: string,
  password: string,
): Promise<SubsonicAuth> {
  const url = normalizeUrl(serverUrl);
  const deviceId = randomHex(16);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${url}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `MediaBrowser Client="${CLIENT_NAME}", Device="${CLIENT_DEVICE}", ` +
          `DeviceId="${deviceId}", Version="${CLIENT_VERSION}"`,
      },
      body: JSON.stringify({ Username: username, Pw: password }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error('El servidor tardó demasiado en responder');
    }
    throw new Error('No se pudo conectar con el servidor');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) throw new Error('Usuario o contraseña incorrectos');
  if (!res.ok) throw new Error(`Error de red (${res.status})`);
  const data = (await res.json()) as { AccessToken?: string; User?: { Id?: string } };
  if (!data.AccessToken || !data.User?.Id) {
    throw new Error('Respuesta inesperada del servidor');
  }
  return {
    serverUrl: url,
    username,
    token: '',
    salt: '',
    serverType: 'jellyfin',
    jfToken: data.AccessToken,
    jfUserId: data.User.Id,
    jfDeviceId: deviceId,
  };
}

/**
 * Checks that the session token is still valid.
 *
 * The one question allowed while offline: it is how the app learns the server is
 * back, and what the "test" button in Settings asks.
 */
export async function ping(auth: SubsonicAuth): Promise<void> {
  await request(auth, '/Users/Me', {}, {}, true);
  /**
   * Lets Jellyfin keep this device's session metadata up to date, and not
   * waited for on purpose.
   *
   * What this function answers is whether the server is there, and `reachable`
   * asks it against a four second clock covering everything it does. Awaited,
   * a server that answers the question perfectly well but is slow to take this
   * would come back as unreachable — at login, at a profile switch and on the
   * test button, and once per candidate URL, since that is where reachability
   * is decided between several. It is best effort in the first place: nothing
   * downstream reads it and a failure is already swallowed.
   */
  void request(auth, '/Sessions/Capabilities/Full', {}, {
    method: 'POST',
    body: CLIENT_CAPABILITIES,
  }).catch(() => {});
}

// ── Mapping BaseItemDto to app models ──

/**
 * Our model marks favorites with the date they were set; Jellyfin does not
 * expose it, so the item's creation date is used as an approximation.
 */
function favDate(it: JfItem): string | undefined {
  return it.UserData?.IsFavorite ? (it.DateCreated ?? '1970-01-01T00:00:00.000Z') : undefined;
}

function toSong(it: JfItem): Song {
  const src = it.MediaSources?.[0];
  const audio = src?.MediaStreams?.find((s) => s.Type === 'Audio');
  return {
    id: it.Id,
    title: it.Name ?? '',
    album: it.Album,
    artist: it.Artists?.length ? it.Artists.join(', ') : it.AlbumArtist,
    albumId: it.AlbumId,
    artistId: it.ArtistItems?.[0]?.Id ?? it.AlbumArtists?.[0]?.Id,
    artists: (it.ArtistItems ?? it.AlbumArtists)?.map((a) => ({ id: a.Id, name: a.Name ?? '' })),
    // A song's cover art is usually its album's; its own only if
    // the file has embedded art.
    coverArt:
      it.AlbumPrimaryImageTag && it.AlbumId
        ? it.AlbumId
        : it.ImageTags?.Primary
          ? it.Id
          : undefined,
    genre: it.Genres?.[0],
    // The rest of them too: `genre` is the one slot Subsonic has, and dropping
    // the others here left "Song information" and the album's chips showing a
    // single tag for a track that carries several (#104).
    genres: it.Genres?.map((name) => ({ name })),
    duration: it.RunTimeTicks ? Math.round(it.RunTimeTicks / TICKS_PER_SECOND) : undefined,
    track: it.IndexNumber,
    discNumber: it.ParentIndexNumber,
    starred: favDate(it),
    suffix: src?.Container,
    bitRate: src?.Bitrate ? Math.round(src.Bitrate / 1000) : undefined,
    bitDepth: audio?.BitDepth,
    samplingRate: audio?.SampleRate,
    year: it.ProductionYear,
    // Jellyfin does not expose per-track/per-album ReplayGain; its
    // NormalizationGain (LUFS) serves the same role as track gain.
    replayGain:
      typeof it.NormalizationGain === 'number'
        ? { trackGain: it.NormalizationGain }
        : undefined,
  };
}

function toAlbum(it: JfItem): Album {
  return {
    id: it.Id,
    name: it.Name ?? '',
    artist: it.AlbumArtist ?? it.Artists?.join(', '),
    artistId: it.AlbumArtists?.[0]?.Id,
    artists: it.AlbumArtists?.map((a) => ({ id: a.Id, name: a.Name ?? '' })),
    coverArt: it.ImageTags?.Primary ? it.Id : undefined,
    songCount: it.ChildCount,
    year: it.ProductionYear,
    starred: favDate(it),
    created: it.DateCreated,
    played: it.UserData?.LastPlayedDate,
    playCount: it.UserData?.PlayCount,
    genres: it.Genres?.map((name) => ({ name })),
  };
}

function toArtist(it: JfItem): Artist {
  return {
    id: it.Id,
    name: it.Name ?? '',
    coverArt: it.ImageTags?.Primary ? it.Id : undefined,
    starred: favDate(it),
    // Absent unless the request asked for `ItemCounts`, and left undefined
    // rather than zero when it is: the row reads "0 albums" either way, but a
    // count nobody asked for is not the same as an artist with nothing.
    albumCount: it.AlbumCount,
  };
}

function toPlaylist(it: JfItem): Playlist {
  return {
    id: it.Id,
    name: it.Name ?? '',
    // What Subsonic calls the playlist's comment. Jellyfin lets it be written
    // with markup, and the header is one plain line: the same stripping the
    // artist biography already gets.
    comment: it.Overview?.replace(/<[^>]+>/g, '').trim() || undefined,
    songCount: it.ChildCount,
    coverArt: it.ImageTags?.Primary ? it.Id : undefined,
    created: it.DateCreated,
    changed: it.DateLastMediaAdded,
  };
}

// ── Catalog ──

const ALBUM_SORT: Record<AlbumListType, { SortBy: string; SortOrder?: string; Filters?: string }> =
  {
    newest: { SortBy: 'DateCreated', SortOrder: 'Descending' },
    recent: { SortBy: 'DatePlayed', SortOrder: 'Descending' },
    frequent: { SortBy: 'PlayCount', SortOrder: 'Descending' },
    random: { SortBy: 'Random' },
    // The release date, which Jellyfin keeps whole and Subsonic only has the
    // year of. `ProductionYear` catches an album tagged with a year and no day.
    byYear: { SortBy: 'PremiereDate,ProductionYear,SortName', SortOrder: 'Descending' },
    alphabeticalByName: { SortBy: 'SortName' },
    alphabeticalByArtist: { SortBy: 'AlbumArtist,SortName' },
    starred: { SortBy: 'SortName', Filters: 'IsFavorite' },
  };

/** Jellyfin has its own libraries, but folder filtering is Subsonic. */
export async function getMusicFolders(_auth: SubsonicAuth): Promise<MusicFolder[]> {
  return [];
}

export async function getAlbumList(
  auth: SubsonicAuth,
  type: AlbumListType = 'newest',
  size = 20,
  offset = 0,
  _musicFolderId?: string,
): Promise<Album[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    Limit: size,
    StartIndex: offset,
    Fields: ALBUM_FIELDS,
    ...ALBUM_SORT[type],
  });
  return (res.Items ?? []).map(toAlbum);
}

export async function getGenres(auth: SubsonicAuth): Promise<Genre[]> {
  const res = await request<JfItems>(auth, '/MusicGenres', {
    UserId: auth.jfUserId,
    SortBy: 'SortName',
    // How many albums a genre has, which the card shows under its name.
    // Jellyfin only counts when asked, the same as it does for artists.
    Fields: ITEM_COUNTS,
  });
  return (res.Items ?? [])
    .map((it) => ({ value: it.Name ?? '', albumCount: it.AlbumCount, songCount: it.SongCount }))
    .filter((g) => g.value);
}

export async function getAlbumsByGenre(
  auth: SubsonicAuth,
  genre: string,
  size = 30,
  offset = 0,
  _musicFolderId?: string,
  sort: AlbumListType = 'alphabeticalByName',
  dir?: SortDirection,
): Promise<Album[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    Genres: genre,
    Limit: size,
    StartIndex: offset,
    Fields: ALBUM_FIELDS,
    ...ALBUM_SORT[sort],
    ...(dir ? { SortOrder: dir === 'asc' ? 'Ascending' : 'Descending' } : {}),
  });
  return (res.Items ?? []).map(toAlbum);
}

/** Songs tagged with a genre (Jellyfin filters items by genre directly). */
const SONG_SORT: Record<SongListSort, { SortBy: string; SortOrder?: string }> = {
  // Jellyfin has no "the order they are in" to speak of, so its own idea of
  // order is the alphabet. It never offers this one anyway (see backend.ts).
  server: { SortBy: 'SortName' },
  recent: { SortBy: 'DatePlayed', SortOrder: 'Descending' },
  alpha: { SortBy: 'SortName' },
  added: { SortBy: 'DateCreated', SortOrder: 'Descending' },
  frequent: { SortBy: 'PlayCount', SortOrder: 'Descending' },
  random: { SortBy: 'Random' },
};

/** The library's songs, a page at a time and in the order asked for. */
export async function getSongList(
  auth: SubsonicAuth,
  sort: SongListSort = 'alpha',
  count = 50,
  offset = 0,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Limit: count,
    StartIndex: offset,
    Fields: SONG_FIELDS,
    ...SONG_SORT[sort],
  });
  return (res.Items ?? []).map(toSong);
}

/**
 * The songs of a genre, record by record unless asked otherwise.
 *
 * `Album,ParentIndexNumber,IndexNumber` is album, then disc, then track: the
 * useful way through a heap of songs off dozens of records, and what the app
 * asks of every backend that can answer it. Anything else the caller names is
 * one of the orders this server already knows for songs.
 */
export async function getSongsByGenre(
  auth: SubsonicAuth,
  genre: string,
  count = 50,
  offset = 0,
  _musicFolderId?: string,
  sort: SongListSort = 'server',
  dir?: SortDirection,
): Promise<Song[]> {
  const base =
    sort === 'server' ? { SortBy: 'Album,ParentIndexNumber,IndexNumber' } : SONG_SORT[sort];
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Genres: genre,
    Limit: count,
    StartIndex: offset,
    Fields: SONG_FIELDS,
    ...base,
    // Whatever the order reads as by default, the menu can turn it round.
    ...(dir ? { SortOrder: dir === 'asc' ? 'Ascending' : 'Descending' } : {}),
  });
  return (res.Items ?? []).map(toSong);
}

export async function getAlbum(
  auth: SubsonicAuth,
  id: string,
): Promise<{ album: Album; songs: Song[] }> {
  const [item, children] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      ParentId: id,
      IncludeItemTypes: 'Audio',
      SortBy: 'ParentIndexNumber,IndexNumber,SortName',
      Fields: SONG_FIELDS,
    }),
  ]);
  return { album: toAlbum(item), songs: (children.Items ?? []).map(toSong) };
}

export async function getArtists(auth: SubsonicAuth, _musicFolderId?: string): Promise<Artist[]> {
  const res = await request<JfItems>(auth, '/Artists/AlbumArtists', {
    UserId: auth.jfUserId,
    SortBy: 'SortName',
    Fields: ITEM_COUNTS,
  });
  return (res.Items ?? []).map(toArtist);
}

export async function getArtist(
  auth: SubsonicAuth,
  id: string,
): Promise<{ artist: Artist; albums: Album[] }> {
  const [item, albums] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
      AlbumArtistIds: id,
      SortBy: 'ProductionYear,SortName',
      SortOrder: 'Descending',
      Fields: ALBUM_FIELDS,
    }),
  ]);
  // The albums have just been fetched, so the count is known exactly here and
  // does not depend on the server having filled `ItemCounts` in.
  const own = (albums.Items ?? []).map(toAlbum);
  return { artist: { ...toArtist(item), albumCount: own.length }, albums: own };
}

/** Albums where the artist collaborates without being the album artist ("Appears on"). */
export async function getAppearsOn(
  auth: SubsonicAuth,
  artistId: string,
  _artistName: string,
  _musicFolderId?: string,
): Promise<GuestAlbum[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    ContributingArtistIds: artistId,
    SortBy: 'ProductionYear,SortName',
    SortOrder: 'Descending',
    Fields: ALBUM_FIELDS,
  });
  // Jellyfin answers this directly, so there is nothing to second-guess.
  return (res.Items ?? []).map((i) => ({ ...toAlbum(i), confirmed: true }));
}

export async function getArtistInfo(auth: SubsonicAuth, id: string): Promise<ArtistInfo> {
  const [item, similar] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Items/${id}/Similar`, {
      UserId: auth.jfUserId,
      Limit: 12,
      Fields: ITEM_COUNTS,
    }).catch(() => ({ Items: [] }) as JfItems),
  ]);
  return {
    biography: item.Overview?.replace(/<[^>]+>/g, '').trim() || undefined,
    imageUrl: item.ImageTags?.Primary ? coverArtUrl(auth, item.Id, 600) : undefined,
    similarArtists: (similar.Items ?? []).map(toArtist),
  };
}

/** Most played songs by an artist (Jellyfin filters by name). */
export async function getTopSongs(
  auth: SubsonicAuth,
  artist: string,
  count = 10,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Artists: artist,
    SortBy: 'PlayCount,SortName',
    SortOrder: 'Descending',
    Limit: count,
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

/** Most listened songs (Jellyfin sorts by PlayCount directly). */
export async function getMostPlayedSongs(
  auth: SubsonicAuth,
  size = 50,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Filters: 'IsPlayed',
    SortBy: 'PlayCount,SortName',
    SortOrder: 'Descending',
    Limit: size,
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

/** Random songs from the entire library (the Home mix). */
export async function getRandomSongs(
  auth: SubsonicAuth,
  size = 200,
  genre?: string,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    SortBy: 'Random',
    Limit: size,
    ...(genre ? { Genres: genre } : {}),
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

/** Songs similar to a given one via Instant Mix (autoplay / radio). */
export async function getSimilarSongs(
  auth: SubsonicAuth,
  id: string,
  count = 20,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Songs/${id}/InstantMix`, {
    UserId: auth.jfUserId,
    Limit: count + 1,
    Fields: SONG_FIELDS,
  });
  // The mix includes the seed song; Subsonic does not return it.
  return (res.Items ?? []).filter((it) => it.Id !== id).slice(0, count).map(toSong);
}

/** Album-only search: one request, not the three of `search`. */
export async function searchAlbums(
  auth: SubsonicAuth,
  query: string,
  count = 50,
  _musicFolderId?: string,
): Promise<Album[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    SearchTerm: query,
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    Limit: count,
    Fields: ALBUM_FIELDS,
  });
  return (res.Items ?? []).map(toAlbum);
}

export async function searchSongs(
  auth: SubsonicAuth,
  query: string,
  count = 50,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    SearchTerm: query,
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Limit: count,
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

export async function search(
  auth: SubsonicAuth,
  query: string,
  _musicFolderId?: string,
): Promise<SearchResult> {
  const items = (kind: 'MusicAlbum' | 'Audio') =>
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      SearchTerm: query,
      IncludeItemTypes: kind,
      Recursive: true,
      Limit: 20,
      Fields: kind === 'Audio' ? SONG_FIELDS : ALBUM_FIELDS,
    });
  const [artists, albums, songs] = await Promise.all([
    request<JfItems>(auth, '/Artists', {
      UserId: auth.jfUserId,
      SearchTerm: query,
      Limit: 20,
      Fields: ITEM_COUNTS,
    }),
    items('MusicAlbum'),
    items('Audio'),
  ]);
  return {
    artists: (artists.Items ?? []).map(toArtist),
    albums: (albums.Items ?? []).map(toAlbum),
    songs: (songs.Items ?? []).map(toSong),
  };
}

// ── Favorites ──

export async function getStarred(auth: SubsonicAuth, _musicFolderId?: string): Promise<Starred> {
  const fav = (kind: 'MusicAlbum' | 'Audio') =>
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      Filters: 'IsFavorite',
      IncludeItemTypes: kind,
      Recursive: true,
      Fields: kind === 'Audio' ? SONG_FIELDS : ALBUM_FIELDS,
    });
  const [songs, albums, artists] = await Promise.all([
    fav('Audio'),
    fav('MusicAlbum'),
    request<JfItems>(auth, '/Artists', {
      UserId: auth.jfUserId,
      IsFavorite: true,
      Fields: ITEM_COUNTS,
    }),
  ]);
  return {
    songs: (songs.Items ?? []).map(toSong),
    albums: (albums.Items ?? []).map(toAlbum),
    artists: (artists.Items ?? []).map(toArtist),
  };
}

/** In Jellyfin, favorites are per item, without distinguishing type. */
export async function star(auth: SubsonicAuth, id: string, _type: StarType = 'song'): Promise<void> {
  await request(auth, `/Users/${auth.jfUserId}/FavoriteItems/${id}`, {}, { method: 'POST' });
}

export async function unstar(
  auth: SubsonicAuth,
  id: string,
  _type: StarType = 'song',
): Promise<void> {
  await request(auth, `/Users/${auth.jfUserId}/FavoriteItems/${id}`, {}, { method: 'DELETE' });
}

/**
 * Jellyfin does not expose Subsonic's 1-5 star rating (only a
 * like/dislike). The rating bar is hidden for these profiles, so this is a
 * no-op and should never be called.
 */
export function setRating(_auth: SubsonicAuth, _id: string, _rating: number): Promise<void> {
  return Promise.resolve();
}

// ── Playlists ──

export async function getPlaylists(auth: SubsonicAuth): Promise<Playlist[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Playlist',
    Recursive: true,
    SortBy: 'SortName',
    Fields: PLAYLIST_FIELDS,
  });
  return (res.Items ?? []).map(toPlaylist);
}

export async function getPlaylist(
  auth: SubsonicAuth,
  id: string,
): Promise<{ playlist: Playlist; songs: Song[] }> {
  const [item, children] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Playlists/${id}/Items`, {
      UserId: auth.jfUserId,
      Fields: SONG_FIELDS,
    }),
  ]);
  return { playlist: toPlaylist(item), songs: (children.Items ?? []).map(toSong) };
}

export async function addToPlaylist(
  auth: SubsonicAuth,
  playlistId: string,
  songId: string,
): Promise<void> {
  await request(
    auth,
    `/Playlists/${playlistId}/Items`,
    { Ids: songId, UserId: auth.jfUserId },
    { method: 'POST' },
  );
}

export async function createPlaylist(auth: SubsonicAuth, name: string): Promise<string> {
  const res = await request<{ Id?: string }>(
    auth,
    '/Playlists',
    {},
    { method: 'POST', body: { Name: name, UserId: auth.jfUserId, MediaType: 'Audio' } },
  );
  if (!res?.Id) throw new Error('No se encontró la playlist creada');
  return res.Id;
}

export async function deletePlaylist(auth: SubsonicAuth, id: string): Promise<void> {
  await request(auth, `/Items/${id}`, {}, { method: 'DELETE' });
}

/** Renames the playlist (Jellyfin 10.9+; no description field). */
export async function updatePlaylist(
  auth: SubsonicAuth,
  id: string,
  changes: { name?: string; comment?: string; public?: boolean },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (changes.name !== undefined) body.Name = changes.name;
  if (changes.public !== undefined) body.IsPublic = changes.public;
  if (Object.keys(body).length === 0) return;
  await request(auth, `/Playlists/${id}`, {}, { method: 'POST', body });
}

/** How many ids fit in one URL comfortably (they go as a query parameter). */
const IDS_PER_REQUEST = 100;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * The playlist's entries in order. A playlist doesn't hold songs but entries,
 * and it is the entry's `PlaylistItemId` that removing and moving take, never
 * the song's id. What that id is made of changed in Jellyfin 10.10 (it used to
 * be the entry's own, it is now the song's), so it is always read back from the
 * server rather than built here. One consequence, from 10.10 on: a song sitting
 * twice in the same playlist has the same id in both places, and the server
 * can't tell the copies apart.
 */
async function playlistEntries(
  auth: SubsonicAuth,
  id: string,
): Promise<{ entryId: string; songId: string }[]> {
  const res = await request<{ Items?: { Id?: string; PlaylistItemId?: string }[] }>(
    auth,
    `/Playlists/${id}/Items`,
    { UserId: auth.jfUserId },
  );
  return (res.Items ?? []).flatMap((it) =>
    it.Id && it.PlaylistItemId ? [{ entryId: it.PlaylistItemId, songId: it.Id }] : [],
  );
}

/** Removes a song by position: its entry id must be resolved first. */
export async function removeFromPlaylist(
  auth: SubsonicAuth,
  id: string,
  index: number,
): Promise<void> {
  const entryId = (await playlistEntries(auth, id))[index]?.entryId;
  if (!entryId) throw new Error('No se encontró la canción en la lista');
  await request(auth, `/Playlists/${id}/Items`, { EntryIds: entryId }, { method: 'DELETE' });
}

/**
 * Leaves the playlist holding exactly `songIds`, in that order. Subsonic does
 * this in one call by rewriting the list; Jellyfin has no such call, so it's
 * three steps over the entries: drop the ones no longer wanted, append the ones
 * that weren't there, and move the rest into place. Removing a song from a
 * playlist arrives here too (the list minus that one), which is why it has to
 * work with no reordering left to do.
 */
export async function reorderPlaylist(
  auth: SubsonicAuth,
  id: string,
  songIds: string[],
): Promise<void> {
  // Which entry to use for each requested song: a song asked for twice takes a
  // different copy each time it comes up.
  const pick = (entries: { entryId: string; songId: string }[]) => {
    const pool = new Map<string, string[]>();
    for (const e of entries) {
      const copies = pool.get(e.songId);
      if (copies) copies.push(e.entryId);
      else pool.set(e.songId, [e.entryId]);
    }
    const wanted: string[] = [];
    const missing: string[] = [];
    for (const songId of songIds) {
      const entryId = pool.get(songId)?.shift();
      if (entryId) wanted.push(entryId);
      else missing.push(songId);
    }
    return { wanted, missing };
  };

  let entries = await playlistEntries(auth, id);
  let { wanted, missing } = pick(entries);

  // Counted rather than matched by id: with a song repeated in the playlist the
  // copies share an id, and what says one of them is leaving is that the list
  // asks for fewer than there are.
  const room = new Map<string, number>();
  for (const entryId of wanted) room.set(entryId, (room.get(entryId) ?? 0) + 1);
  const seen = new Map<string, number>();
  const drop: string[] = [];
  for (const e of entries) {
    const nth = (seen.get(e.entryId) ?? 0) + 1;
    seen.set(e.entryId, nth);
    if (nth > (room.get(e.entryId) ?? 0)) drop.push(e.entryId);
  }
  // The server takes every copy with it when their ids match, so what should
  // have stayed is read back and put in again below.
  const takesCopiesWithIt = drop.some((entryId) => room.has(entryId));

  // Both lists travel in the URL, so they go in batches: a long playlist would
  // otherwise build a request line the server refuses to read.
  for (const batch of chunks([...new Set(drop)], IDS_PER_REQUEST)) {
    await request(
      auth,
      `/Playlists/${id}/Items`,
      { EntryIds: batch.join(',') },
      { method: 'DELETE' },
    );
  }
  if (takesCopiesWithIt) {
    entries = await playlistEntries(auth, id);
    ({ wanted, missing } = pick(entries));
  }
  if (missing.length > 0) {
    for (const batch of chunks(missing, IDS_PER_REQUEST)) {
      await request(
        auth,
        `/Playlists/${id}/Items`,
        { Ids: batch.join(','), UserId: auth.jfUserId },
        { method: 'POST' },
      );
    }
    // The appended entries get their id on the server, so the list has to be
    // read again before anything can be moved.
    entries = await playlistEntries(auth, id);
    ({ wanted } = pick(entries));
  }

  // What the server has now, kept in step with each move so the list is only
  // touched where it actually differs (removing a song needs no move at all).
  const want = new Set(wanted);
  let current = entries.filter((e) => want.has(e.entryId)).map((e) => e.entryId);
  for (let i = 0; i < wanted.length; i++) {
    const entryId = wanted[i];
    if (current[i] === entryId) continue;
    // Looked for from here on: what is already in place stays where it is.
    const from = current.indexOf(entryId, i);
    if (from < 0) continue;
    await request(auth, `/Playlists/${id}/Items/${entryId}/Move/${i}`, {}, { method: 'POST' });
    current.splice(from, 1);
    current.splice(i, 0, entryId);
  }
}

// ── Server library ──

interface JfTask {
  Key?: string;
  State?: string;
}

export async function getScanStatus(auth: SubsonicAuth): Promise<ScanStatus> {
  const tasks = await request<JfTask[]>(auth, '/ScheduledTasks');
  const refresh = tasks.find((t) => t.Key === 'RefreshLibrary');
  return { scanning: refresh?.State === 'Running', count: 0 };
}

export async function startScan(auth: SubsonicAuth): Promise<ScanStatus> {
  await request(auth, '/Library/Refresh', {}, { method: 'POST' });
  return { scanning: true, count: 0 };
}

// ── Lyrics ──

/** Jellyfin has no lyrics search by artist+title. */
export async function getLyrics(
  _auth: SubsonicAuth,
  _artist: string,
  _title: string,
): Promise<string> {
  return '';
}

/** Item lyrics (`/Audio/{id}/Lyrics`, 10.9+); times in ticks. */
export async function getLyricsBySongId(
  auth: SubsonicAuth,
  id: string,
): Promise<SongLyrics | null> {
  let res: { Lyrics?: { Text?: string; Start?: number }[] };
  try {
    res = await request(auth, `/Audio/${id}/Lyrics`);
  } catch {
    return null; // 404 if the song has no lyrics (or server < 10.9)
  }
  const lines = res?.Lyrics ?? [];
  if (lines.length === 0) return null;
  const synced = lines.some((l) => l.Start !== undefined);
  return {
    synced,
    lines: lines.map((l) => ({
      value: l.Text ?? '',
      ...(synced && l.Start !== undefined ? { start: Math.round(l.Start / TICKS_PER_MS) } : {}),
    })),
  };
}

// ── No Jellyfin equivalent ──

/** Jellyfin does not save the queue on the server; the device copy remains. */
export async function savePlayQueue(
  _auth: SubsonicAuth,
  _ids: string[],
  _currentId: string,
  _positionMs: number,
): Promise<void> {}

export async function getPlayQueue(_auth: SubsonicAuth): Promise<SavedQueue | null> {
  return null;
}

/**
 * Jellyfin's radio: its Live-TV channels. Every channel is listed — the player
 * turns a channel into an audio stream per station later, so for now the
 * station is display-only and carries no stream URL yet.
 */
export async function getRadioStations(auth: SubsonicAuth): Promise<RadioStation[]> {
  // `Limit` high enough for every channel: the server default (100) would cut
  // the list and hide the rest.
  const res = await request<JfChannels>(auth, '/LiveTv/Channels', { limit: 10_000 });
  return (res?.Items ?? []).map((c): RadioStation => ({
    id: c.Id,
    name: c.Name ?? '',
    streamUrl: '',
    coverArt: c.ImageTags?.Primary ? c.Id : undefined,
  }));
}

/**
 * A channel list: the feed the radio tab shows, before any of it is playable.
 */
interface JfChannels {
  Items?: JfItem[];
}

/** Jellyfin does not support managing radio stations. */
export async function createRadioStation(
  _auth: SubsonicAuth,
  _name: string,
  _streamUrl: string,
  _homePageUrl?: string,
): Promise<string | undefined> {
  throw new Error('Jellyfin no soporta emisoras de radio');
}

export async function updateRadioStation(
  _auth: SubsonicAuth,
  _id: string,
  _name: string,
  _streamUrl: string,
  _homePageUrl?: string,
): Promise<void> {
  throw new Error('Jellyfin no soporta emisoras de radio');
}

export async function deleteRadioStation(_auth: SubsonicAuth, _id: string): Promise<void> {
  throw new Error('Jellyfin no soporta emisoras de radio');
}

// ── Playback ──

/** Marks the song as played (updates counter and date). Errors are let through,
 *  the same as the Subsonic one and for the same reason (#126). */
export async function scrobble(auth: SubsonicAuth, id: string, submission = true): Promise<void> {
  // Jellyfin has no cheap "now playing" (requires full playback
  // sessions); only actual playback is marked.
  if (!submission) return;
  await markPlayed(auth, id);
}

/**
 * A listen that already happened, dated (see the Subsonic one). Errors are let
 * through so the outbox can keep what didn't arrive, with one exception: if the
 * server takes the play but not the date, it is sent again undated. A play at
 * the wrong time is worth more than one stuck in the queue for good.
 */
export async function submitPlay(auth: SubsonicAuth, id: string, at: number): Promise<void> {
  try {
    await markPlayed(auth, id, new Date(at).toISOString());
  } catch (e) {
    // Only worth a second try if the server answered at all: with no network
    // the undated one has nowhere to go either.
    if (e instanceof SubsonicRequestError && e.network) throw e;
    await markPlayed(auth, id);
  }
}

async function markPlayed(auth: SubsonicAuth, id: string, datePlayed?: string): Promise<void> {
  const params = { userId: auth.jfUserId, ...(datePlayed ? { datePlayed } : {}) };
  try {
    await request(auth, `/UserPlayedItems/${id}`, params, { method: 'POST' });
    return;
  } catch (e) {
    // Compatibility fallback: some deployments still expose only this legacy
    // route. Retry only when the modern one is unsupported.
    if (!(e instanceof SubsonicRequestError)) throw e;
    if (e.network) throw e;
    if (e.code !== 400 && e.code !== 404) throw e;
  }
  await request(auth, `/Users/${auth.jfUserId}/PlayedItems/${id}`, params, { method: 'POST' });
}

function positionTicks(positionSec: number): number {
  return Math.max(0, Math.round(positionSec * TICKS_PER_SECOND));
}

function basePlaybackInfo(itemId: string, positionSec: number): JfPlaybackInfo {
  if (activePlayItemId !== itemId || !activePlaySessionId) {
    activePlayItemId = itemId;
    activePlaySessionId = randomHex(16);
    activePlayStarted = false;
  }
  return {
    ItemId: itemId,
    PositionTicks: positionTicks(positionSec),
    IsMuted: false,
    CanSeek: true,
    PlayMethod: 'DirectPlay',
    PlaySessionId: activePlaySessionId,
  };
}

/**
 * Reports playback state to Jellyfin sessions so "Now Playing" and progress
 * metrics track what this client is doing.
 */
export async function reportPlayback(
  auth: SubsonicAuth,
  id: string,
  state: PlaybackState,
  positionSec: number,
): Promise<void> {
  if (state === 'stopped') {
    // Jellyfin may mark a session stop as played even below the app's own
    // listen threshold. We keep played-count semantics exclusively on
    // `scrobble/submitPlay` and only reset local session bookkeeping here.
    resetPlaybackSession();
    return;
  }

  if (state === 'starting') {
    if (activePlayItemId === id && activePlaySessionId && activePlayStarted) return;
    const body = { ...basePlaybackInfo(id, positionSec), IsPaused: false };
    await request(auth, '/Sessions/Playing', {}, { method: 'POST', body });
    activePlayStarted = true;
    return;
  }

  const body = { ...basePlaybackInfo(id, positionSec), IsPaused: state !== 'playing' };
  await request(auth, '/Sessions/Playing/Progress', {}, { method: 'POST', body });
}

/** Cover art URL. `id` can come from an album, song, or playlist. */
export function coverArtUrl(
  auth: SubsonicAuth,
  id: string | undefined,
  size = 300,
): string | undefined {
  if (!id) return undefined;
  return buildUrl(auth, `/Items/${id}/Images/Primary`, {
    fillWidth: size,
    fillHeight: size,
    quality: 90,
    api_key: auth.jfToken,
  });
}

/** Download URL of the original file, without transcoding. */
export function downloadUrl(auth: SubsonicAuth, id: string): string {
  return buildUrl(auth, `/Items/${id}/Download`, { api_key: auth.jfToken });
}

/**
 * How Jellyfin is asked for each codec: the container it muxes into and the
 * codec inside it. Jellyfin builds a transcoding profile out of these two, so
 * asking for one and not the other gets you neither.
 */
const TRANSCODE_TO: Record<string, { container: string; codec: string }> = {
  mp3: { container: 'mp3', codec: 'mp3' },
  // Opus lives in an Ogg stream; that is what the .opus files are.
  opus: { container: 'ogg', codec: 'opus' },
  // Raw ADTS, the same thing Navidrome hands over for AAC.
  aac: { container: 'aac', codec: 'aac' },
};

/**
 * Streaming URL (`/Audio/{id}/universal`): the server serves the file as-is
 * if the container is supported and fits within the max bitrate, otherwise
 * transcodes to `format`. `maxBitRate` in kbps, as in Subsonic.
 *
 * `format` used to be ignored here, which quietly turned every choice into mp3
 * (#82): a download set to Opus arrived as an mp3 named `.opus`, at the right
 * bitrate, with the app showing the codec that had been asked for rather than
 * the one that came. Left empty it is still mp3, which is what "server
 * default" amounts to on a server that transcodes to whatever it is told.
 *
 * `timeOffset` (seconds) asks the server to start the stream partway into the
 * track, which is the only way to move around inside a transcode: it is being
 * made as it is sent, so there is nothing behind or ahead to jump to. Jellyfin
 * takes it as `StartTimeTicks` and it was being dropped here, so every seek in
 * a transcoded track started it over (#117).
 */
export function streamUrl(
  auth: SubsonicAuth,
  id: string,
  maxBitRate = 0,
  timeOffset = 0,
  format = '',
): string {
  const target = TRANSCODE_TO[format] ?? TRANSCODE_TO.mp3;
  return buildUrl(auth, `/Audio/${id}/universal`, {
    UserId: auth.jfUserId,
    DeviceId: auth.jfDeviceId,
    api_key: auth.jfToken,
    Container: 'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg',
    TranscodingContainer: target.container,
    TranscodingProtocol: 'http',
    AudioCodec: target.codec,
    MaxStreamingBitrate: maxBitRate > 0 ? maxBitRate * 1000 : 140_000_000,
    StartTimeTicks: timeOffset > 0 ? Math.round(timeOffset * TICKS_PER_SECOND) : undefined,
  });
}
