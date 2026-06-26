/**
 * Acceso a la música local para el modo sin conexión. Dos orígenes:
 *
 * - 'device': toda la música del dispositivo vía expo-media-library.
 * - 'folder': una carpeta SAF elegida por el usuario.
 *
 * Lee etiquetas ID3v2 de cada fichero (título, artista, álbum, pista,
 * carátula embebida) y construye un catálogo de álbumes y artistas.
 * El catálogo se cachea en memoria para no re-leer los tags en cada consulta.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

import { type Song } from '@/api/subsonic';
import { base64ToUint8, parseID3, type ID3Tags } from './id3';

const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|alac|aif|aiff)$/i;

// ── Catálogo local ─────────────────────────────────────────────────────────

export interface LocalAlbum {
  id: string;
  name: string;
  artist?: string;
  coverBase64?: string;
  coverMime?: string;
  songCount: number;
  year?: number;
}

export interface LocalArtist {
  id: string;
  name: string;
  coverBase64?: string;
  coverMime?: string;
  albumCount: number;
}

export interface LocalCatalog {
  songs: Song[];
  albums: LocalAlbum[];
  artists: LocalArtist[];
}

/** Caché en memoria indexada por clave de origen. */
const catalogCache = new Map<string, LocalCatalog>();

function cacheKey(sourceMode: string, uri?: string): string {
  return uri ? `${sourceMode}:${uri}` : sourceMode;
}

// ── Lectura de ID3 desde archivo ───────────────────────────────────────────

/** Lee el tag ID3v2 completo: primero la cabecera, luego el resto. */
async function readID3Full(uri: string): Promise<Uint8Array | null> {
  try {
    // Leer solo la cabecera (10 bytes)
    const headB64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      length: 10,
      position: 0,
    });
    const head = base64ToUint8(headB64);
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) {
      // Sin ID3v2, leer primeros 128 B para intentar ID3v1 al final
      return head;
    }
    // Calcular tamaño total del tag
    const tagSize = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    const total = 10 + tagSize;
    // Leer el tag completo (máx 2 MB para evitar OOM con tags corruptos)
    const limit = Math.min(total, 2_000_000);
    const fullB64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      length: limit,
      position: 0,
    });
    return base64ToUint8(fullB64);
  } catch {
    return null;
  }
}

