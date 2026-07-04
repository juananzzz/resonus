/**
 * Descargas sin conexión (servidor → dispositivo).
 *
 * Los ficheros van al almacenamiento privado de la app
 * (`documentDirectory/downloads/<hash del servidor>/`) y junto a ellos se
 * guarda un catálogo JSON con los metadatos que ya conocemos del servidor
 * (título, artista, álbum, ids, carátula) — sin re-escanear ID3. El perfil
 * local fusiona este catálogo con el escaneo del origen elegido
 * (`localQueries.ensureCatalog`). Como MediaStore y SAF no ven el directorio
 * privado, la fusión nunca produce duplicados.
 *
 * Los ids se conservan tal cual vienen del servidor (canción y álbum), lo que
 * permite el badge ↓ en cualquier perfil y, a futuro, scrobbling diferido o
 * re-descarga en otra calidad. El id de artista se normaliza a la clave local
 * (`normKey(nombre)`) para que los artistas se fusionen con los del escaneo.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import {
  coverArtUrl,
  downloadUrl,
  getLyrics,
  getLyricsBySongId,
  streamUrl,
  type Album,
  type Artist,
  type Playlist,
  type Song,
  type SongLyrics,
  type SubsonicAuth,
} from '@/api/backend';
import { tg } from '@/i18n';
import { hashKey, normKey, registerCover } from '@/lib/localLibrary';
import { serializeLrc } from '@/lib/lrc';
import { siblingLrcUri } from '@/lib/localLyrics';
import { queryClient } from '@/lib/query';
import { useAuthStore } from './auth';
import { useSettings } from './settings';
import { useToast } from './toast';

const ROOT_DIR = FileSystem.documentDirectory + 'downloads/';
const CONCURRENCY = 3;

/** Álbum descargado: el del servidor + carátula local y fecha de descarga. */
type DlAlbum = Album & { coverUri?: string; addedAt?: number };

/** Catálogo persistido por servidor (canciones con `localUri` + álbumes). */
interface ServerDownloads {
  songs: Song[];
  albums: DlAlbum[];
}

interface GroupProgress {
  done: number;
  total: number;
  /** Fracción (0..1) del fichero en curso, para que la barra avance entre canciones. */
  fraction: number;
}

/** Vista fusionable por el perfil local (artistas derivados de los álbumes). */
export interface DownloadsCatalog {
  songs: Song[];
  albums: DlAlbum[];
  artists: (Artist & { coverUri?: string })[];
}

function serverDir(auth: SubsonicAuth): string {
  return `${ROOT_DIR}${hashKey(`${auth.serverUrl}|${auth.username}`)}/`;
}

function catalogFile(dir: string): string {
  return `${dir}catalog.json`;
}

async function readServerCatalog(dir: string): Promise<ServerDownloads | null> {
  try {
    const info = await FileSystem.getInfoAsync(catalogFile(dir));
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(catalogFile(dir));
    return JSON.parse(raw) as ServerDownloads;
  } catch {
    return null;
  }
}

async function writeServerCatalog(dir: string, catalog: ServerDownloads): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(catalogFile(dir), JSON.stringify(catalog));
  } catch {
    // Si no se puede persistir, las descargas de esta sesión se pierden al
    // reiniciar (los ficheros quedan huérfanos hasta un "borrar todo").
  }
}

/**
 * Serializa los read-modify-write de catalog.json: varios grupos pueden
 * descargar a la vez y sin esto la última escritura pisaría a las demás.
 */
let catalogLock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = catalogLock.then(fn);
  catalogLock = run.catch(() => {});
  return run;
}

/** Añade una canción/álbumes al catálogo de un servidor (bajo el lock). */
function commitToCatalog(
  dir: string,
  changes: { songs?: Song[]; albums?: DlAlbum[] },
): Promise<void> {
  return locked(async () => {
    const catalog = (await readServerCatalog(dir)) ?? { songs: [], albums: [] };
    for (const al of changes.albums ?? []) {
      if (!catalog.albums.some((a) => a.id === al.id)) catalog.albums.push(al);
    }
    for (const s of changes.songs ?? []) {
      if (!catalog.songs.some((x) => x.id === s.id)) catalog.songs.push(s);
    }
    // Los álbumes reflejan cuántas canciones hay realmente descargadas.
    for (const a of catalog.albums) {
      a.songCount = catalog.songs.filter((s) => s.albumId === a.id).length;
    }
    await writeServerCatalog(dir, catalog);
  });
}

