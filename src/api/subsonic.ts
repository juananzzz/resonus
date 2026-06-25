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
}

export interface Song {
  id: string;
  title: string;
  album?: string;
  artist?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
}

export interface Album {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  year?: number;
}

export interface Artist {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
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

/**
 * Calcula las credenciales de token a partir de la contraseña.
 * Se hace una sola vez al iniciar sesión; luego se reutilizan salt y token.
 */
export async function makeAuth(
  serverUrl: string,
  username: string,
  password: string,
): Promise<SubsonicAuth> {
  const salt = randomSalt();
  const token = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.MD5,
    password + salt,
  );
  return { serverUrl: normalizeUrl(serverUrl), username, token, salt };
}

/** Quita la barra final y asegura el esquema http(s). */
export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function authParams(auth: SubsonicAuth): URLSearchParams {
  return new URLSearchParams({
    u: auth.username,
    t: auth.token,
    s: auth.salt,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: 'json',
  });
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

/** Realiza una petición y desempaqueta la respuesta Subsonic. */
async function request<T>(
  auth: SubsonicAuth,
  endpoint: string,
  extra: Record<string, string | number | undefined> = {},
): Promise<T> {
  const res = await fetch(buildUrl(auth, endpoint, extra));
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

export async function getAlbumList(
  auth: SubsonicAuth,
  type: 'newest' | 'recent' | 'frequent' | 'random' = 'newest',
  size = 20,
): Promise<Album[]> {
  const res = await request<{ albumList2?: { album?: Album[] } }>(
    auth,
    'getAlbumList2.view',
    { type, size },
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

/** Informa al servidor de que se ha reproducido una canción (scrobble). */
export async function scrobble(auth: SubsonicAuth, id: string): Promise<void> {
  try {
    await request(auth, 'scrobble.view', { id, submission: 'true' });
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
  return buildUrl(auth, 'getCoverArt.view', { id, size });
}

/** URL de streaming de una canción, lista para pasar al reproductor. */
export function streamUrl(auth: SubsonicAuth, id: string): string {
  return buildUrl(auth, 'stream.view', { id });
}
