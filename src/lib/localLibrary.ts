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
import { useScanProgress } from '@/store/scanProgress';
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
  /** Fecha del fichero más reciente del álbum (ms), para "Añadidos recientemente". */
  addedAt?: number;
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

// ── Concurrencia acotada ─────────────────────────────────────────────────────

/**
 * Nº de ficheros cuyos tags se leen a la vez. Las lecturas ID3 son casi todo
 * espera de I/O (saltos JS↔nativo), así que solaparlas acelera el escaneo varias
 * veces. Un valor moderado evita saturar el bridge y la memoria (cada lectura
 * puede traer una carátula de hasta ~2 MB).
 */
const SCAN_CONCURRENCY = 8;

/** Aplica `worker` a `items` con como máximo `limit` tareas en vuelo a la vez. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Devuelve una función para llamar tras procesar cada fichero. Agrupa las
 * actualizaciones del progreso (cada ~20 canciones) para no re-renderizar el
 * indicador una vez por fichero durante el escaneo.
 */
function progressBumper(total: number): () => void {
  let done = 0;
  let pending = 0;
  return () => {
    done++;
    pending++;
    if (pending >= 20 || done === total) {
      useScanProgress.getState().tick(pending);
      pending = 0;
    }
  };
}

// ── Lectura de ID3 desde archivo ───────────────────────────────────────────

/**
 * Lee el buffer del tag ID3v2: primero la cabecera (10 B) y, si hay tag, el
 * resto. Solo lecturas de bytes, sin `stat` (que es un salto nativo caro y solo
 * hace falta para el fallback ID3v1, que resolvemos aparte y de forma perezosa).
 */
async function readTagBuffer(uri: string): Promise<Uint8Array | null> {
  try {
    const headB64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      length: 10,
      position: 0,
    });
    const head = base64ToUint8(headB64);
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) {
      return head;
    }
    const tagSize = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    const total = 10 + tagSize;
    // Pedimos con margen (×4/3 + colchón): en SAF la lectura parcial puede
    // quedarse corta y cortar la carátula embebida (APIC), que suele ir al
    // final del tag. Leer de más es inofensivo y luego recortamos al decodificar.
    const cap = 2_500_000;
    const limit = Math.min(Math.ceil(total * (4 / 3)) + 4096, cap);
    const fullB64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      length: limit,
      position: 0,
    });
    return base64ToUint8(fullB64, Math.min(total, cap));
  } catch {
    return null;
  }
}

/** Lee tags ID3v2; si no hay título, intenta ID3v1 al final (leyendo tamaño ahí). */
async function readTags(uri: string): Promise<ID3Tags | null> {
  const buf = await readTagBuffer(uri);
  if (!buf) return null;
  const tags = parseID3(buf);
  // Solo si ID3v2 no dio título vamos al final por un tag ID3v1. Es raro, así
  // que el `stat` (para saber el tamaño y leer los últimos 128 B) se paga aquí
  // y no en cada fichero.
  if (!tags.title) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      const fileSize = info.exists ? ((info as any).size as number) || 0 : 0;
      if (fileSize > 128) {
        const tailB64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
          length: 128,
          position: fileSize - 128,
        });
        const v1 = parseID3(base64ToUint8(tailB64));
        if (v1.title) {
          tags.title = v1.title;
          tags.artist = tags.artist || v1.artist;
          tags.album = tags.album || v1.album;
          tags.track = tags.track ?? v1.track;
          tags.year = tags.year ?? v1.year;
        }
      }
    } catch {
      // ignorar errores leyendo el final
    }
  }
  return tags;
}

/** Lee el `mtime` (ms) de un fichero para "Añadidos recientemente" (modo carpeta). */
async function readMtime(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    // modificationTime viene en segundos; lo pasamos a ms.
    return info.exists && (info as any).modificationTime
      ? ((info as any).modificationTime as number) * 1000
      : 0;
  } catch {
    return 0;
  }
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

/** Hash estable y corto (FNV-1a → base36) para usar como id de ruta seguro. */
function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Nombre legible de una carpeta a partir de su URI SAF (sin prefijo [año]). */
function folderNameFromUri(dirUri: string): string {
  const decoded = decodeURIComponent(dirUri);
  const last = (decoded.split('/').pop() ?? decoded).split(':').pop() ?? decoded;
  return last.replace(/^\[\d{4}\]\s*/, '').trim() || last;
}