/** Todos los directorios de servidor con descargas. */
async function serverDirs(): Promise<string[]> {
  try {
    const entries = await FileSystem.readDirectoryAsync(ROOT_DIR);
    return entries.map((e) => `${ROOT_DIR}${e}/`);
  } catch {
    return []; // ROOT_DIR aún no existe
  }
}

// ── Catálogo fusionable (todas las cuentas), cacheado en memoria ────────────

let mergedCache: DownloadsCatalog | null = null;

function deriveArtists(albums: DlAlbum[]): (Artist & { coverUri?: string })[] {
  const map = new Map<string, Artist & { coverUri?: string }>();
  for (const al of albums) {
    const name = al.artist || 'Artista desconocido';
    const key = normKey(name);
    const existing = map.get(key);
    if (existing) {
      existing.albumCount = (existing.albumCount ?? 0) + 1;
      if (!existing.coverUri) existing.coverUri = al.coverUri;
    } else {
      map.set(key, { id: key, name, coverArt: key, albumCount: 1, coverUri: al.coverUri });
    }
  }
  return Array.from(map.values());
}

/**
 * Catálogo de descargas de todas las cuentas, listo para fusionar con el
 * escaneo local. Registra las carátulas en el índice global al construirse.
 */
export async function getDownloadsCatalog(): Promise<DownloadsCatalog> {
  if (!mergedCache) {
    const songs: Song[] = [];
    const albums: DlAlbum[] = [];
    for (const dir of await serverDirs()) {
      const cat = await readServerCatalog(dir);
      if (!cat) continue;
      songs.push(...cat.songs);
      albums.push(...cat.albums);
    }
    mergedCache = { songs, albums, artists: deriveArtists(albums) };
  }
  // Siempre (no solo al construir): clearLocalCatalog() vacía el índice global
  // de carátulas y hay que volver a apuntar las de las descargas.
  for (const a of mergedCache.albums) registerCover(a.id, a.coverUri);
  for (const a of mergedCache.artists) registerCover(a.id, a.coverUri);
  return mergedCache;
}

function invalidate() {
  mergedCache = null;
  // Las pantallas cachean listas con react-query; el catálogo acaba de cambiar.
  void queryClient.invalidateQueries();
}

// ── Descarga de ficheros ─────────────────────────────────────────────────────

function songFileUrl(auth: SubsonicAuth, song: Song): { url: string; ext: string } {
  const bitrate = useSettings.getState().downloadBitRate;
  if (bitrate > 0) {
    return { url: streamUrl(auth, song.id, bitrate), ext: 'mp3' };
  }
  return { url: downloadUrl(auth, song.id), ext: song.suffix || 'mp3' };
}

/** Canción tal y como entra al catálogo local: id de servidor + fichero local. */
function toLocalSong(song: Song, fileUri: string): Song {
  return {
    ...song,
    localUri: fileUri,
    // Id de artista local (por nombre) para fusionar con los artistas del escaneo.
    artistId: normKey(song.artist || 'Artista desconocido'),
    coverArt: song.albumId,
    addedAt: Date.now(),
    // El favorito de servidor no aplica al perfil local (usa favoritos locales).
    starred: undefined,
  };
}

function toLocalAlbum(album: Album, coverUri?: string): DlAlbum {
  return {
    ...album,
    artistId: normKey(album.artist || 'Artista desconocido'),
    coverArt: album.id,
    coverUri,
    addedAt: Date.now(),
  };
}

/** Álbum sintetizado desde una canción (playlists con álbumes no descargados enteros). */
function albumFromSong(song: Song): Album {
  return {
    id: song.albumId ?? `dl-${hashKey(song.album || song.id)}`,
    name: song.album || 'Álbum desconocido',
    artist: song.artist,
    year: song.year,
  };
}

/**
 * Cachea la letra de una canción recién descargada como `.lrc` junto al
 * fichero, para que el perfil local la encuentre sin red (fase 2 de letras).
 * Sin letra (o sin extensión songLyrics en el servidor) no pasa nada.
 */
