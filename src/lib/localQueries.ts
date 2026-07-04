/**
 * Consultas del catálogo local que replican la API Subsonic.
 * Si el catálogo aún no se ha cargado, lo carga bajo demanda.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { useAuthStore } from '@/store/auth';
import { usePlayCounts } from '@/store/playCounts';
import { type Album, type Artist, type ArtistInfo, type Playlist, type SearchResult, type Song, type StarType, type Starred } from '@/api/subsonic';
import { getItem, setItem } from '@/lib/storage';
import { getDownloadsCatalog } from '@/store/downloads';
import {
  clearLocalCatalog,
  clearLocalCatalogDisk,
  getLocalCatalog,
  loadDeviceSongs,
  loadFolderSongs,
  normKey,
  registerCover,
} from './localLibrary';

const FAVS_KEY = 'resonus.localFavorites';

interface LocalFavStore {
  songs: string[];
  albums: string[];
  artists: string[];
}

let favCache: LocalFavStore | null = null;

async function loadFavs(): Promise<LocalFavStore> {
  if (favCache) return favCache;
  try {
    const raw = await getItem(FAVS_KEY);
    favCache = raw ? (JSON.parse(raw) as LocalFavStore) : { songs: [], albums: [], artists: [] };
  } catch {
    favCache = { songs: [], albums: [], artists: [] };
  }
  return favCache;
}

async function saveFavs(favs: LocalFavStore) {
  favCache = favs;
  await setItem(FAVS_KEY, JSON.stringify(favs));
}

export async function starLocal(id: string, type?: StarType) {
  const favs = await loadFavs();
  if (type === 'album' || type === 'artist') {
    const key = type === 'album' ? 'albums' : 'artists';
    if (!favs[key].includes(id)) {
      favs[key].push(id);
      await saveFavs(favs);
    }
  } else {
    if (!favs.songs.includes(id)) {
      favs.songs.push(id);
      await saveFavs(favs);
    }
  }
}

export async function unstarLocal(id: string, type?: StarType) {
  const favs = await loadFavs();
  if (type === 'album' || type === 'artist') {
    const key = type === 'album' ? 'albums' : 'artists';
    favs[key] = favs[key].filter((x) => x !== id);
  } else {
    favs.songs = favs.songs.filter((x) => x !== id);
  }
  await saveFavs(favs);
}

/** Limpia la caché de favoritos (al cambiar de origen). */
export function clearLocalFavs() {
  favCache = null;
}

function sourceInfo() {
  const { offlineSource } = useAuthStore.getState();
  return {
    mode: offlineSource?.mode ?? 'device',
    key: offlineSource?.mode === 'folder' ? offlineSource.uri : undefined,
  };
}

let loadingPromise: Promise<any> | null = null;

/** Forma mínima común de álbum/artista entre el escaneo y las descargas. */
interface CatAlbum {
  id: string;
  name: string;
  artist?: string;
  coverUri?: string;
  songCount?: number;
  year?: number;
  addedAt?: number;
}
interface CatArtist {
  id: string;
  name: string;
  coverUri?: string;
  albumCount?: number;
}
interface MergedCatalog {
  songs: Song[];
  albums: CatAlbum[];
  artists: CatArtist[];
}

/** Catálogo del origen elegido (device/folder), cargándolo si hace falta. */
async function ensureScanCatalog() {
  const { mode, key } = sourceInfo();
  const cached = getLocalCatalog(mode, key);
  if (cached) return cached;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      try {
        if (mode === 'folder' && key) {
          await loadFolderSongs(key);
        } else {
          await loadDeviceSongs();
        }
      } finally {
        loadingPromise = null;
      }
    })();
  }
  await loadingPromise;
  return getLocalCatalog(mode, key);
}

/** Artistas del escaneo + de las descargas, fusionados por clave de nombre. */
function mergeArtists(base: CatArtist[], extra: CatArtist[]): CatArtist[] {
  const map = new Map(base.map((a) => [a.id, { ...a }]));
  for (const ar of extra) {
    const existing = map.get(ar.id);
    if (existing) {
      existing.albumCount = (existing.albumCount ?? 0) + (ar.albumCount ?? 0);
      if (!existing.coverUri) existing.coverUri = ar.coverUri;
    } else {
      map.set(ar.id, { ...ar });
    }
  }
  return Array.from(map.values());
}

