/**
 * Minimal Navidrome native API client (non-Subsonic). Only used for what the
 * Subsonic API doesn't cover: custom cover art for playlists (≥ 0.61) and for
 * radio stations, whether a share allows downloading, and listing songs and
 * albums in an order Subsonic has no way to ask for. Requires cleartext
 * username and password to obtain a JWT (`auth.ndPassword`); see SubsonicAuth.
 */
// Not the global `fetch`: it never resolves in the background. See the note
// in `src/api/subsonic.ts`.
import { File, UploadType, type UploadResult } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { type Album, type Song, type SortDirection, type SubsonicAuth } from './subsonic';
import { DeadlineError, withDeadline } from './deadline';
import { assertCanRequest } from './netGate';
import { netTally } from '@/lib/perfLog';

/** Typed error to provide useful messages in the UI. */
export class NavidromeError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'forbidden' | 'unsupported' | 'other',
    /**
     * What the server answered, when it answered at all. `kind` covers the ones
     * worth explaining in words; this is for the rest, which otherwise reach the
     * user as "it didn't work" and reach us as a report with nothing in it. A
     * number needs no translating and is the whole difference between guessing
     * and knowing which end is at fault.
     */
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * The JWT for the profile last logged in, so paging through a list is one
 * request per page and not two. Navidrome's tokens outlive this by a long way;
 * half an hour is short enough that nothing has to watch them expire, and a
 * rejected one is thrown away and asked for again (see `ndJson`).
 */
let cached: { key: string; token: string; at: number } | null = null;
const TOKEN_TTL = 30 * 60 * 1000;

/** Each request, its answer read included (see `withDeadline`). */
const ND_TIMEOUT_MS = 15000;

/** `withDeadline`, with running out said the way the rest of this file says things. */
async function ndWithin<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await withDeadline(ND_TIMEOUT_MS, work);
  } catch (e) {
    if (e instanceof DeadlineError) throw new NavidromeError('Server took too long to respond', 'other');
    throw e;
  }
}

function tokenKey(auth: SubsonicAuth): string {
  return `${auth.serverUrl}|${auth.username}`;
}

/** Logs into the native API and returns the JWT. */
async function ndLogin(auth: SubsonicAuth, fresh = false): Promise<string> {
  // `password` is there when the profile authenticates in cleartext, and it is
  // the same password: no reason to ask for it twice.
  const password = auth.ndPassword ?? auth.password;
  if (!password) throw new NavidromeError('No saved password', 'auth');
  // Offline mode stops here, before the socket (see netGate) — and it has to
  // stop above the cached token, not below it. A token is not an answer, it is
  // the key the caller goes to fetch with (see `ndJson`), so handing a warm one
  // back while the mode is on lets that request out anyway: packets leaving a
  // phone whose owner said not to ask for any, which is what the gate exists
  // to rule out.
  assertCanRequest();
  const key = tokenKey(auth);
  if (!fresh && cached?.key === key && Date.now() - cached.at < TOKEN_TTL) return cached.token;
  const json = await ndWithin(async (signal) => {
    let res: Response;
    try {
      res = await fetch(`${auth.serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: auth.username, password }),
        signal,
      });
    } catch {
      throw new NavidromeError('Could not reach the server', 'other');
    }
    if (res.status === 401) throw new NavidromeError('Wrong credentials', 'auth');
    if (!res.ok) throw new NavidromeError(`Network error (${res.status})`, 'other');
    return (await res.json()) as { token?: string };
  });
  if (!json.token) throw new NavidromeError('Unexpected response from the server', 'other');
  cached = { key, token: json.token, at: Date.now() };
  return json.token;
}

/** What an answer from the native API means, for the paths that write. */
function ndStatusError(status: number): NavidromeError {
  if (status === 401) return new NavidromeError('Wrong credentials', 'auth');
  if (status === 403) return new NavidromeError('Cover upload is disabled', 'forbidden');
  if (status === 404 || status === 405) {
    return new NavidromeError('The server does not support covers', 'unsupported');
  }
  return new NavidromeError(`Server error (${status})`, 'other', status);
}

/** Authenticated request to the native API, with errors mapped to NavidromeError. */
async function ndFetch(auth: SubsonicAuth, path: string, init: RequestInit): Promise<void> {
  const token = await ndLogin(auth, true);
  netTally(`nd ${path.split('?')[0]}`);
  const status = await ndWithin(async (signal) => {
    try {
      const res = await fetch(`${auth.serverUrl}${path}`, {
        ...init,
        headers: { ...init.headers, 'x-nd-authorization': `Bearer ${token}` },
        signal,
      });
      return res.ok ? 0 : res.status;
    } catch {
      throw new NavidromeError('Could not reach the server', 'other');
    }
  });
  if (status) throw ndStatusError(status);
}

/**
 * Lets a share be downloaded, not just listened to.
 *
 * Subsonic's `createShare` takes an id, a description and an expiry and nothing
 * else, so this is the only way to reach that flag. The share is still created
 * through Subsonic, which is what returns the public link the server wants
 * handed out (it honours `ND_SHAREURL`, which we would have no way of guessing);
 * this only edits the one field afterwards.
 *
 * The description goes along because Navidrome writes both columns from what it
 * is sent, so leaving it out would blank the one just set.
 */
export async function setShareDownloadable(
  auth: SubsonicAuth,
  id: string,
  downloadable: boolean,
  description?: string,
): Promise<void> {
  await ndFetch(auth, `/api/share/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ downloadable, description: description ?? '' }),
  });
}

