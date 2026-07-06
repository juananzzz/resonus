/**
 * Cliente mínimo de la API de Jellyfin (API propia, no compatible Subsonic).
 *
 * Autenticación por sesión: al iniciar sesión (`makeAuth`) se llama a
 * `/Users/AuthenticateByName` y se guardan el token y el id de usuario en el
 * perfil (`jfToken`/`jfUserId`); cada petición lleva la cabecera
 * `Authorization: MediaBrowser ... Token="..."`. Las URLs que consumen las
 * vistas nativas (carátulas, streaming) no pueden llevar cabeceras, así que
 * usan el parámetro `api_key`.
 *
 * Las funciones exportadas replican las firmas de `subsonic.ts`; el módulo
 * `backend.ts` elige una implementación u otra según el tipo de servidor.
 */
import * as Crypto from 'expo-crypto';

import {
  CLIENT_NAME,
  normalizeUrl,
  type Album,
  type AlbumListType,
  type Artist,
  type ArtistInfo,
  type Genre,
  type Playlist,
  type RadioStation,
  type SavedQueue,
  type ScanStatus,
  type SearchResult,
  type Song,
  type SongLyrics,
  type StarType,
  type Starred,
  type SubsonicAuth,
} from './subsonic';

const CLIENT_VERSION = '1.0';
const REQUEST_TIMEOUT_MS = 15000;

/** Un tick de Jellyfin son 100 ns; los tiempos de la API vienen en ticks. */
const TICKS_PER_SECOND = 10_000_000;
const TICKS_PER_MS = 10_000;

/** Campos extra que hay que pedir explícitamente en cada tipo de item. */
const ALBUM_FIELDS = 'ChildCount,DateCreated';
const SONG_FIELDS = 'MediaSources,DateCreated';
const PLAYLIST_FIELDS = 'ChildCount,DateCreated,DateLastMediaAdded';

/** Subconjunto de BaseItemDto que usa la app. */
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
  ProductionYear?: number;
  ChildCount?: number;
  DateCreated?: string;
  DateLastMediaAdded?: string;
  ImageTags?: { Primary?: string };
  AlbumPrimaryImageTag?: string;
  UserData?: { IsFavorite?: boolean };
  MediaSources?: {
    Container?: string;
    Bitrate?: number;
    MediaStreams?: { Type?: string; BitDepth?: number; SampleRate?: number }[];
  }[];
}

interface JfItems {
  Items?: JfItem[];
}