/**
 * Catálogo del perfil local = escaneo del origen + descargas del servidor,
 * fusionados. Si el escaneo falla (p. ej. sin permiso de audio), las descargas
 * se muestran igualmente. No hay duplicados posibles: MediaStore/SAF no ven el
 * directorio privado de descargas.
 */
async function ensureCatalog(): Promise<MergedCatalog | null> {
  // Sin origen elegido no se escanea nada: el perfil local puede vivir solo de
  // las descargas (elegir origen de música local es opcional).
  const hasSource = !!useAuthStore.getState().offlineSource;
  const [base, dl] = await Promise.all([
    hasSource ? ensureScanCatalog().catch(() => undefined) : Promise.resolve(undefined),
    getDownloadsCatalog().catch(() => ({ songs: [], albums: [], artists: [] })),
  ]);
  if (dl.songs.length === 0) return base ?? null;
  return {
    songs: [...(base?.songs ?? []), ...dl.songs],
    albums: [...(base?.albums ?? []), ...dl.albums],
    artists: mergeArtists(base?.artists ?? [], dl.artists),
  };
}

/**
 * Vuelve a escanear el origen local: descarta el catálogo cacheado (y las
 * carátulas) y lo reconstruye leyendo de nuevo las etiquetas de los ficheros.
 * Útil tras añadir o cambiar música sin reiniciar la app.
 */
export async function rescan(): Promise<void> {
  clearLocalCatalog();
  await clearLocalCatalogDisk();
  loadingPromise = null;
  await ensureCatalog();
}

function toAlbum(local: CatAlbum): Album {
  registerCover(local.id, local.coverUri);
  return {
    id: local.id,
    name: local.name,
    artist: local.artist,
    artistId: local.artist ? normKey(local.artist) : undefined,
    coverArt: local.id,
    songCount: local.songCount,
    year: local.year,
  };
}

function toArtist(local: CatArtist): Artist {
  registerCover(local.id, local.coverUri);
  return {
    id: local.id,
    name: local.name,
    coverArt: local.id,
    albumCount: local.albumCount,
  };
}

export async function getAlbumList(type: string, size = 20, offset = 0): Promise<Album[]> {
  const c = await ensureCatalog();
  if (!c) return [];
  let albums = [...c.albums];
  switch (type) {
    case 'newest':
    case 'recent':
      // Añadidos recientemente: por fecha del fichero (si falta, por año).
      albums.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || (b.year ?? 0) - (a.year ?? 0));
      break;
    case 'frequent': {
      // Más escuchados: por nº de reproducciones locales acumuladas del álbum.
      const counts = usePlayCounts.getState().counts;
      const albumPlays = new Map<string, number>();
      for (const s of c.songs) {
        const n = counts[s.id] ?? 0;
        if (n > 0 && s.albumId) albumPlays.set(s.albumId, (albumPlays.get(s.albumId) ?? 0) + n);
      }
      albums = albums
        .filter((a) => (albumPlays.get(a.id) ?? 0) > 0)
        .sort((a, b) => (albumPlays.get(b.id) ?? 0) - (albumPlays.get(a.id) ?? 0));
      break;
    }
    case 'random':
      for (let i = albums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [albums[i], albums[j]] = [albums[j], albums[i]];
      }
      break;
    case 'alphabeticalByArtist':
      albums.sort((a, b) => (a.artist ?? '').localeCompare(b.artist ?? '') || a.name.localeCompare(b.name));
      break;
    default: // alphabeticalByName
      albums.sort((a, b) => a.name.localeCompare(b.name));
  }
  return albums.slice(offset, offset + size).map(toAlbum);
}

/** Todos los álbumes del catálogo local, ordenados alfabéticamente. */
export async function getAllAlbums(): Promise<Album[]> {
  const c = await ensureCatalog();
  if (!c) return [];
  return [...c.albums].sort((a, b) => a.name.localeCompare(b.name)).map(toAlbum);
}

export async function getAlbum(albumId: string): Promise<{ album: Album; songs: Song[] }> {
  const c = await ensureCatalog();
  const songs = (c?.songs ?? [])
    .filter((s) => (s.albumId || normKey(s.album || 'Álbum desconocido')) === albumId)
    // Orden por nº de pista (las que no lo tengan, al final por título).
    .sort((a, b) => {
      const ta = a.track ?? Infinity;
      const tb = b.track ?? Infinity;
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    });
  const album = c?.albums.find((a) => a.id === albumId);
  return {
    album: album ? toAlbum(album) : { id: albumId, name: albumId, songCount: songs.length },
    songs,
  };
}