async function readID3(uri: string): Promise<ID3Tags | null> {
  const buf = await readID3Full(uri);
  if (!buf) return null;
  return parseID3(buf);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function titleFromFilename(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

function nameFromSafUri(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const last = decoded.split('/').pop() ?? decoded;
  return titleFromFilename(last);
}

/** Normaliza una cadena para agrupar: minúsculas, sin espacios extra. */
export function normKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Nombre más frecuente de una lista (para mostrar el más común como display). */
function pickBestName(names: string[]): string {
  const freq = new Map<string, number>();
  for (const n of names) {
    freq.set(n, (freq.get(n) ?? 0) + 1);
  }
  let best = names[0];
  let bestCount = 0;
  for (const [n, c] of freq) {
    if (c > bestCount || (c === bestCount && n.length < best.length)) {
      best = n;
      bestCount = c;
    }
  }
  return best;
}

function groupByAlbum(songs: Song[]): LocalAlbum[] {
  const map = new Map<string, {
    songs: Song[];
    displayAlbum: string;
    displayArtist: string;
    coverBase64?: string;
    coverMime?: string;
    year?: number;
  }>();
  for (const song of songs) {
    const rawAlbum = song.album || 'Álbum desconocido';
    const rawArtist = song.artist || 'Artista desconocido';
    const key = normKey(rawAlbum) + '|' + normKey(rawArtist);
    let entry = map.get(key);
    if (!entry) {
      entry = { songs: [], displayAlbum: rawAlbum, displayArtist: rawArtist };
      map.set(key, entry);
    }
    entry.songs.push(song);
    // Actualiza el nombre de display al más frecuente
    const allAlbums = entry.songs.map((s) => s.album || 'Álbum desconocido');
    entry.displayAlbum = pickBestName(allAlbums);
    const allArtists = entry.songs.map((s) => s.artist || 'Artista desconocido');
    entry.displayArtist = pickBestName(allArtists);
    if ((song as any).coverBase64) {
      entry.coverBase64 = (song as any).coverBase64;
      entry.coverMime = (song as any).coverMime;
    }
    if ((song as any).year) entry.year = (song as any).year;
  }
  return Array.from(map.entries()).map(([key, v]) => ({
    id: key,
    name: v.displayAlbum,
    artist: v.displayArtist !== 'Artista desconocido' ? v.displayArtist : undefined,
    coverBase64: v.coverBase64,
    coverMime: v.coverMime,
    songCount: v.songs.length,
    year: v.year,
  }));
}

function groupByArtist(albums: LocalAlbum[]): LocalArtist[] {
  const map = new Map<string, {
    albums: LocalAlbum[];
    displayName: string;
    coverBase64?: string;
    coverMime?: string;
  }>();
  for (const album of albums) {
    const rawArtist = album.artist || 'Artista desconocido';
    const key = normKey(rawArtist);
    let entry = map.get(key);
    if (!entry) {
      entry = { albums: [], displayName: rawArtist };
      map.set(key, entry);
    }
    entry.albums.push(album);
    const allNames = entry.albums.map((a) => a.artist || 'Artista desconocido');
    entry.displayName = pickBestName(allNames);
    if (album.coverBase64) {
      entry.coverBase64 = album.coverBase64;
      entry.coverMime = album.coverMime;
    }
  }
  return Array.from(map.entries()).map(([key, v]) => ({
    id: key,
    name: v.displayName,
    coverBase64: v.coverBase64,
    coverMime: v.coverMime,
    albumCount: v.albums.length,
  }));
}

function buildCatalog(songs: Song[]): LocalCatalog {
  const albums = groupByAlbum(songs);
  const artists = groupByArtist(albums);
  return { songs, albums, artists };
}

// ── Origen: dispositivo (expo-media-library) ──────────────────────────────

export async function ensureAudioPermission(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync(false, ['audio']);
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const res = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
  return res.granted;
}

export async function loadDeviceSongs(): Promise<Song[]> {
  const key = cacheKey('device');
  const cached = catalogCache.get(key);
  if (cached) return cached.songs;

  const rawSongs: { id: string; filename: string; duration: number; uri: string }[] = [];
  let after: string | undefined;
  let hasNext = true;
  while (hasNext && rawSongs.length < 5000) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: 200,
      after,
    });
    for (const a of page.assets) {
      rawSongs.push({ id: `local:${a.id}`, filename: a.filename, duration: a.duration, uri: a.uri });
    }
    after = page.endCursor;
    hasNext = page.hasNextPage;
  }

  const songs: Song[] = [];
  for (const raw of rawSongs) {
    let tags = null;
    try {
      tags = await readID3(raw.uri);
    } catch {
      // Si falla la lectura ID3, seguimos con el nombre de fichero.
    }
    const base: any = {
      id: raw.id,
      localUri: raw.uri,
      duration: raw.duration,
    };
    if (tags?.title) {
      base.title = tags.title;
      base.artist = tags.artist;
      base.album = tags.album;
      base.track = tags.track;
    } else {
      base.title = titleFromFilename(raw.filename);
    }
    if (tags?.coverBase64) {
      base.coverBase64 = tags.coverBase64;
      base.coverMime = tags.coverMime;
    }
    if (tags?.year) base.year = tags.year;
    songs.push(base);
  }
  songs.sort((a, b) => a.title.localeCompare(b.title));

  const catalog = buildCatalog(songs);
  catalogCache.set(key, catalog);
  return songs;
}

// ── Origen: carpeta concreta (Storage Access Framework) ───────────────────

