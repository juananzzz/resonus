/**
 * Cliente mínimo de la API Subsonic, que es la que expone Navidrome.
 *
 * Autenticación por token: en cada petición se envían el usuario (u), un salt
 * aleatorio (s) y el token (t = md5(password + salt)). Así no viaja nunca la
 * contraseña en claro. Ver https://www.subsonic.org/pages/api.jsp
 */
import * as Crypto from 'expo-crypto';

export const CLIENT_NAME = 'Resonus';
const API_VERSION = '1.16.1';

export interface SubsonicAuth {
  serverUrl: string;
  username: string;
  /** md5(password + salt) en hexadecimal */
  token: string;
  /** salt aleatorio usado para generar el token */
  salt: string;
  /** Tipo de servidor (para mostrar su logo); navidrome/opensubsonic/ampache. */
  serverType?: string;
  /**
   * Contraseña en claro, solo para servidores que no soportan bien la auth por
   * token (Ampache). Se manda como `p=enc:<hex>` siguiendo el método clásico de
   * Subsonic. Para los demás servidores no se guarda (se usa token + salt).
   */
  password?: string;
}

export interface Song {
  id: string;
  title: string;
  album?: string;
  artist?: string;
  albumId?: string;
  artistId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  /** Marca de tiempo de cuándo se marcó como favorita; ausente si no lo es. */
  starred?: string;
  /** URL de streaming directa (usado para radio; evita generar URL Subsonic). */
  url?: string;
  /** Formato del archivo (mp3, flac, aac…). */
  suffix?: string;
  /** Bitrate en kbps. */
  bitRate?: number;
  /** Profundidad de bits (16, 24…). */
  bitDepth?: number;
  /** Frecuencia de muestreo en Hz (44100, 48000, 96000…). */
  samplingRate?: number;
  /** Carátula embebida en base64 (modo sin conexión). */
  coverBase64?: string;
  /** MIME de la carátula embebida (image/jpeg, image/png…). */
  coverMime?: string;
  /** URI de fichero local (modo sin conexión); si está, se reproduce sin servidor. */
  localUri?: string;
  /** Año de la canción (desde ID3, modo sin conexión). */
  year?: number;
  /** Fecha de modificación del fichero en ms (modo sin conexión). */
  addedAt?: number;
}

export interface Album {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  year?: number;
  starred?: string;
}

export interface Artist {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
  starred?: string;
}

export interface Playlist {
  id: string;
  name: string;
  songCount?: number;
  coverArt?: string;
}