async function cacheLyricsForDownload(auth: SubsonicAuth, song: Song, audioFile: string): Promise<void> {
  try {
    let lyrics: SongLyrics | null = null;
    try {
      lyrics = await getLyricsBySongId(auth, song.id);
    } catch {
      // Servidor sin la extensión songLyrics: probamos el endpoint clásico.
    }
    if (!lyrics) {
      const plain = await getLyrics(auth, song.artist ?? '', song.title);
      if (plain) lyrics = { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
    }
    if (!lyrics) return;
    const lrcFile = siblingLrcUri(audioFile);
    if (lrcFile) await FileSystem.writeAsStringAsync(lrcFile, serializeLrc(lyrics));
  } catch {
    // La descarga vale igual sin letra.
  }
}

async function downloadCover(auth: SubsonicAuth, dir: string, album: Album): Promise<string | undefined> {
  const url = coverArtUrl(auth, album.coverArt ?? album.id, 500);
  if (!url) return undefined;
  const file = `${dir}covers/${hashKey(album.id)}.jpg`;
  try {
    const existing = await FileSystem.getInfoAsync(file);
    if (existing.exists) return file;
    await FileSystem.makeDirectoryAsync(`${dir}covers/`, { intermediates: true }).catch(() => {});
    const res = await FileSystem.downloadAsync(url, file);
    return res.status === 200 ? file : undefined;
  } catch {
    return undefined;
  }
}

interface DownloadsState {
  /** id de canción (de servidor) → uri del fichero descargado. */
  files: Record<string, string>;
  /** Progreso por grupo en curso: `album:<id>` / `playlist:<id>`. */
  active: Record<string, GroupProgress>;
  hydrate: () => Promise<void>;
  downloadAlbum: (album: Album, songs: Song[]) => Promise<void>;
  downloadPlaylist: (playlist: Playlist, songs: Song[]) => Promise<void>;
  /** Descarga todas las canciones favoritas (grupo 'favorites'). */
  downloadFavorites: (songs: Song[]) => Promise<void>;
  downloadSong: (song: Song) => Promise<void>;
  /** Borra los ficheros de esas canciones y las quita del catálogo. */
  deleteSongs: (songIds: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
  usageBytes: () => Promise<number>;
}

export const useDownloads = create<DownloadsState>((set, get) => {
  /** Descarga un grupo de canciones y actualiza catálogo + progreso. */
  async function downloadGroup(groupKey: string, songs: Song[], albums: Album[]): Promise<void> {
    const auth = useAuthStore.getState().auth;
    if (!auth) return;
    if (get().active[groupKey]) return; // ya en curso
    // Sin repetidas (una playlist puede traer la misma canción dos veces) ni
    // ya descargadas, radios (url) o canciones que ya son locales.
    const seen = new Set<string>();
    const pending = songs.filter((s) => {
      if (get().files[s.id] || s.url || s.localUri || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    if (pending.length === 0) return;

    const dir = serverDir(auth);
    set((st) => ({ active: { ...st.active, [groupKey]: { done: 0, total: pending.length, fraction: 0 } } }));

    try {
      await FileSystem.makeDirectoryAsync(`${dir}files/`, { intermediates: true }).catch(() => {});

      // Carátulas y entradas de álbum primero (idempotente si ya existían).
      const albumEntries: DlAlbum[] = [];
      for (const album of albums) {
        const coverUri = await downloadCover(auth, dir, album);
        albumEntries.push(toLocalAlbum(album, coverUri));
      }
      await commitToCatalog(dir, { albums: albumEntries });

      let failed = 0;
      let next = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
        while (next < pending.length) {
          const song = pending[next++];
          const { url, ext } = songFileUrl(auth, song);
          const file = `${dir}files/${hashKey(song.id)}.${ext}`;
          try {
            const task = FileSystem.createDownloadResumable(url, file, {}, (p) => {
              if (p.totalBytesExpectedToWrite > 0) {
                const fraction = p.totalBytesWritten / p.totalBytesExpectedToWrite;
                const cur = get().active[groupKey];
                // Actualiza con grano grueso para no re-renderizar sin parar.
                if (cur && fraction - cur.fraction > 0.05) {
                  set((st) => ({
                    active: { ...st.active, [groupKey]: { ...cur, fraction } },
                  }));
                }
              }
            });
            const res = await task.downloadAsync();
            if (!res || res.status !== 200) throw new Error(`HTTP ${res?.status}`);
            await cacheLyricsForDownload(auth, song, file);
            // Cada canción se persiste al completarse: si la app muere a mitad
            // de un álbum, lo ya bajado sobrevive al reinicio.
            await commitToCatalog(dir, { songs: [toLocalSong(song, file)] });
            set((st) => {
              const cur = st.active[groupKey];
              return {
                files: { ...st.files, [song.id]: file },
                active: cur
                  ? { ...st.active, [groupKey]: { ...cur, done: cur.done + 1, fraction: 0 } }
                  : st.active,
              };
            });
          } catch {
            failed++;
            await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
          }
        }
      });
      await Promise.all(workers);

      invalidate();
      if (failed > 0) {
        useToast.getState().show(tg("{n} songs couldn't be downloaded", { n: failed }));
      }
    } finally {
      set((st) => {
        const active = { ...st.active };
        delete active[groupKey];
        return { active };
      });
    }
  }

  return {
    files: {},
    active: {},

    hydrate: async () => {
      const files: Record<string, string> = {};
      for (const dir of await serverDirs()) {
        const cat = await readServerCatalog(dir);
        for (const s of cat?.songs ?? []) {
          if (s.localUri) files[s.id] = s.localUri;
        }
      }
      set({ files });
    },

    downloadAlbum: async (album, songs) => {
      await downloadGroup(`album:${album.id}`, songs, [album]);
    },

    downloadSong: async (song) => {
      await downloadGroup(`song:${song.id}`, [song], [albumFromSong(song)]);
    },

    downloadPlaylist: async (playlist, songs) => {
      // Álbumes implicados: los de las canciones (entrada parcial si hace falta).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      await downloadGroup(`playlist:${playlist.id}`, songs, Array.from(byId.values()));
      // La playlist también existe en el perfil local, con sus ids de servidor.
      const downloadedIds = songs.map((s) => s.id).filter((id) => get().files[id]);
      if (downloadedIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        await require('@/lib/localQueries').upsertLocalPlaylist(
          `dl_${playlist.id}`,
          playlist.name,
          downloadedIds,
          playlist.comment,
        );
      }
    },

    downloadFavorites: async (songs) => {
      // Álbumes implicados: los de las canciones (entrada parcial si hace falta).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      await downloadGroup('favorites', songs, Array.from(byId.values()));
    },

    deleteSongs: async (songIds) => {
      const ids = new Set(songIds);
      await locked(async () => {
        for (const dir of await serverDirs()) {
          const catalog = await readServerCatalog(dir);
          if (!catalog || !catalog.songs.some((s) => ids.has(s.id))) continue;
          for (const s of catalog.songs) {
            if (ids.has(s.id) && s.localUri) {
              await FileSystem.deleteAsync(s.localUri, { idempotent: true }).catch(() => {});
              // También la letra cacheada junto al fichero, si la hay.
              const lrc = siblingLrcUri(s.localUri);
              if (lrc) await FileSystem.deleteAsync(lrc, { idempotent: true }).catch(() => {});
            }
          }
          catalog.songs = catalog.songs.filter((s) => !ids.has(s.id));
          // Álbumes que se quedan sin canciones: fuera (y su carátula).
          const emptyAlbums = catalog.albums.filter(
            (a) => !catalog.songs.some((s) => s.albumId === a.id),
          );
          for (const a of emptyAlbums) {
            if (a.coverUri) await FileSystem.deleteAsync(a.coverUri, { idempotent: true }).catch(() => {});
          }
          catalog.albums = catalog.albums.filter((a) => !emptyAlbums.includes(a));
          for (const a of catalog.albums) {
            a.songCount = catalog.songs.filter((s) => s.albumId === a.id).length;
          }
          await writeServerCatalog(dir, catalog);
        }
      });
      set((st) => {
        const files = { ...st.files };
        for (const id of songIds) delete files[id];
        return { files };
      });
      invalidate();
    },

    clearAll: async () => {
      await locked(() => FileSystem.deleteAsync(ROOT_DIR, { idempotent: true }).catch(() => {}));
      // Las playlists locales creadas por descargas ya no resuelven canciones;
      // se eliminan para no dejar listas vacías.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require('@/lib/localQueries').deleteLocalPlaylistsByPrefix('dl_');
      set({ files: {}, active: {} });
      invalidate();
    },

    usageBytes: async () => {
      let total = 0;
      for (const dir of await serverDirs()) {
        for (const sub of ['files/', 'covers/']) {
          try {
            const entries = await FileSystem.readDirectoryAsync(dir + sub);
            for (const e of entries) {
              const info = await FileSystem.getInfoAsync(dir + sub + e);
              if (info.exists) total += ((info as any).size as number) || 0;
            }
          } catch {
            // subcarpeta inexistente
          }
        }
      }
      return total;
    },
  };
});

/** Estado del botón de descarga de un grupo (cabecera de álbum/playlist). */
export function groupDownloadState(
  st: Pick<DownloadsState, 'files' | 'active'>,
  groupKey: string,
  songIds: string[],
): { status: 'none' | 'active' | 'done'; progress: number } {
  const g = st.active[groupKey];
  if (g) return { status: 'active', progress: (g.done + g.fraction) / Math.max(1, g.total) };
  const relevant = songIds.filter(Boolean);
  if (relevant.length > 0 && relevant.every((id) => st.files[id])) {
    return { status: 'done', progress: 1 };
  }
  return { status: 'none', progress: 0 };
}