/** What the image belongs to; both live under the same native API shape. */
export type CoverKind = 'playlist' | 'radio';

/**
 * Uploads a local image as the cover art of a playlist or a radio station.
 * Endpoint: POST /api/{kind}/{id}/image, multipart with "image" field
 * (jpeg/png/gif/webp). 403 if upload is disabled or the item doesn't belong
 * to the user; 404 on servers too old for it.
 *
 * The one request in this file that does not go through `ndFetch`, and it is
 * the multipart that decides it. This used to hand `fetch` a `FormData` with
 * React Native's own file part, `{uri, name, type}` — which is not a standard
 * form part at all, only something RN's networking knows how to read off the
 * disk on its way out. Moving off the global `fetch` (see the note at the top)
 * took that away: `expo/fetch` builds the multipart body itself, in JS, from
 * strings and blobs, and a part it cannot read is an exception before anything
 * reaches the network. So changing a cover started failing on every server and
 * every playlist, and the sheet said only that it could not do it — the throw
 * came out of the same `catch` that means the server is unreachable.
 *
 * `File.upload` is the multipart that does exist natively: the file is streamed
 * from disk by the same layer that the rest of the app's transfers use, with
 * nothing buffered in JS, and a completed request comes back as a status
 * whatever that status is.
 */
export async function uploadCoverImage(
  auth: SubsonicAuth,
  kind: CoverKind,
  id: string,
  image: { uri: string; type: string },
): Promise<void> {
  const token = await ndLogin(auth, true);
  let result: UploadResult;
  try {
    result = await new File(image.uri).upload(
      `${auth.serverUrl}/api/${kind}/${encodeURIComponent(id)}/image`,
      {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        // The field Navidrome reads the picture out of; the filename comes off
        // the file itself, which the picker has already written with the right
        // extension.
        fieldName: 'image',
        mimeType: image.type,
        headers: { 'x-nd-authorization': `Bearer ${token}` },
      },
    );
  } catch {
    throw new NavidromeError('Could not reach the server', 'other');
  }
  if (result.status < 200 || result.status >= 300) throw ndStatusError(result.status);
}

/** Removes the custom cover art; Navidrome falls back to its own default. */
export async function deleteCoverImage(
  auth: SubsonicAuth,
  kind: CoverKind,
  id: string,
): Promise<void> {
  await ndFetch(auth, `/api/${kind}/${encodeURIComponent(id)}/image`, {
    method: 'DELETE',
  });
}

// ── Listing songs ───────────────────────────────────────────────────────────

/**
 * What Navidrome's REST layer accepts for ordering media files. Subsonic has no
 * endpoint that lists songs in any order at all, and this one sorts and pages
 * like any other list, which is the whole reason to come down here.
 */
export type NdSongSort =
  | 'title'
  | 'album'
  | 'recently_added'
  | 'play_date'
  | 'play_count'
  | 'random';

/**
 * Which way round an order is meant to be read, before anybody says otherwise.
 *
 * A-Z for the ones that read as a list, newest first for the ones about time.
 * `album` is the first kind: it expands, server side, to the album's sort name
 * and then disc and track, so ascending is the record played in order. Only a
 * default: the menu can flip any of them.
 */
export function naturalSongDir(sort: NdSongSort): SortDirection {
  return sort === 'recently_added' || sort === 'play_date' || sort === 'play_count'
    ? 'desc'
    : 'asc';
}