function randomHex(bytes: number): string {
  return Array.from(Crypto.getRandomBytes(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function authHeader(auth: SubsonicAuth): string {
  return (
    `MediaBrowser Client="${CLIENT_NAME}", Device="Android", ` +
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

/** Petición autenticada; devuelve el JSON (o undefined si no hay cuerpo). */
async function request<T>(
  auth: SubsonicAuth,
  path: string,
  params: Params = {},
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
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
      throw new Error('El servidor tardó demasiado en responder');
    }
    throw new Error('No se pudo conectar con el servidor');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) throw new Error('Sesión caducada: vuelve a iniciar sesión');
  if (!res.ok) throw new Error(`Error de red (${res.status})`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Inicia sesión contra `/Users/AuthenticateByName` y construye el perfil.
 * El id de dispositivo se genera aquí y se conserva en el perfil (Jellyfin
 * asocia la sesión a ese id).
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
          `MediaBrowser Client="${CLIENT_NAME}", Device="Android", ` +
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

/** Comprueba que el token de sesión sigue siendo válido. */
export async function ping(auth: SubsonicAuth): Promise<void> {
  await request(auth, '/Users/Me');
}

// ── Mapeo de BaseItemDto a los modelos de la app ──

/**
 * Nuestro modelo marca favoritos con la fecha en que se fijaron; Jellyfin no
 * la expone, así que se usa la fecha de alta del item como aproximación.
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
    // La carátula de una canción suele ser la de su álbum; la propia solo si
    // el fichero trae imagen embebida.
    coverArt:
      it.AlbumPrimaryImageTag && it.AlbumId
        ? it.AlbumId
        : it.ImageTags?.Primary
          ? it.Id
          : undefined,
    duration: it.RunTimeTicks ? Math.round(it.RunTimeTicks / TICKS_PER_SECOND) : undefined,
    track: it.IndexNumber,
    starred: favDate(it),
    suffix: src?.Container,
    bitRate: src?.Bitrate ? Math.round(src.Bitrate / 1000) : undefined,
    bitDepth: audio?.BitDepth,
    samplingRate: audio?.SampleRate,
    year: it.ProductionYear,
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
  };
}

function toArtist(it: JfItem): Artist {
  return {
    id: it.Id,
    name: it.Name ?? '',
    coverArt: it.ImageTags?.Primary ? it.Id : undefined,
    starred: favDate(it),
  };
}

function toPlaylist(it: JfItem): Playlist {
  return {
    id: it.Id,
    name: it.Name ?? '',
    songCount: it.ChildCount,
    coverArt: it.ImageTags?.Primary ? it.Id : undefined,
    created: it.DateCreated,
    changed: it.DateLastMediaAdded,
  };
}

// ── Catálogo ──

const ALBUM_SORT: Record<AlbumListType, { SortBy: string; SortOrder?: string; Filters?: string }> =
  {
    newest: { SortBy: 'DateCreated', SortOrder: 'Descending' },
    recent: { SortBy: 'DatePlayed', SortOrder: 'Descending' },
    frequent: { SortBy: 'PlayCount', SortOrder: 'Descending' },
    random: { SortBy: 'Random' },
    alphabeticalByName: { SortBy: 'SortName' },
    alphabeticalByArtist: { SortBy: 'AlbumArtist,SortName' },
    starred: { SortBy: 'SortName', Filters: 'IsFavorite' },
  };

export async function getAlbumList(
  auth: SubsonicAuth,
  type: AlbumListType = 'newest',
  size = 20,
  offset = 0,
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
  });
  return (res.Items ?? [])
    .map((it) => ({ value: it.Name ?? '' }))
    .filter((g) => g.value);
}

export async function getAlbumsByGenre(
  auth: SubsonicAuth,
  genre: string,
  size = 30,
  offset = 0,
): Promise<Album[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    Genres: genre,
    Limit: size,
    StartIndex: offset,
    SortBy: 'SortName',
    Fields: ALBUM_FIELDS,
  });
  return (res.Items ?? []).map(toAlbum);
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

export async function getArtists(auth: SubsonicAuth): Promise<Artist[]> {
  const res = await request<JfItems>(auth, '/Artists/AlbumArtists', {
    UserId: auth.jfUserId,
    SortBy: 'SortName',
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
  return { artist: toArtist(item), albums: (albums.Items ?? []).map(toAlbum) };
}

export async function getArtistInfo(auth: SubsonicAuth, id: string): Promise<ArtistInfo> {
  const [item, similar] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Items/${id}/Similar`, {
      UserId: auth.jfUserId,
      Limit: 12,
    }).catch(() => ({ Items: [] }) as JfItems),
  ]);
  return {
    biography: item.Overview?.replace(/<[^>]+>/g, '').trim() || undefined,
    imageUrl: item.ImageTags?.Primary ? coverArtUrl(auth, item.Id, 600) : undefined,
    similarArtists: (similar.Items ?? []).map(toArtist),
  };
}

/** Canciones más reproducidas de un artista (Jellyfin filtra por nombre). */
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

/** Canciones parecidas a una dada vía Instant Mix (autoplay / radio). */
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
  // El mix incluye la canción semilla; Subsonic no la devuelve.
  return (res.Items ?? []).filter((it) => it.Id !== id).slice(0, count).map(toSong);
}

export async function search(auth: SubsonicAuth, query: string): Promise<SearchResult> {
  const items = (kind: 'MusicAlbum' | 'Audio') =>
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      SearchTerm: query,
      IncludeItemTypes: kind,
      Recursive: true,
      Limit: 20,
      Fields: kind === 'Audio' ? SONG_FIELDS : ALBUM_FIELDS,
    });
  const [artists, albums, songs] = await Promise.all([
    request<JfItems>(auth, '/Artists', { UserId: auth.jfUserId, SearchTerm: query, Limit: 20 }),
    items('MusicAlbum'),
    items('Audio'),
  ]);
  return {
    artists: (artists.Items ?? []).map(toArtist),
    albums: (albums.Items ?? []).map(toAlbum),
    songs: (songs.Items ?? []).map(toSong),
  };
}

// ── Favoritos ──

export async function getStarred(auth: SubsonicAuth): Promise<Starred> {
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
    request<JfItems>(auth, '/Artists', { UserId: auth.jfUserId, IsFavorite: true }),
  ]);
  return {
    songs: (songs.Items ?? []).map(toSong),
    albums: (albums.Items ?? []).map(toAlbum),
    artists: (artists.Items ?? []).map(toArtist),
  };
}