/** Carpeta contenedora de un fichero `file://` (modo dispositivo). */
function parentDirOf(uri: string): string | null {
  const decoded = decodeURIComponent(uri);
  const idx = decoded.lastIndexOf('/');
  if (idx <= 0) return null;
  return decoded.slice(0, idx);
}

/**
 * Asigna el álbum por carpeta: id estable a partir de la ruta de la carpeta y,
 * si la pista no trae etiqueta de álbum, usa el nombre de la carpeta. Así cada
 * carpeta es un álbum y las colaboraciones no parten el álbum (como Navidrome).
 */
function assignFolderAlbum(base: Record<string, unknown>, dirPath: string, hasAlbumTag: boolean) {
  base.albumId = 'f' + hashKey(dirPath);
  base.coverArt = base.albumId;
  if (!hasAlbumTag) base.album = folderNameFromUri(dirPath);
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
    coverBase64?: string;
    coverMime?: string;
    year?: number;
    addedAt?: number;
  }>();
  for (const song of songs) {
    // La clave de agrupación es el id de álbum ya calculado por canción:
    // en modo carpeta es la subcarpeta (todas sus pistas = un álbum), y en
    // modo dispositivo el nombre de álbum normalizado. Así un álbum con
    // colaboraciones no se parte; el artista se decide por mayoría más abajo.
    const key = albumKeyOf(song);
    let entry = map.get(key);
    if (!entry) {
      entry = { songs: [] };
      map.set(key, entry);
    }
    entry.songs.push(song);
    if (song.coverBase64) {
      entry.coverBase64 = song.coverBase64;
      entry.coverMime = song.coverMime;
    }
    if (song.year) entry.year = song.year;
    if (song.addedAt && song.addedAt > (entry.addedAt ?? 0)) entry.addedAt = song.addedAt;
  }
  // El nombre de álbum/artista de display (el más frecuente) se calcula una sola
  // vez por grupo, no en cada canción (evita un coste O(n²) durante el escaneo).
  return Array.from(map.entries()).map(([key, v]) => {
    const artist = pickBestName(v.songs.map((s) => s.artist || 'Artista desconocido'));
    return {
      id: key,
      name: pickBestName(v.songs.map((s) => s.album || 'Álbum desconocido')),
      artist: artist !== 'Artista desconocido' ? artist : undefined,
      coverBase64: v.coverBase64,
      coverMime: v.coverMime,
      songCount: v.songs.length,
      year: v.year,
      addedAt: v.addedAt,
    };
  });
}

function groupByArtist(albums: LocalAlbum[]): LocalArtist[] {
  const map = new Map<string, {
    albums: LocalAlbum[];
    coverBase64?: string;
    coverMime?: string;
  }>();
  for (const album of albums) {
    const key = normKey(album.artist || 'Artista desconocido');
    let entry = map.get(key);
    if (!entry) {
      entry = { albums: [] };
      map.set(key, entry);
    }
    entry.albums.push(album);
    if (album.coverBase64) {
      entry.coverBase64 = album.coverBase64;
      entry.coverMime = album.coverMime;
    }
  }
  return Array.from(map.entries()).map(([key, v]) => ({
    id: key,
    name: pickBestName(v.albums.map((a) => a.artist || 'Artista desconocido')),
    coverBase64: v.coverBase64,
    coverMime: v.coverMime,
    albumCount: v.albums.length,
  }));
}

function buildCatalog(songs: Song[]): LocalCatalog {
  const albums = groupByAlbum(songs);
  const artists = groupByArtist(albums);
  // Registra las carátulas embebidas para que `localCoverUrl(albumId)` y
  // `localCoverUrl(artistId)` funcionen en toda la app justo tras el escaneo.
  for (const a of albums) registerCover(a.id, a.coverBase64, a.coverMime);
  for (const a of artists) registerCover(a.id, a.coverBase64, a.coverMime);
  // La carátula ya vive deduplicada en `coverIndex` (una por álbum). No la
  // retenemos en cada canción: con miles de pistas serían cientos de MB en RAM.
  // La reproducción y la UI la resuelven por `coverArt`/`albumId` vía coverIndex.
  for (const s of songs) {
    delete s.coverBase64;
    delete s.coverMime;
  }
  return { songs, albums, artists };
}