/** The same question for albums: the year, the arrival and the tally read
 *  backwards; the rest are lists and read forwards. */
export function naturalAlbumDir(sort: NdAlbumSort): SortDirection {
  return sort === 'recently_added' || sort === 'max_year' || sort === 'play_count'
    ? 'desc'
    : 'asc';
}

/** The fields of a media file this app has any use for. */
interface NdSong {
  id: string;
  title?: string;
  album?: string;
  albumId?: string;
  artist?: string;
  artistId?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  duration?: number;
  suffix?: string;
  bitRate?: number;
  bitDepth?: number;
  sampleRate?: number;
  channels?: number;
  genre?: string;
  comment?: string;
  /**
   * Parental advisory, but in the native model's own shorthand: `"e"` or `"c"`
   * where Subsonic spells out "explicit" and "clean". Translated in `toSong`,
   * so nothing downstream has to know there are two spellings.
   */
  explicitStatus?: string;
  /** Navidrome 0.64: neither the track nor its album has artwork. */
  imageAbsent?: boolean;
  size?: number;
  playCount?: number;
  starred?: boolean;
  starredAt?: string;
  rating?: number;
  rgTrackGain?: number;
  rgTrackPeak?: number;
  rgAlbumGain?: number;
  rgAlbumPeak?: number;
  /** Every tag the file has, by lower-case name; `isrc` is the one read. */
  tags?: Record<string, string[] | undefined>;
}

/**
 * The native model's one-letter advisory into the word Subsonic uses. Anything
 * else, including the empty string a file with no tag arrives with, is left
 * undefined: absent and "not advised either way" are the same thing here.
 */
function spellExplicit(status?: string): string | undefined {
  return status === 'e' ? 'explicit' : status === 'c' ? 'clean' : undefined;
}

/** Native song into the shape the rest of the app speaks (Subsonic's). */
function toSong(m: NdSong): Song {
  const gain = m.rgTrackGain ?? m.rgAlbumGain ?? m.rgTrackPeak ?? m.rgAlbumPeak;
  return {
    id: m.id,
    title: m.title ?? '',
    album: m.album,
    albumId: m.albumId,
    artist: m.artist,
    artistId: m.artistId,
    // Ids are the same ones Subsonic uses here, so the cover, the stream and
    // everything else keep working through the usual endpoints. Empty when
    // there is no artwork to ask for (see `lib/absentCovers`).
    coverArt: m.imageAbsent ? '' : (m.albumId ?? m.id),
    duration: m.duration,
    track: m.trackNumber,
    discNumber: m.discNumber,
    year: m.year,
    suffix: m.suffix,
    bitRate: m.bitRate,
    bitDepth: m.bitDepth,
    samplingRate: m.sampleRate,
    channelCount: m.channels,
    genre: m.genre,
    comment: m.comment,
    explicitStatus: spellExplicit(m.explicitStatus),
    // What Subsonic sends as `isrc`, here among the tags. lrc.red finds a
    // song's lyrics by it.
    isrc: m.tags?.isrc?.length ? m.tags.isrc : undefined,
    playCount: m.playCount,
    starred: m.starred ? (m.starredAt ?? new Date().toISOString()) : undefined,
    userRating: m.rating || undefined,
    ...(gain === undefined
      ? {}
      : {
          replayGain: {
            trackGain: m.rgTrackGain,
            albumGain: m.rgAlbumGain,
            trackPeak: m.rgTrackPeak,
            albumPeak: m.rgAlbumPeak,
          },
        }),
  };
}

/** Authenticated GET returning JSON, retrying once with a fresh token. */
async function ndJson<T>(auth: SubsonicAuth, path: string): Promise<T> {
  for (const fresh of [false, true]) {
    const token = await ndLogin(auth, fresh);
    // By the endpoint and not by the whole path: the sort and the window are
    // in the query string, and a table keyed by those would have one row per
    // call and say nothing.
    netTally(`nd ${path.split('?')[0]}`);
    const answer = await ndWithin(async (signal) => {
      let res: Response;
      try {
        res = await fetch(`${auth.serverUrl}${path}`, {
          headers: { 'x-nd-authorization': `Bearer ${token}` },
          signal,
        });
      } catch {
        throw new NavidromeError('Could not reach the server', 'other');
      }
      // A token this old server no longer accepts: drop it and ask for another,
      // once. Anything else is an answer, good or bad.
      if (res.status === 401 && !fresh) return { retry: true as const };
      if (res.status === 401) throw new NavidromeError('Wrong credentials', 'auth');
      if (res.status === 403) throw new NavidromeError('Not allowed', 'forbidden');
      if (res.status === 404) throw new NavidromeError('The server does not support it', 'unsupported');
      if (!res.ok) throw new NavidromeError(`Server error (${res.status})`, 'other');
      return { retry: false as const, value: (await res.json()) as T };
    });
    if (answer.retry) continue;
    return answer.value;
  }
  throw new NavidromeError('Wrong credentials', 'auth');
}