/** Genera un salt aleatorio en hexadecimal. */
function randomSalt(): string {
  const bytes = Crypto.getRandomBytes(8);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Ampache valida mal la auth por token; necesita la clásica (`p=enc:<hex>`). */
function isAmpache(serverType?: string): boolean {
  return serverType === 'ampache';
}

/** Hex de los bytes UTF-8 de una cadena, para el parámetro Subsonic `enc:`. */
function hexEncodeUtf8(input: string): string {
  let hex = '';
  for (const char of input) {
    const code = char.codePointAt(0)!;
    const bytes: number[] =
      code < 0x80
        ? [code]
        : code < 0x800
          ? [0xc0 | (code >> 6), 0x80 | (code & 0x3f)]
          : code < 0x10000
            ? [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)]
            : [
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
              ];
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Calcula las credenciales de token a partir de la contraseña.
 * Se hace una sola vez al iniciar sesión; luego se reutilizan salt y token.
 */
export async function makeAuth(
  serverUrl: string,
  username: string,
  password: string,
  serverType?: string,
): Promise<SubsonicAuth> {
  const salt = randomSalt();
  const token = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.MD5,
    password + salt,
  );
  return {
    serverUrl: normalizeUrl(serverUrl),
    username,
    token,
    salt,
    serverType,
    // Ampache valida mal el token; guardamos la contraseña para usar `p=enc:`.
    ...(isAmpache(serverType) ? { password } : {}),
  };
}

/** Quita la barra final y asegura el esquema http(s). */
export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function authParams(auth: SubsonicAuth): URLSearchParams {
  const base = { u: auth.username, v: API_VERSION, c: CLIENT_NAME, f: 'json' };
  // Auth clásica para Ampache; token + salt para el resto.
  if (auth.password !== undefined) {
    return new URLSearchParams({ ...base, p: `enc:${hexEncodeUtf8(auth.password)}` });
  }
  return new URLSearchParams({ ...base, t: auth.token, s: auth.salt });
}

function buildUrl(
  auth: SubsonicAuth,
  endpoint: string,
  extra: Record<string, string | number | undefined> = {},
): string {
  const params = authParams(auth);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `${auth.serverUrl}/rest/${endpoint}?${params.toString()}`;
}

const REQUEST_TIMEOUT_MS = 15000;

/** Realiza una petición y desempaqueta la respuesta Subsonic. */
async function request<T>(
  auth: SubsonicAuth,
  endpoint: string,
  extra: Record<string, string | number | undefined> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(buildUrl(auth, endpoint, extra), {
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

  if (!res.ok) throw new Error(`Error de red (${res.status})`);
  const json = await res.json();
  const sub = json['subsonic-response'];
  if (!sub) throw new Error('Respuesta inesperada del servidor');
  if (sub.status === 'failed') {
    throw new Error(sub.error?.message ?? 'Error de Subsonic');
  }
  return sub as T;
}

/** Comprueba que las credenciales son válidas. */
export async function ping(auth: SubsonicAuth): Promise<void> {
  await request(auth, 'ping.view');
}

export type AlbumListType =
  | 'newest'
  | 'recent'
  | 'frequent'
  | 'random'
  | 'alphabeticalByName'
  | 'alphabeticalByArtist'
  | 'starred';

export async function getAlbumList(
  auth: SubsonicAuth,
  type: AlbumListType = 'newest',
  size = 20,
  offset = 0,
): Promise<Album[]> {
  const res = await request<{ albumList2?: { album?: Album[] } }>(
    auth,
    'getAlbumList2.view',
    { type, size, offset },
  );
  return res.albumList2?.album ?? [];
}

export interface Genre {
  value: string;
  songCount?: number;
  albumCount?: number;
}

export async function getGenres(auth: SubsonicAuth): Promise<Genre[]> {
  const res = await request<{ genres?: { genre?: Genre[] } }>(auth, 'getGenres.view');
  return (res.genres?.genre ?? []).filter((g) => g.value);
}

export async function getAlbumsByGenre(
  auth: SubsonicAuth,
  genre: string,
  size = 30,
  offset = 0,
): Promise<Album[]> {
  const res = await request<{ albumList2?: { album?: Album[] } }>(
    auth,
    'getAlbumList2.view',
    { type: 'byGenre', genre, size, offset },
  );
  return res.albumList2?.album ?? [];
}

export async function getAlbum(
  auth: SubsonicAuth,
  id: string,
): Promise<{ album: Album; songs: Song[] }> {
  const res = await request<{ album: Album & { song?: Song[] } }>(
    auth,
    'getAlbum.view',
    { id },
  );
  const { song, ...album } = res.album;
  return { album, songs: song ?? [] };
}

export async function getPlaylists(auth: SubsonicAuth): Promise<Playlist[]> {
  const res = await request<{ playlists?: { playlist?: Playlist[] } }>(
    auth,
    'getPlaylists.view',
  );
  return res.playlists?.playlist ?? [];
}

export async function getPlaylist(
  auth: SubsonicAuth,
  id: string,
): Promise<{ playlist: Playlist; songs: Song[] }> {
  const res = await request<{ playlist: Playlist & { entry?: Song[] } }>(
    auth,
    'getPlaylist.view',
    { id },
  );
  const { entry, ...playlist } = res.playlist;
  return { playlist, songs: entry ?? [] };
}

/** Añade una canción a una lista de reproducción existente. */
export async function addToPlaylist(
  auth: SubsonicAuth,
  playlistId: string,
  songId: string,
): Promise<void> {
  await request(auth, 'updatePlaylist.view', {
    playlistId,
    songIdToAdd: songId,
  });
}

/** Crea una lista de reproducción vacía con el nombre dado. */
export async function createPlaylist(
  auth: SubsonicAuth,
  name: string,
): Promise<void> {
  await request(auth, 'createPlaylist.view', { name });
}

/** Elimina una lista de reproducción. */
export async function deletePlaylist(
  auth: SubsonicAuth,
  id: string,
): Promise<void> {
  await request(auth, 'deletePlaylist.view', { id });
}

/** Renombra una lista de reproducción. */
export async function renamePlaylist(
  auth: SubsonicAuth,
  id: string,
  name: string,
): Promise<void> {
  await request(auth, 'updatePlaylist.view', { playlistId: id, name });
}

/** Quita una canción de una lista por su índice (posición en la lista). */
export async function removeFromPlaylist(
  auth: SubsonicAuth,
  id: string,
  index: number,
): Promise<void> {
  await request(auth, 'updatePlaylist.view', {
    playlistId: id,
    songIndexToRemove: index,
  });
}

export interface SearchResult {
  artists: Artist[];
  albums: Album[];
  songs: Song[];
}

export async function search(
  auth: SubsonicAuth,
  query: string,
): Promise<SearchResult> {
  const res = await request<{
    searchResult3?: { artist?: Artist[]; album?: Album[]; song?: Song[] };
  }>(auth, 'search3.view', { query, songCount: 20, albumCount: 20, artistCount: 20 });
  const r = res.searchResult3 ?? {};
  return {
    artists: r.artist ?? [],
    albums: r.album ?? [],
    songs: r.song ?? [],
  };
}

export async function getArtists(auth: SubsonicAuth): Promise<Artist[]> {
  const res = await request<{
    artists?: { index?: { artist?: Artist[] }[] };
  }>(auth, 'getArtists.view');
  // La respuesta agrupa los artistas por letra inicial; los aplanamos.
  return (res.artists?.index ?? []).flatMap((i) => i.artist ?? []);
}

export async function getArtist(
  auth: SubsonicAuth,
  id: string,
): Promise<{ artist: Artist; albums: Album[] }> {
  const res = await request<{ artist: Artist & { album?: Album[] } }>(
    auth,
    'getArtist.view',
    { id },
  );
  const { album, ...artist } = res.artist;
  return { artist, albums: album ?? [] };
}

/** Canciones más populares de un artista (por nombre). */
export async function getTopSongs(
  auth: SubsonicAuth,
  artist: string,
  count = 10,
): Promise<Song[]> {
  const res = await request<{ topSongs?: { song?: Song[] } }>(
    auth,
    'getTopSongs.view',
    { artist, count },
  );
  return res.topSongs?.song ?? [];
}

export interface ArtistInfo {
  biography?: string;
  imageUrl?: string;
  similarArtists: Artist[];
}

/** Info ampliada del artista (biografía, foto y similares) de getArtistInfo2. */
export async function getArtistInfo(
  auth: SubsonicAuth,
  id: string,
): Promise<ArtistInfo> {
  const res = await request<{
    artistInfo2?: {
      biography?: string;
      largeImageUrl?: string;
      similarArtist?: Artist[];
    };
  }>(auth, 'getArtistInfo2.view', { id });
  const info = res.artistInfo2 ?? {};
  // La biografía suele venir con HTML (enlace a Last.fm); lo quitamos.
  const biography = info.biography?.replace(/<[^>]+>/g, '').trim() || undefined;
  return {
    biography,
    imageUrl: info.largeImageUrl || undefined,
    similarArtists: info.similarArtist ?? [],
  };
}

export interface Starred {
  songs: Song[];
  albums: Album[];
  artists: Artist[];
}

export async function getStarred(auth: SubsonicAuth): Promise<Starred> {
  const res = await request<{
    starred2?: { song?: Song[]; album?: Album[]; artist?: Artist[] };
  }>(auth, 'getStarred2.view');
  const s = res.starred2 ?? {};
  return {
    songs: s.song ?? [],
    albums: s.album ?? [],
    artists: s.artist ?? [],
  };
}

export type StarType = 'song' | 'album' | 'artist';

function starParam(id: string, type: StarType): Record<string, string> {
  // Subsonic usa un parámetro distinto según el tipo de elemento.
  if (type === 'album') return { albumId: id };
  if (type === 'artist') return { artistId: id };
  return { id };
}

/** Marca un elemento como favorito. */
export async function star(
  auth: SubsonicAuth,
  id: string,
  type: StarType = 'song',
): Promise<void> {
  await request(auth, 'star.view', starParam(id, type));
}

/** Quita un elemento de favoritos. */
export async function unstar(
  auth: SubsonicAuth,
  id: string,
  type: StarType = 'song',
): Promise<void> {
  await request(auth, 'unstar.view', starParam(id, type));
}

export interface ScanStatus {
  scanning: boolean;
  count: number;
}

/** Estado del escaneo de la biblioteca del servidor. */
export async function getScanStatus(auth: SubsonicAuth): Promise<ScanStatus> {
  const res = await request<{ scanStatus?: { scanning?: boolean; count?: number } }>(
    auth,
    'getScanStatus.view',
  );
  return {
    scanning: res.scanStatus?.scanning ?? false,
    count: res.scanStatus?.count ?? 0,
  };
}

/** Lanza un nuevo escaneo de la biblioteca en el servidor. */
export async function startScan(auth: SubsonicAuth): Promise<ScanStatus> {
  const res = await request<{ scanStatus?: { scanning?: boolean; count?: number } }>(
    auth,
    'startScan.view',
  );
  return {
    scanning: res.scanStatus?.scanning ?? false,
    count: res.scanStatus?.count ?? 0,
  };
}

/** Obtiene la letra de una canción (puede venir vacía si no hay). */
export async function getLyrics(
  auth: SubsonicAuth,
  artist: string,
  title: string,
): Promise<string> {
  const res = await request<{ lyrics?: { value?: string } }>(
    auth,
    'getLyrics.view',
    { artist, title },
  );
  return res.lyrics?.value?.trim() ?? '';
}

export interface SavedQueue {
  entries: Song[];
  current?: string;
  /** Posición en la pista actual, en milisegundos. */
  position: number;
}

/** Guarda la cola de reproducción en el servidor (savePlayQueue). */
export async function savePlayQueue(
  auth: SubsonicAuth,
  ids: string[],
  currentId: string,
  positionMs: number,
): Promise<void> {
  if (ids.length === 0) return;
  const params = authParams(auth);
  for (const id of ids) params.append('id', id);
  if (currentId) params.set('current', currentId);
  params.set('position', String(Math.max(0, Math.floor(positionMs))));
  try {
    // POST con los parámetros en el cuerpo: evita URLs gigantes con colas largas.
    await fetch(`${auth.serverUrl}/rest/savePlayQueue.view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch {
    // Best-effort; ignoramos errores de red al guardar la cola.
  }
}

/** Recupera la cola guardada en el servidor (getPlayQueue). */
export async function getPlayQueue(auth: SubsonicAuth): Promise<SavedQueue | null> {
  const res = await request<{
    playQueue?: { entry?: Song[]; current?: string; position?: number };
  }>(auth, 'getPlayQueue.view');
  const pq = res.playQueue;
  if (!pq?.entry || pq.entry.length === 0) return null;
  return { entries: pq.entry, current: pq.current, position: pq.position ?? 0 };
}

/** Informa al servidor de que se ha reproducido una canción (scrobble). */
export async function scrobble(auth: SubsonicAuth, id: string): Promise<void> {
  try {
    await request(auth, 'scrobble.view', { id, submission: 'true' });
  } catch {
    // El scrobble es opcional; ignoramos sus errores.
  }
}

export interface RadioStation {
  id: string;
  name: string;
  streamUrl: string;
  homePageUrl?: string;
}

/** Devuelve las emisoras de radio guardadas en el servidor. */
export async function getRadioStations(
  auth: SubsonicAuth,
): Promise<RadioStation[]> {
  const res = await request<{
    internetRadioStations?: { internetRadioStation?: RadioStation[] };
  }>(auth, 'getInternetRadioStations.view');
  return res.internetRadioStations?.internetRadioStation ?? [];
}

/** URL de la carátula. `id` puede venir de un álbum, canción o playlist. */
export function coverArtUrl(
  auth: SubsonicAuth,
  id: string | undefined,
  size = 300,
): string | undefined {
  if (!id) return undefined;
  return buildUrl(auth, 'getCoverArt.view', { id, size });
}

/**
 * URL de streaming de una canción. Si `maxBitRate` > 0, el servidor
 * transcodifica a ese bitrate (kbps) para ahorrar datos.
 */
export function streamUrl(
  auth: SubsonicAuth,
  id: string,
  maxBitRate = 0,
): string {
  return buildUrl(auth, 'stream.view', {
    id,
    maxBitRate: maxBitRate > 0 ? maxBitRate : undefined,
  });
}