/** Rellena título/artista/álbum/IDs de una canción a partir de sus tags ID3. */
function applyTags(base: Record<string, unknown>, fallbackTitle: string, tags: ID3Tags | null) {
  base.title = tags?.title || fallbackTitle;
  // Preferimos el artista del álbum (TPE2) para agrupar todo bajo un solo
  // artista, como hace Navidrome; si no, el artista de pista (TPE1).
  base.artist = tags?.albumArtist || tags?.artist;
  base.album = tags?.album;
  base.track = tags?.track;
  if (tags?.coverBase64) {
    base.coverBase64 = tags.coverBase64;
    base.coverMime = tags.coverMime;
  }
  if (tags?.year) base.year = tags.year;
  // IDs derivados (componen las claves del catálogo) para poder navegar al
  // álbum / artista desde una canción, igual que en modo servidor.
  const album = (base.album as string) || 'Álbum desconocido';
  const artist = (base.artist as string) || 'Artista desconocido';
  base.albumId = normKey(album);
  base.artistId = normKey(artist);
  base.coverArt = base.albumId;
}

// ── Origen: dispositivo (expo-media-library) ──────────────────────────────

// Filtra audio que no es música al escanear todo el dispositivo. MediaStore
// devuelve TODO (notas de voz, grabaciones, tonos, SFX), así que descartamos por
// ruta las carpetas típicas de no-música (mensajería, grabaciones, tonos…). No
// filtramos por duración: hay canciones cortas legítimas (interludios, skits).
const NON_MUSIC_PATH =
  /\/(whatsapp|telegram|signal|threema|viber|wechat|kakaotalk|line)\b|voice[ _-]?notes?|voice[ _-]?recorder|call[ _-]?rec|\/recordings?\/|\/ringtones?\/|\/notifications?\/|\/alarms?\//i;

function isLikelyMusic(uri: string): boolean {
  try {
    return !NON_MUSIC_PATH.test(decodeURIComponent(uri));
  } catch {
    return !NON_MUSIC_PATH.test(uri);
  }
}

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
  const disk = await loadCatalogFromDisk('device');
  if (disk) {
    catalogCache.set(key, disk);
    return disk.songs;
  }

  const rawSongs: { id: string; filename: string; duration: number; uri: string; mtime: number }[] = [];
  let after: string | undefined;
  let hasNext = true;
  while (hasNext && rawSongs.length < 5000) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: 200,
      after,
    });
    for (const a of page.assets) {
      // Salta carpetas que no son de música (mensajería, grabaciones, tonos…).
      if (!isLikelyMusic(a.uri)) continue;
      rawSongs.push({
        id: `local:${a.id}`,
        filename: a.filename,
        duration: a.duration,
        uri: a.uri,
        mtime: a.modificationTime || 0,
      });
    }
    after = page.endCursor;
    hasNext = page.hasNextPage;
  }

  useScanProgress.getState().start(rawSongs.length);
  const bump = progressBumper(rawSongs.length);
  let songs: Song[];
  try {
    songs = await mapPool(rawSongs, SCAN_CONCURRENCY, async (raw) => {
      let tags = null;
      try {
        tags = await readTags(raw.uri);
      } catch {
        // Si falla la lectura ID3, seguimos con el nombre de fichero.
      }
      const base: any = { id: raw.id, localUri: raw.uri, duration: raw.duration };
      applyTags(base, titleFromFilename(raw.filename), tags);
      if (raw.mtime) base.addedAt = raw.mtime; // MediaLibrary ya da ms
      // Agrupa por carpeta (igual que en modo carpeta): el álbum lo define el
      // directorio del fichero, no las etiquetas de cada pista.
      const dir = parentDirOf(raw.uri);
      if (dir) assignFolderAlbum(base, dir, !!tags?.album);
      bump();
      return base as Song;
    });
  } finally {
    useScanProgress.getState().done();
  }
  songs.sort((a, b) => a.title.localeCompare(b.title));

  const catalog = buildCatalog(songs);
  catalogCache.set(key, catalog);
  void saveCatalogToDisk('device', undefined, catalog);
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
  const disk = await loadCatalogFromDisk('folder', treeUri);
  if (disk) {
    catalogCache.set(key, disk);
    return disk.songs;
  }

  const rawSongs: { id: string; filename: string; uri: string; dirUri: string }[] = [];

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
        rawSongs.push({ id: `local:${entryUri}`, filename: nameFromSafUri(entryUri), uri: entryUri, dirUri });
      } else if (!/\.[a-z0-9]{1,5}$/i.test(decoded)) {
        await walk(entryUri, depth + 1);
      }
    }
  }

  await walk(treeUri, 0);

  useScanProgress.getState().start(rawSongs.length);
  const bump = progressBumper(rawSongs.length);
  let songs: Song[];
  try {
    songs = await mapPool(rawSongs, SCAN_CONCURRENCY, async (raw) => {
      let tags = null;
      let mtime = 0;
      try {
        // SAF no da mtime en readDirectoryAsync; se lee en paralelo con los tags.
        [tags, mtime] = await Promise.all([readTags(raw.uri), readMtime(raw.uri)]);
      } catch {
        // Si falla la lectura ID3, seguimos con el nombre de fichero.
      }
      const base: any = { id: raw.id, localUri: raw.uri };
      applyTags(base, raw.filename, tags);
      if (mtime) base.addedAt = mtime;
      // En modo carpeta, cada subcarpeta es un álbum (lo más fiable). Los
      // ficheros sueltos en la raíz elegida se agrupan por su etiqueta de
      // álbum (p. ej. un single).
      if (raw.dirUri !== treeUri) assignFolderAlbum(base, raw.dirUri, !!tags?.album);
      bump();
      return base as Song;
    });
  } finally {
    useScanProgress.getState().done();
  }
  songs.sort((a, b) => a.title.localeCompare(b.title));

  const catalog = buildCatalog(songs);
  catalogCache.set(key, catalog);
  void saveCatalogToDisk('folder', treeUri, catalog);
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
  return song.albumId || normKey(song.album || 'Álbum desconocido');
}