export async function getArtists(): Promise<Artist[]> {
  const c = await ensureCatalog();
  if (!c) return [];
  return c.artists.map(toArtist);
}

export async function getArtist(artistId: string): Promise<{ artist: Artist; albums: Album[] }> {
  const c = await ensureCatalog();
  const albums = (c?.albums ?? []).filter(
    (a) => normKey(a.artist || 'Artista desconocido') === artistId,
  );
  const artist = c?.artists.find((a) => a.id === artistId);
  return {
    artist: artist ? toArtist(artist) : { id: artistId, name: artistId, albumCount: albums.length },
    albums: albums.map(toAlbum),
  };
}

export function getArtistInfo(_id: string): ArtistInfo {
  return { similarArtists: [] };
}

export async function getTopSongs(artist: string, count = 10): Promise<Song[]> {
  const c = await ensureCatalog();
  if (!c) return [];
  return c.songs.filter((s) => s.artist === artist).slice(0, count);
}

// ---- Listas de reproducción locales (modo sin conexión) -------------------
// Se guardan como ids de canción; se resuelven contra el catálogo al leerlas,
// así que canciones que ya no existan en el origen actual se omiten.
const PLAYLISTS_KEY = 'resonus.localPlaylists';

interface LocalPlaylistRec {
  id: string;
  name: string;
  comment?: string;
  songIds: string[];
  createdAt: number;
  /** Carátula personalizada (file:// copiado a PLAYLIST_COVERS_DIR). */
  coverUri?: string;
}

let playlistCache: LocalPlaylistRec[] | null = null;

async function loadPlaylists(): Promise<LocalPlaylistRec[]> {
  if (playlistCache) return playlistCache;
  try {
    const raw = await getItem(PLAYLISTS_KEY);
    playlistCache = raw ? (JSON.parse(raw) as LocalPlaylistRec[]) : [];
  } catch {
    playlistCache = [];
  }
  return playlistCache;
}

async function savePlaylists(list: LocalPlaylistRec[]) {
  playlistCache = list;
  await setItem(PLAYLISTS_KEY, JSON.stringify(list));
}

function newPlaylistId(): string {
  return `lp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function toPlaylist(rec: LocalPlaylistRec, songs: Song[]): Playlist {
  const cover = songs.find((s) => s.coverArt || s.albumId);
  return {
    id: rec.id,
    name: rec.name,
    comment: rec.comment,
    songCount: songs.length,
    coverArt: rec.coverUri ?? cover?.coverArt ?? cover?.albumId,
    created: new Date(rec.createdAt).toISOString(),
  };
}

/** Lista de listas locales (orden por creación, más recientes primero). */
export async function getPlaylists(): Promise<Playlist[]> {
  const [list, c] = await Promise.all([loadPlaylists(), ensureCatalog()]);
  const byId = new Map((c?.songs ?? []).map((s) => [s.id, s]));
  return list
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((rec) => toPlaylist(rec, rec.songIds.map((id) => byId.get(id)).filter(Boolean) as Song[]));
}

export async function getPlaylist(id: string): Promise<{ playlist: Playlist; songs: Song[] }> {
  const [list, c] = await Promise.all([loadPlaylists(), ensureCatalog()]);
  const rec = list.find((p) => p.id === id);
  const byId = new Map((c?.songs ?? []).map((s) => [s.id, s]));
  const songs = (rec?.songIds ?? []).map((sid) => byId.get(sid)).filter(Boolean) as Song[];
  return {
    playlist: rec ? toPlaylist(rec, songs) : { id, name: id, songCount: 0 },
    songs,
  };
}

export async function createPlaylist(name: string): Promise<string> {
  const list = await loadPlaylists();
  const id = newPlaylistId();
  await savePlaylists([{ id, name, songIds: [], createdAt: Date.now() }, ...list]);
  return id;
}

export async function addToPlaylist(playlistId: string, songId: string): Promise<void> {
  const list = await loadPlaylists();
  await savePlaylists(
    list.map((p) => (p.id === playlistId ? { ...p, songIds: [...p.songIds, songId] } : p)),
  );
}

export async function removeFromPlaylist(id: string, index: number): Promise<void> {
  const list = await loadPlaylists();
  await savePlaylists(
    list.map((p) => (p.id === id ? { ...p, songIds: p.songIds.filter((_, i) => i !== index) } : p)),
  );
}

export async function deletePlaylist(id: string): Promise<void> {
  const list = await loadPlaylists();
  deleteCoverFile(list.find((p) => p.id === id)?.coverUri);
  await savePlaylists(list.filter((p) => p.id !== id));
}

// ── Carátula personalizada de listas locales ────────────────────────────────
// La imagen elegida se copia a un directorio propio: fuera de local-catalog/,
// que "Volver a escanear" borra entero y se llevaría la carátula por delante.
const PLAYLIST_COVERS_DIR = FileSystem.documentDirectory + 'playlist-covers/';

function deleteCoverFile(uri?: string) {
  if (uri) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export async function setLocalPlaylistCover(id: string, srcUri: string): Promise<void> {
  await FileSystem.makeDirectoryAsync(PLAYLIST_COVERS_DIR, { intermediates: true }).catch(() => {});
  // Nombre nuevo en cada cambio: si se reutilizara la misma URI, expo-image
  // seguiría enseñando la imagen anterior que tiene cacheada.
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dest = `${PLAYLIST_COVERS_DIR}${safe}-${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: srcUri, to: dest });
  const list = await loadPlaylists();
  deleteCoverFile(list.find((p) => p.id === id)?.coverUri);
  await savePlaylists(list.map((p) => (p.id === id ? { ...p, coverUri: dest } : p)));
}