/** En Jellyfin los favoritos van por item, sin distinguir tipo. */
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
 * Jellyfin no expone la valoración de 1-5 estrellas de Subsonic (solo un
 * me gusta/no me gusta). El rating bar se oculta para estos perfiles, así que
 * esto es un no-op y no debería llegar a llamarse.
 */
export function setRating(_auth: SubsonicAuth, _id: string, _rating: number): Promise<void> {
  return Promise.resolve();
}

// ── Listas de reproducción ──

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

/** Renombra la lista (Jellyfin 10.9+; no tiene campo de descripción). */
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

/** Quita una canción por posición: hay que resolver antes su id de entrada. */
export async function removeFromPlaylist(
  auth: SubsonicAuth,
  id: string,
  index: number,
): Promise<void> {
  const res = await request<{ Items?: { PlaylistItemId?: string }[] }>(
    auth,
    `/Playlists/${id}/Items`,
    { UserId: auth.jfUserId },
  );
  const entryId = res.Items?.[index]?.PlaylistItemId;
  if (!entryId) throw new Error('No se encontró la canción en la lista');
  await request(auth, `/Playlists/${id}/Items`, { EntryIds: entryId }, { method: 'DELETE' });
}

// ── Biblioteca del servidor ──

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

// ── Letras ──

/** Jellyfin no tiene búsqueda de letra por artista+título. */
export async function getLyrics(
  _auth: SubsonicAuth,
  _artist: string,
  _title: string,
): Promise<string> {
  return '';
}

/** Letra del item (`/Audio/{id}/Lyrics`, 10.9+); tiempos en ticks. */
export async function getLyricsBySongId(
  auth: SubsonicAuth,
  id: string,
): Promise<SongLyrics | null> {
  let res: { Lyrics?: { Text?: string; Start?: number }[] };
  try {
    res = await request(auth, `/Audio/${id}/Lyrics`);
  } catch {
    return null; // 404 si la canción no tiene letra (o servidor < 10.9)
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

// ── Sin equivalente en Jellyfin ──

/** Jellyfin no guarda la cola en el servidor; queda la copia del dispositivo. */
export async function savePlayQueue(
  _auth: SubsonicAuth,
  _ids: string[],
  _currentId: string,
  _positionMs: number,
): Promise<void> {}

export async function getPlayQueue(_auth: SubsonicAuth): Promise<SavedQueue | null> {
  return null;
}

/** Jellyfin no tiene emisoras de radio por internet. */
export async function getRadioStations(_auth: SubsonicAuth): Promise<RadioStation[]> {
  return [];
}

// ── Reproducción ──

/** Marca la canción como reproducida (actualiza contador y fecha). */
export async function scrobble(auth: SubsonicAuth, id: string): Promise<void> {
  try {
    await request(auth, `/Users/${auth.jfUserId}/PlayedItems/${id}`, {}, { method: 'POST' });
  } catch {
    // El scrobble es opcional; ignoramos sus errores.
  }
}

/** URL de la carátula. `id` puede venir de un álbum, canción o playlist. */
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

/** URL de descarga del fichero original, sin transcodificar. */
export function downloadUrl(auth: SubsonicAuth, id: string): string {
  return buildUrl(auth, `/Items/${id}/Download`, { api_key: auth.jfToken });
}

/**
 * URL de streaming (`/Audio/{id}/universal`): el servidor sirve el fichero
 * tal cual si el contenedor está soportado y cabe en el bitrate máximo, y si
 * no transcodifica a mp3. `maxBitRate` en kbps, como en Subsonic.
 */
export function streamUrl(auth: SubsonicAuth, id: string, maxBitRate = 0): string {
  return buildUrl(auth, `/Audio/${id}/universal`, {
    UserId: auth.jfUserId,
    DeviceId: auth.jfDeviceId,
    api_key: auth.jfToken,
    Container: 'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg',
    TranscodingContainer: 'mp3',
    TranscodingProtocol: 'http',
    AudioCodec: 'mp3',
    MaxStreamingBitrate: maxBitRate > 0 ? maxBitRate * 1000 : 140_000_000,
  });
}