export function getLocalAlbumSongs(sourceMode: string, albumId: string, uri?: string): Song[] {
  const songs = catalogCache.get(cacheKey(sourceMode, uri))?.songs.filter((s) => albumKeyOf(s) === albumId) ?? [];
  // Orden por nº de pista (las que no lo tengan, al final por título).
  return songs.sort((a, b) => {
    const ta = a.track ?? Infinity;
    const tb = b.track ?? Infinity;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
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

// ── Persistencia del catálogo en disco ──────────────────────────────────────
// Evita re-leer los ID3 de todos los ficheros cada vez que se entra al modo
// local: el catálogo (con carátulas) se guarda en disco y se recarga al
// instante. El botón "Volver a escanear" fuerza un re-análisis.
const CATALOG_DIR = FileSystem.documentDirectory + 'local-catalog/';

function catalogFile(sourceMode: string, uri?: string): string {
  return `${CATALOG_DIR}c_${hashKey(cacheKey(sourceMode, uri))}.json`;
}

async function saveCatalogToDisk(sourceMode: string, uri: string | undefined, catalog: LocalCatalog): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(CATALOG_DIR, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(catalogFile(sourceMode, uri), JSON.stringify(catalog));
  } catch {
    // Si no se puede guardar, se re-analizará la próxima vez (no es crítico).
  }
}

async function loadCatalogFromDisk(sourceMode: string, uri?: string): Promise<LocalCatalog | null> {
  try {
    const file = catalogFile(sourceMode, uri);
    const info = await FileSystem.getInfoAsync(file);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(file);
    const catalog = JSON.parse(raw) as LocalCatalog;
    if (!catalog?.songs?.length) return null;
    // El índice de carátulas no se persiste aparte: se reconstruye al cargar.
    for (const a of catalog.albums) registerCover(a.id, a.coverBase64, a.coverMime);
    for (const a of catalog.artists) registerCover(a.id, a.coverBase64, a.coverMime);
    return catalog;
  } catch {
    return null;
  }
}

/** Borra el catálogo persistido en disco (al volver a escanear). */
export async function clearLocalCatalogDisk(): Promise<void> {
  try {
    await FileSystem.deleteAsync(CATALOG_DIR, { idempotent: true });
  } catch {
    // ignore
  }
}