export async function pickFolder(): Promise<string | null> {
  const res = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  return res.granted ? res.directoryUri : null;
}

export async function loadFolderSongs(treeUri: string): Promise<Song[]> {
  const key = cacheKey('folder', treeUri);
  const cached = catalogCache.get(key);
  if (cached) return cached.songs;

  const rawSongs: { id: string; filename: string; uri: string }[] = [];

  async function walk(dirUri: string, depth: number): Promise<void> {
    if (depth > 6 || rawSongs.length >= 5000) return;
    let entries: string[];
    try {
      entries = await StorageAccessFramework.readDirectoryAsync(dirUri);
    } catch {
      return;
    }
    for (const entryUri of entries) {
      const decoded = decodeURIComponent(entryUri);
      if (AUDIO_EXT.test(decoded)) {
        rawSongs.push({ id: `local:${entryUri}`, filename: nameFromSafUri(entryUri), uri: entryUri });
      } else if (!/\.[a-z0-9]{1,5}$/i.test(decoded)) {
        await walk(entryUri, depth + 1);
      }
    }
  }

  await walk(treeUri, 0);

  const songs: Song[] = [];
  for (const raw of rawSongs) {
    let tags = null;
    try {
      tags = await readID3(raw.uri);
    } catch {
      // Si falla la lectura ID3, seguimos con el nombre de fichero.
    }
    const base: any = {
      id: raw.id,
      localUri: raw.uri,
    };
    if (tags?.title) {
      base.title = tags.title;
      base.artist = tags.artist;
      base.album = tags.album;
      base.track = tags.track;
    } else {
      base.title = raw.filename;
    }
    if (tags?.coverBase64) {
      base.coverBase64 = tags.coverBase64;
      base.coverMime = tags.coverMime;
    }
    if (tags?.year) base.year = tags.year;
    songs.push(base);
  }
  songs.sort((a, b) => a.title.localeCompare(b.title));

  const catalog = buildCatalog(songs);
  catalogCache.set(key, catalog);
  return songs;
}

// ── Acceso al catálogo completo ────────────────────────────────────────────

export function getLocalCatalog(sourceMode: string, uri?: string): LocalCatalog | undefined {
  return catalogCache.get(cacheKey(sourceMode, uri));
}

export function getLocalAlbums(sourceMode: string, uri?: string): LocalAlbum[] {
  return catalogCache.get(cacheKey(sourceMode, uri))?.albums ?? [];
}

export function getLocalArtists(sourceMode: string, uri?: string): LocalArtist[] {
  return catalogCache.get(cacheKey(sourceMode, uri))?.artists ?? [];
}

function albumKeyOf(song: Song): string {
  return normKey(song.album || 'Álbum desconocido') + '|' + normKey(song.artist || 'Artista desconocido');
}

export function getLocalAlbumSongs(sourceMode: string, albumId: string, uri?: string): Song[] {
  return catalogCache.get(cacheKey(sourceMode, uri))?.songs.filter((s) => albumKeyOf(s) === albumId) ?? [];
}

export function getLocalArtistAlbums(sourceMode: string, artistName: string, uri?: string): LocalAlbum[] {
  return catalogCache.get(cacheKey(sourceMode, uri))?.albums.filter((a) => normKey(a.artist || 'Artista desconocido') === artistName) ?? [];
}

// ── Índice de carátulas ───────────────────────────────────────────────────

const coverIndex = new Map<string, string>();

export function registerCover(id: string, base64?: string, mime?: string) {
  if (base64 && !coverIndex.has(id)) {
    coverIndex.set(id, `data:${mime || 'image/jpeg'};base64,${base64}`);
  }
}

export function localCoverUrl(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return coverIndex.get(id);
}

/** Invalida el catálogo cacheado y las carátulas (útil al cambiar de origen). */
export function clearLocalCatalog(): void {
  catalogCache.clear();
  coverIndex.clear();
}