/**
 * A page of the library's songs, ordered by the server.
 *
 * Endpoint: GET /api/song, which takes `_sort`, `_order`, `_start` and `_end`
 * the way every list in Navidrome's own web UI does, plus a `library_id` per
 * library to keep to the ones that are turned on. It pages properly, so an alphabetical listing of a six-figure
 * library costs one page at a time and nothing is pulled onto the phone to be
 * sorted here.
 */
export async function listSongs(
  auth: SubsonicAuth,
  sort: NdSongSort = 'title',
  count = 50,
  offset = 0,
  libraryIds?: string[],
  genreId?: string,
  dir?: SortDirection,
): Promise<Song[]> {
  const order = (dir ?? naturalSongDir(sort)) === 'asc' ? 'ASC' : 'DESC';
  const q = new URLSearchParams({
    _sort: sort,
    _order: order,
    _start: String(offset),
    _end: String(offset + count),
  });
  // Narrowing to one genre is the same list with a filter on it, which is what
  // makes a genre's songs sortable at all: Subsonic's own endpoint for them
  // takes no order, so the only alternative was to sort the page that happened
  // to be loaded and call it alphabetical.
  if (genreId) q.set('genre_id', genreId);
  // Navidrome's own name for what Subsonic calls a music folder, and the ids
  // are the same ones, so a library turned off in the app stays off here.
  // Repeated, one per library: the REST layer turns a parameter given more than
  // once into a list, and the filter becomes an `IN`, so several libraries are
  // still one request and still one sorted list.
  for (const id of libraryIds ?? []) q.append('library_id', id);
  const rows = await ndJson<NdSong[]>(auth, `/api/song?${q.toString()}`);
  return Array.isArray(rows) ? rows.map(toSong) : [];
}

/**
 * What Navidrome's REST layer accepts for ordering albums.
 *
 * Mostly the names its own sort mappings declare, since an unknown one falls
 * through to a column and may well sort by nothing. `play_count` is the
 * exception and it is not a guess: Navidrome's own album table sorts by it
 * (the Play Count column sends `playCount`, which snake-cases to this), so the
 * column is there to be ordered by.
 */
export type NdAlbumSort =
  | 'name'
  | 'artist'
  | 'max_year'
  | 'recently_added'
  | 'play_count'
  | 'random';

/** The fields of an album this app has any use for. */
interface NdAlbum {
  id: string;
  name?: string;
  albumArtist?: string;
  albumArtistId?: string;
  artist?: string;
  artistId?: string;
  maxYear?: number;
  minYear?: number;
  songCount?: number;
  createdAt?: string;
  playCount?: number;
  playDate?: string;
  genre?: string;
  /** Same shorthand as the song's; see `NdSong`. */
  explicitStatus?: string;
  /** Navidrome 0.64: the album has no artwork. */
  imageAbsent?: boolean;
  /** This user's rating, 0 when none. */
  rating?: number;
}

function toAlbum(a: NdAlbum): Album {
  return {
    id: a.id,
    name: a.name ?? '',
    // The album artist is what an album is filed under; `artist` on this model
    // is the track artist and would put a compilation under whoever happened to
    // sing first.
    artist: a.albumArtist ?? a.artist,
    artistId: a.albumArtistId ?? a.artistId,
    // Same ids as Subsonic, so covers keep coming from the usual endpoint.
    coverArt: a.imageAbsent ? '' : a.id,
    songCount: a.songCount,
    // The year an album is shown by is the one it finished on, which is what
    // Subsonic's `year` means here too.
    year: a.maxYear ?? a.minYear,
    created: a.createdAt,
    played: a.playDate,
    playCount: a.playCount,
    genre: a.genre,
    explicitStatus: spellExplicit(a.explicitStatus),
    userRating: a.rating || undefined,
  };
}