export async function removeLocalPlaylistCover(id: string): Promise<void> {
  const list = await loadPlaylists();
  deleteCoverFile(list.find((p) => p.id === id)?.coverUri);
  await savePlaylists(list.map((p) => (p.id === id ? { ...p, coverUri: undefined } : p)));
}

/** Crea o actualiza una lista local (la usan las descargas de playlists). */
export async function upsertLocalPlaylist(
  id: string,
  name: string,
  songIds: string[],
  comment?: string,
): Promise<void> {
  const list = await loadPlaylists();
  if (list.some((p) => p.id === id)) {
    await savePlaylists(list.map((p) => (p.id === id ? { ...p, name, comment, songIds } : p)));
  } else {
    await savePlaylists([{ id, name, comment, songIds, createdAt: Date.now() }, ...list]);
  }
}

/** Borra las listas locales con ese prefijo de id (limpieza de descargas). */
export async function deleteLocalPlaylistsByPrefix(prefix: string): Promise<void> {
  const list = await loadPlaylists();
  for (const p of list) if (p.id.startsWith(prefix)) deleteCoverFile(p.coverUri);
  await savePlaylists(list.filter((p) => !p.id.startsWith(prefix)));
}

export async function updatePlaylist(
  id: string,
  changes: { name?: string; comment?: string; public?: boolean },
): Promise<void> {
  const list = await loadPlaylists();
  await savePlaylists(
    list.map((p) =>
      p.id === id
        ? {
            ...p,
            ...(changes.name !== undefined ? { name: changes.name } : {}),
            ...(changes.comment !== undefined ? { comment: changes.comment } : {}),
          }
        : p,
    ),
  );
}

export async function getStarred(): Promise<Starred> {
  const c = await ensureCatalog();
  const favs = await loadFavs();
  if (!c) return { songs: [], albums: [], artists: [] };
  const favSongIds = new Set(favs.songs);
  const favAlbumIds = new Set(favs.albums);
  const favArtistIds = new Set(favs.artists);
  return {
    songs: c.songs.filter((s) => favSongIds.has(s.id)),
    albums: c.albums.filter((a) => favAlbumIds.has(a.id)).map(toAlbum),
    artists: c.artists.filter((a) => favArtistIds.has(a.id)).map(toArtist),
  };
}

export async function search(query: string): Promise<SearchResult> {
  const c = await ensureCatalog();
  if (!c) return { artists: [], albums: [], songs: [] };
  const q = query.toLowerCase();
  const songs = c.songs.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      (s.artist?.toLowerCase() ?? '').includes(q) ||
      (s.album?.toLowerCase() ?? '').includes(q),
  );
  const albumIds = new Set(songs.map((s) => s.albumId).filter(Boolean));
  const albums = c.albums.filter((a) => a.id && albumIds.has(a.id)).map(toAlbum);
  const artistIds = new Set(songs.map((s) => normKey(s.artist || '')));
  const artists = c.artists.filter((a) => artistIds.has(a.id)).map(toArtist);
  return { artists, albums: albums.slice(0, 20), songs: songs.slice(0, 20) };
}

export { localCoverUrl as coverUrl } from './localLibrary';