/**
 * A page of albums, ordered by the server, optionally narrowed to one genre.
 *
 * Same reasoning as `listSongs`: Subsonic's `getAlbumList2` takes one of its
 * own fixed types OR a genre, never both, so a genre's albums arrive in
 * whatever order that server felt like and no client can ask for another.
 */
export async function listAlbums(
  auth: SubsonicAuth,
  sort: NdAlbumSort = 'name',
  count = 30,
  offset = 0,
  libraryIds?: string[],
  genreId?: string,
  dir?: SortDirection,
): Promise<Album[]> {
  const order = (dir ?? naturalAlbumDir(sort)) === 'asc' ? 'ASC' : 'DESC';
  const q = new URLSearchParams({
    _sort: sort,
    _order: order,
    _start: String(offset),
    _end: String(offset + count),
  });
  for (const id of libraryIds ?? []) q.append('library_id', id);
  if (genreId) q.set('genre_id', genreId);
  const rows = await ndJson<NdAlbum[]>(auth, `/api/album?${q.toString()}`);
  return Array.isArray(rows) ? rows.map(toAlbum) : [];
}

/** A genre as this server names it. The id is what its own filters take. */
export interface NdGenre {
  id: string;
  name: string;
}

/**
 * Every genre the server knows.
 *
 * Subsonic hands back genre NAMES and nothing else, which is what the app
 * routes by, and Navidrome's own lists filter by id. So the name has to be
 * turned into one before a genre's songs can be asked for in any order. The
 * whole list comes in one request and is small enough to keep: a library with
 * a thousand distinct genres is already unusual, and this is a name and an id
 * each.
 */
export async function listGenres(auth: SubsonicAuth): Promise<NdGenre[]> {
  const rows = await ndJson<NdGenre[]>(auth, '/api/genre?_sort=name&_start=0&_end=1000');
  return Array.isArray(rows) ? rows.filter((g) => g?.id && g?.name) : [];
}

/**
 * The ids of the playlists this user has marked as favourites.
 *
 * Navidrome 0.64 stores stars and ratings per user for playlists the way it
 * always has for songs, albums and artists (navidrome/navidrome#5749), but
 * deliberately keeps them out of the Subsonic playlist responses, with a
 * regression test on their absence. So this is the only way to read the state
 * back, and it is why the heart on a playlist is offered only when this
 * request can be made at all.
 *
 * `starred=true` is a real filter on this endpoint (`annotationBoolFilter`),
 * so the server sends the favourites and not the library: a user with four
 * starred playlists out of six hundred pays for four. Only the ids come back
 * because that is all a heart needs, and the playlists themselves are already
 * on screen from Subsonic.
 *
 * An older server has no such column, and what it does with the filter is its
 * own business: refuse the request, or ignore the parameter and answer with
 * the whole library. The second one is the dangerous shape, because an ignored
 * filter looks exactly like a filter that matched everything. So `starred` is
 * read off each row as well as filtered on, and a server that answered with
 * the library hands back nothing instead of marking every playlist a
 * favourite. Which is the safe way to be wrong, but still wrong: the heart
 * would read "not a favourite" for a state that server cannot hold. That part
 * is the caller's to settle, by only asking a server new enough to have the
 * column (see `usePlaylistStars`).
 */
export async function listStarredPlaylistIds(auth: SubsonicAuth): Promise<string[]> {
  const rows = await ndJson<{ id?: string; starred?: boolean }[]>(
    auth,
    '/api/playlist?starred=true&_sort=name&_start=0&_end=1000',
  );
  if (!Array.isArray(rows)) return [];
  // `starred` is checked as well as filtered on, so a server that ignored the
  // filter hands back nothing rather than everything.
  return rows.filter((p) => p?.id && p.starred).map((p) => p.id as string);
}

/**
 * The library each track of a playlist lives in, by song id. The Subsonic
 * playlist says nothing about libraries, so with only some of them turned on
 * in the app it listed songs from all of them (#275); the native listing of
 * the same tracks carries `libraryId`, which is the Subsonic music folder id.
 */
export async function playlistTrackLibraries(
  auth: SubsonicAuth,
  playlistId: string,
): Promise<Map<string, string>> {
  const rows = await ndJson<{ mediaFileId?: string; libraryId?: number | string }[]>(
    auth,
    `/api/playlist/${encodeURIComponent(playlistId)}/tracks?_start=0&_end=100000`,
  );
  const out = new Map<string, string>();
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (r?.mediaFileId && r.libraryId != null) out.set(r.mediaFileId, String(r.libraryId));
  }
  return out;
}
