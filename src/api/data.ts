/**
 * Capa de datos unificada. Las pantallas usan estas funciones en lugar de
 * llamar directamente a la API Subsonic. El módulo decide automáticamente
 * si leer del servidor o del catálogo local según el modo (online/offline).
 */
import { useAuthStore } from '@/store/auth';
import { getDownloadsCatalog, useDownloads } from '@/store/downloads';
import {
  enabledFolderIds,
  profileKeyOf,
  readAlbumCache,
  writeAlbumCache,
} from '@/store/libraries';
import { queryClient } from '@/lib/query';
import { useLibraryMirror } from '@/store/libraryMirror';
import { useOfflineQueue, type QueuePlaylist } from '@/store/offlineQueue';
import { useSettings } from '@/store/settings';
import * as Subsonic from './backend';
import * as Local from '@/lib/localQueries';
import type { Song } from './subsonic';

function isOffline() { return useAuthStore.getState().offline; }
function auth() { return useAuthStore.getState().auth!; }

/** Modo offline CON cuenta de servidor (no el perfil local de solo-ficheros):
 *  aquí la Biblioteca es un espejo del servidor (ver store/libraryMirror). */
function serverOffline(): boolean {
  const s = useAuthStore.getState();
  return s.offline && !!s.auth;
}

/**
 * Marca cada canción del espejo como disponible o no según las descargas: las
 * descargadas reciben su `localUri` (se reproducen desde disco); el resto quedan
 * `unavailable` (se pintan en gris y no suenan). En offline el conjunto de
 * descargas no cambia, así que la marca es estable durante la sesión.
 *
 * Carátulas: la descargada re-clava `coverArt` a `albumId` (el índice local va
 * por albumId). La NO descargada conserva el `coverArt` del servidor, para que
 * la URL offline coincida con la de online y expo-image la sirva de su caché
 * (o la baje si el offline es manual con red); si no, queda el placeholder.
 */
function annotate(songs: Song[]): Song[] {
  const files = useDownloads.getState().files;
  // Valoraciones hechas offline (outbox): pisan la nota del espejo para que se
  // vean al momento y persistan tras refrescar o reiniciar, hasta que sincronicen.
  const ratings = useOfflineQueue.getState().data.ratings ?? {};
  // Preferencia: esconder las no descargadas en vez de pintarlas en gris.
  const hideUnavailable = useSettings.getState().hideUnavailableOffline;
  const annotated = songs.map((s0) => {
    const s = ratings[s0.id] !== undefined ? { ...s0, userRating: ratings[s0.id] } : s0;
    const uri = files[s.id];
    return uri
      ? { ...s, coverArt: s.albumId ?? s.coverArt, localUri: uri, unavailable: false }
      : { ...s, unavailable: true };
  });
  return hideUnavailable ? annotated.filter((s) => !s.unavailable) : annotated;
}

/** Carga el espejo y el outbox del perfil, y registra en el índice local las
 *  carátulas de las descargas (sin esto, las carátulas offline no aparecen). */
async function loadMirror(): Promise<void> {
  await Promise.all([
    useLibraryMirror.getState().load(),
    useOfflineQueue.getState().load(),
    getDownloadsCatalog(),
  ]);
}

/** Busca la metadata de una canción por id en lo disponible offline: outbox
 *  (canciones añadidas a listas), espejo (listas/álbumes/favoritos) y descargas. */
function resolveSong(id: string, catalog: { songs: Song[] }): Song | undefined {
  const meta = useOfflineQueue.getState().data.songMeta?.[id];
  if (meta) return meta;
  const mirror = useLibraryMirror.getState().data;
  for (const d of Object.values(mirror.playlistTracks ?? {})) {
    const f = d.songs.find((s) => s.id === id);
    if (f) return f;
  }
  for (const d of Object.values(mirror.albums ?? {})) {
    const f = d.songs.find((s) => s.id === id);
    if (f) return f;
  }
  const st = mirror.starred?.songs?.find((s) => s.id === id);
  if (st) return st;
  return catalog.songs.find((s) => s.id === id);
}

/** Tracklist final deseado de una lista offline: la edición del outbox si la hay,
 *  o el tracklist del espejo. */
async function currentPlaylistSongIds(id: string): Promise<string[]> {
  await loadMirror();
  const edited = useOfflineQueue.getState().data.playlists?.[id]?.songIds;
  if (edited) return edited;
  const d = useLibraryMirror.getState().data.playlistTracks?.[id];
  return (d?.songs ?? []).map((s) => s.id);
}

export type { Album, AlbumListType, Artist, ArtistInfo, FolderContents, FolderEntry, MusicFolder, Playlist, RadioStation, SearchResult, Song, StarType, Starred, SubsonicAuth } from './subsonic';
export { normalizeUrl } from './subsonic';

export function coverArtUrl(id: string | undefined, _size?: number): string | undefined {
  // Si la carátula está descargada (álbum/artista en disco), úsala aunque
  // estemos en modo servidor: funciona sin conexión y no gasta datos, igual
  // que el audio suena desde el fichero descargado.
  const local = Local.coverUrl(id);
  if (local) return local;
  if (isOffline()) {
    // Offline de servidor: la URL del servidor como respaldo. expo-image la sirve
    // de su caché si ya se vio online (o la baja si el offline es manual con red);
    // si no, queda el placeholder. Así las canciones/álbumes no descargados
    // enseñan carátula aunque no se puedan reproducir. El perfil local (sin
    // cuenta) no tiene servidor, así que ahí no hay respaldo.
    return serverOffline() ? Subsonic.coverArtUrl(auth(), id, _size) : undefined;
  }
  return Subsonic.coverArtUrl(auth(), id, _size);
}

export function getAlbumList(type: Subsonic.AlbumListType = 'newest', size?: number, offset?: number): Promise<Subsonic.Album[]> {
  if (isOffline()) return Local.getAlbumList(type, size, offset);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getAlbumList(a, type, size, offset);
  if (ids.length === 1) return Subsonic.getAlbumList(a, type, size, offset, ids[0]);
  return mergedAlbumPage(a, `albums|${type}`, type, ids, size ?? 20, offset ?? 0, (id, s, o) =>
    Subsonic.getAlbumList(a, type, s, o, id),
  );
}

export function getAlbum(id: string): Promise<{ album: Subsonic.Album; songs: Subsonic.Song[] }> {
  if (isOffline()) {
    if (serverOffline()) return mirrorAlbum(id);
    return Local.getAlbum(id);
  }
  return Subsonic.getAlbum(auth(), id).then((res) => {
    useLibraryMirror.getState().saveAlbum(id, res.album, res.songs);
    return res;
  });
}

async function mirrorAlbum(
  id: string,
): Promise<{ album: Subsonic.Album; songs: Subsonic.Song[] }> {
  await loadMirror();
  const d = useLibraryMirror.getState().data.albums?.[id];
  if (!d) return Local.getAlbum(id);
  return { album: { ...d.album, coverArt: d.album.id }, songs: annotate(d.songs) };
}

export function getArtists(): Promise<Subsonic.Artist[]> {
  if (isOffline()) return Local.getArtists();
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getArtists(a);
  if (ids.length === 1) return Subsonic.getArtists(a, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.getArtists(a, id))).then((lists) => {
    const merged = dedupeById(lists.flat());
    merged.sort((x, y) => (x.name ?? '').localeCompare(y.name ?? ''));
    return merged;
  });
}

/** Todos los álbumes locales (modo sin conexión). Solo usado offline. */
export function getAllAlbums(): Promise<Subsonic.Album[]> {
  return Local.getAllAlbums();
}

/** Vuelve a escanear el catálogo local (modo sin conexión). */
export function rescanLocal(): Promise<void> {
  return Local.rescan();
}

/** Géneros del servidor (globales; el API no filtra géneros por biblioteca). */
export function getGenres(): Promise<Subsonic.Genre[]> {
  return Subsonic.getGenres(auth());
}

export function getAlbumsByGenre(genre: string, size?: number, offset?: number): Promise<Subsonic.Album[]> {
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getAlbumsByGenre(a, genre, size, offset);
  if (ids.length === 1) return Subsonic.getAlbumsByGenre(a, genre, size, offset, ids[0]);
  return mergedAlbumPage(
    a,
    `byGenre|${genre}`,
    'alphabeticalByName',
    ids,
    size ?? 30,
    offset ?? 0,
    (id, s, o) => Subsonic.getAlbumsByGenre(a, genre, s, o, id),
  );
}

// ── Navegación por carpetas (solo servidores Subsonic; la UI la oculta en
// Jellyfin y offline) ──────────────────────────────────────────────────────
export function getMusicFolders(): Promise<Subsonic.MusicFolder[]> {
  return Subsonic.getMusicFolders(auth());
}

/** Directorios de más alto nivel de una biblioteca (raíz de las carpetas). */
export function getFolderIndexes(musicFolderId?: string): Promise<Subsonic.FolderEntry[]> {
  return Subsonic.getIndexes(auth(), musicFolderId);
}

/** Contenido de un directorio: subcarpetas + canciones. */
export function getMusicDirectory(id: string): Promise<Subsonic.FolderContents> {
  return Subsonic.getMusicDirectory(auth(), id);
}

export function getArtist(id: string): Promise<{ artist: Subsonic.Artist; albums: Subsonic.Album[] }> {
  if (isOffline()) {
    if (serverOffline()) return mirrorArtist(id);
    return Local.getArtist(id);
  }
  return Subsonic.getArtist(auth(), id).then((res) => {
    useLibraryMirror.getState().saveArtist(id, res.artist, res.albums);
    return res;
  });
}

async function mirrorArtist(
  id: string,
): Promise<{ artist: Subsonic.Artist; albums: Subsonic.Album[] }> {
  await loadMirror();
  const d = useLibraryMirror.getState().data.artists?.[id];
  if (!d) return Local.getArtist(id);
  // Carátulas de los álbumes por su id (así resuelven offline).
  return { artist: d.artist, albums: d.albums.map((al) => ({ ...al, coverArt: al.id })) };
}

export function getArtistInfo(id: string): Promise<Subsonic.ArtistInfo> {
  if (isOffline()) return Promise.resolve(Local.getArtistInfo(id));
  return Subsonic.getArtistInfo(auth(), id);
}

/** Álbumes donde el artista aparece sin ser el artista del álbum. */
export function getAppearsOn(artistId: string, artistName: string): Promise<Subsonic.Album[]> {
  if (isOffline()) return Local.getAppearsOn(artistId);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getAppearsOn(a, artistId, artistName);
  if (ids.length === 1) return Subsonic.getAppearsOn(a, artistId, artistName, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.getAppearsOn(a, artistId, artistName, id))).then(
    (lists) => dedupeById(lists.flat()),
  );
}

export function getTopSongs(artist: string, count?: number): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getTopSongs(artist, count);
  return Subsonic.getTopSongs(auth(), artist, count);
}

/** Canciones parecidas a una dada (sugerencias). Solo online. */
export function getSimilarSongs(id: string, count?: number): Promise<Subsonic.Song[]> {
  if (isOffline()) return Promise.resolve([]);
  return Subsonic.getSimilarSongs(auth(), id, count);
}

/** Canciones más escuchadas (composición sobre álbumes "frequent" en Subsonic). */
export function getMostPlayedSongs(size = 50): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getMostPlayedSongs(size);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getMostPlayedSongs(a, size);
  if (ids.length === 1) return Subsonic.getMostPlayedSongs(a, size, ids[0]);
  return Promise.all(ids.map((fid) => Subsonic.getMostPlayedSongs(a, size, fid))).then((lists) =>
    dedupeById(lists.flat())
      .sort((x, y) => (y.playCount ?? 0) - (x.playCount ?? 0))
      .slice(0, size),
  );
}

/**
 * Canciones al azar de la biblioteca (la mezcla de Inicio).
 *
 * Con varias bibliotecas activas se pide a cada una y se vuelve a barajar el
 * conjunto: si no, saldrían agrupadas por biblioteca, que de aleatorio tiene
 * poco.
 */
export function getRandomSongs(size = 200, genre?: string): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getRandomSongs(size);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getRandomSongs(a, size, genre);
  if (ids.length === 1) return Subsonic.getRandomSongs(a, size, genre, ids[0]);
  return Promise.all(ids.map((fid) => Subsonic.getRandomSongs(a, size, genre, fid))).then((lists) =>
    shuffled(dedupeById(lists.flat())).slice(0, size),
  );
}

export function getPlaylists(): Promise<Subsonic.Playlist[]> {
  if (isOffline()) {
    if (serverOffline()) return mirrorPlaylists();
    return Local.getPlaylists();
  }
  return Subsonic.getPlaylists(auth()).then((list) => {
    useLibraryMirror.getState().savePlaylists(list);
    // Cachea en segundo plano el tracklist de cada lista para que estén
    // disponibles offline sin abrirlas una a una (no bloquea la respuesta).
    void prefetchPlaylistDetails(list);
    return list;
  });
}

/** Evita solapar dos prefetch (getPlaylists puede dispararse varias veces). */
let prefetchingPlaylists = false;

/**
 * En segundo plano, cachea el tracklist de las listas del servidor para el modo
 * offline. Salta las que ya tienen detalle con el mismo `changed` (barato tras
 * la primera sincronización) y limita la concurrencia. Best-effort: ignora
 * fallos y escribe el espejo una sola vez al terminar.
 */
async function prefetchPlaylistDetails(list: Subsonic.Playlist[]): Promise<void> {
  if (prefetchingPlaylists) return;
  const a = useAuthStore.getState().auth;
  if (!a) return;
  prefetchingPlaylists = true;
  try {
    await loadMirror();
    const cached = useLibraryMirror.getState().data.playlistTracks ?? {};
    // Solo las que faltan o cambiaron en el servidor (por `changed`).
    const stale = list.filter((p) => {
      const prev = cached[p.id]?.playlist;
      return !prev || (p.changed != null && prev.changed !== p.changed);
    });
    const results: { id: string; playlist: Subsonic.Playlist; songs: Subsonic.Song[] }[] = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < stale.length; i += CONCURRENCY) {
      const batch = stale.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        batch.map((p) =>
          Subsonic.getPlaylist(a, p.id)
            .then((res) => ({ id: p.id, playlist: res.playlist, songs: res.songs }))
            .catch(() => null),
        ),
      );
      for (const r of settled) if (r) results.push(r);
    }
    useLibraryMirror.getState().savePlaylistDetails(results);
  } finally {
    prefetchingPlaylists = false;
  }
}

/** Listas del espejo: TODAS las del servidor que se hayan visto online (aunque
 *  no tengan nada descargado); dentro, las descargadas suenan y el resto salen
 *  en gris. La carátula usa el primer tema descargado (resuelve offline) o la de
 *  la lista. Sin copia aún, cae al comportamiento local. */
async function mirrorPlaylists(): Promise<Subsonic.Playlist[]> {
  await loadMirror();
  const mirror = useLibraryMirror.getState().data;
  const qpls = useOfflineQueue.getState().data.playlists ?? {};
  const catalog = await getDownloadsCatalog();
  const files = useDownloads.getState().files;
  if (!mirror.playlists && Object.keys(qpls).length === 0) return Local.getPlaylists();

  const out: Subsonic.Playlist[] = [];
  // Listas creadas offline (aún con id temporal).
  for (const [id, edit] of Object.entries(qpls)) {
    if (!edit.created || edit.deleted) continue;
    const songIds = edit.songIds ?? [];
    const firstDl = songIds.find((sid) => files[sid]);
    out.push({
      id,
      name: edit.name ?? '',
      songCount: songIds.length,
      coverArt: firstDl ? resolveSong(firstDl, catalog)?.albumId : undefined,
      comment: edit.comment,
      public: edit.public,
    });
  }
  // Listas del servidor con overlay (renombrado/tracklist), menos las borradas.
  for (const p of mirror.playlists ?? []) {
    const edit = qpls[p.id];
    if (edit?.deleted) continue;
    const detailIds = mirror.playlistTracks?.[p.id]?.songs.map((s) => s.id);
    const songIds = edit?.songIds ?? detailIds ?? [];
    const firstDl = songIds.find((sid) => files[sid]);
    // Con tracklist conocido (detalle cacheado o edición offline) el conteo
    // real; si no, el que trae la lista del servidor.
    const haveTracks = edit?.songIds != null || detailIds != null;
    out.push({
      ...p,
      name: edit?.name ?? p.name,
      songCount: haveTracks ? songIds.length : p.songCount,
      coverArt: firstDl ? resolveSong(firstDl, catalog)?.albumId ?? p.coverArt : p.coverArt,
    });
  }
  return out;
}

export function getStarred(): Promise<Subsonic.Starred> {
  if (isOffline()) {
    if (serverOffline()) return mirrorStarred();
    return Local.getStarred();
  }
  const a = auth();
  const ids = enabledFolderIds(a);
  const p = !ids
    ? Subsonic.getStarred(a)
    : ids.length === 1
      ? Subsonic.getStarred(a, ids[0])
      : Promise.all(ids.map((id) => Subsonic.getStarred(a, id))).then((parts) => ({
          songs: dedupeById(parts.flatMap((x) => x.songs)),
          albums: dedupeById(parts.flatMap((x) => x.albums)),
          artists: dedupeById(parts.flatMap((x) => x.artists)),
        }));
  // Copia para el modo offline (Biblioteca como espejo del servidor).
  return p.then((s) => {
    useLibraryMirror.getState().saveStarred(s);
    return s;
  });
}

/** Favoritos desde el espejo (offline de servidor); si aún no hay copia, cae al
 *  comportamiento local de siempre (derivado de las descargas).
 *
 *  Canciones favoritas: todas, con las no descargadas en gris. Álbumes y
 *  artistas: todos los favoriteados (los álbumes sin descargas se ven igual y
 *  se abren en gris/vacíos, como el resto del contenido no descargado). */
async function mirrorStarred(): Promise<Subsonic.Starred> {
  await loadMirror();
  const mirror = useLibraryMirror.getState().data;
  const catalog = await getDownloadsCatalog();
  await useOfflineQueue.getState().load();
  const favs = useOfflineQueue.getState().data.favs ?? {};
  const hasQueue = Object.keys(favs).length > 0;

  // Base: la foto del servidor. Si aún no hay copia pero hay cambios offline,
  // partimos de lo local para no perder los favoritos hechos sin conexión.
  const base = mirror.starred ?? (hasQueue ? await Local.getStarred() : null);
  if (!base) return Local.getStarred();

  let songs = base.songs ?? [];
  let albums = base.albums ?? [];
  let artists = base.artists ?? [];

  // Overlay del outbox: quitar los desmarcados y añadir los marcados offline.
  const unstarred = new Set(
    Object.entries(favs).filter(([, v]) => !v.starred).map(([id]) => id),
  );
  songs = songs.filter((x) => !unstarred.has(x.id));
  albums = albums.filter((x) => !unstarred.has(x.id));
  artists = artists.filter((x) => !unstarred.has(x.id));

  for (const [id, v] of Object.entries(favs)) {
    if (!v.starred) continue;
    if (v.type === 'album') {
      if (!albums.some((x) => x.id === id)) {
        const a = mirror.albums?.[id]?.album ?? catalog.albums.find((x) => x.id === id);
        if (a) albums = [a, ...albums];
      }
    } else if (v.type === 'artist') {
      if (!artists.some((x) => x.id === id)) {
        const a = mirror.artists?.[id]?.artist;
        if (a) artists = [a, ...artists];
      }
    } else if (!songs.some((x) => x.id === id)) {
      const song = resolveSong(id, catalog);
      if (song) songs = [song, ...songs];
    }
  }

  // Álbumes favoriteados: TODOS, aunque no tengan canciones descargadas (se
  // abren en gris como las canciones no descargadas, o vacíos si nunca se
  // vieron online). Los descargados usan su carátula local (por id); los no
  // descargados conservan la del servidor, que sirve la caché de expo-image si
  // se vio online (o se baja si el offline es manual con red).
  const downloadedAlbumIds = new Set(catalog.albums.map((a) => a.id));
  albums = albums.map((al) =>
    downloadedAlbumIds.has(al.id) ? { ...al, coverArt: al.id } : al,
  );

  return { songs: annotate(songs), albums, artists };
}

export function star(id: string, type?: Subsonic.StarType): Promise<void> {
  if (isOffline()) {
    // Offline de servidor: se apunta en el outbox y se sube al reconectar.
    if (serverOffline()) {
      useOfflineQueue.getState().setFav(id, type ?? 'song', true);
      return Promise.resolve();
    }
    return Local.starLocal(id, type);
  }
  return Subsonic.star(auth(), id, type);
}

export function unstar(id: string, type?: Subsonic.StarType): Promise<void> {
  if (isOffline()) {
    if (serverOffline()) {
      useOfflineQueue.getState().setFav(id, type ?? 'song', false);
      return Promise.resolve();
    }
    return Local.unstarLocal(id, type);
  }
  return Subsonic.unstar(auth(), id, type);
}

/**
 * Vuelca la cola de acciones offline al servidor (al reconectar). Best-effort:
 * lo que falle se conserva para la próxima reconexión. Fase 1: favoritos.
 */
export async function flushOfflineQueue(auth: Subsonic.SubsonicAuth): Promise<void> {
  const q = useOfflineQueue.getState();
  await q.load();

  // Favoritos.
  const favs = q.data.favs ?? {};
  const favFailed: [string, { type: Subsonic.StarType; starred: boolean }][] = [];
  for (const [id, op] of Object.entries(favs)) {
    try {
      if (op.starred) await Subsonic.star(auth, id, op.type);
      else await Subsonic.unstar(auth, id, op.type);
    } catch {
      favFailed.push([id, op]);
    }
  }
  if (Object.keys(favs).length > 0) {
    q.clearFavs();
    for (const [id, op] of favFailed) q.setFav(id, op.type, op.starred);
  }

  // Valoraciones.
  const ratings = q.data.ratings ?? {};
  const ratingFailed: [string, number][] = [];
  for (const [id, rating] of Object.entries(ratings)) {
    try {
      await Subsonic.setRating(auth, id, rating);
    } catch {
      ratingFailed.push([id, rating]);
    }
  }
  if (Object.keys(ratings).length > 0) {
    q.clearRatings();
    for (const [id, rating] of ratingFailed) q.setRating(id, rating);
  }

  // Listas. Se reescribe el estado final de cada una (crear/borrar/renombrar +
  // tracklist entero con reorderPlaylist, que evita el lío de índices).
  const playlists = q.data.playlists ?? {};
  const plFailed: [string, QueuePlaylist][] = [];
  for (const [id, edit] of Object.entries(playlists)) {
    try {
      if (edit.created) {
        if (edit.deleted) continue; // creada y borrada offline: no se sube nada
        const realId = await Subsonic.createPlaylist(auth, edit.name ?? '');
        if (edit.songIds?.length) await Subsonic.reorderPlaylist(auth, realId, edit.songIds);
        if (edit.comment !== undefined || edit.public !== undefined) {
          await Subsonic.updatePlaylist(auth, realId, {
            comment: edit.comment,
            public: edit.public,
          });
        }
      } else if (edit.deleted) {
        await Subsonic.deletePlaylist(auth, id);
      } else {
        if (edit.name !== undefined || edit.comment !== undefined || edit.public !== undefined) {
          await Subsonic.updatePlaylist(auth, id, {
            name: edit.name,
            comment: edit.comment,
            public: edit.public,
          });
        }
        if (edit.songIds) await Subsonic.reorderPlaylist(auth, id, edit.songIds);
      }
    } catch {
      plFailed.push([id, edit]);
    }
  }
  if (Object.keys(playlists).length > 0) {
    q.clearPlaylists();
    for (const [id, edit] of plFailed) q.setPlaylist(id, edit);
  }
}

/**
 * Vuelca al espejo el estado actual de la caché de React Query (listas,
 * favoritos, álbumes) justo antes de pasar a offline. Así, si editas algo online
 * (p. ej. quitas una canción de una lista) y luego te vas offline sin que esa
 * query se re-consultara, el espejo refleja lo último visto en vez de quedarse
 * con la copia vieja del servidor.
 */
export function snapshotCachesToMirror(): void {
  const mirror = useLibraryMirror.getState();
  const playlists = queryClient.getQueryData<Subsonic.Playlist[]>(['playlists']);
  if (playlists) mirror.savePlaylists(playlists);
  for (const [key, data] of queryClient.getQueriesData<{
    playlist: Subsonic.Playlist;
    songs: Song[];
  }>({ queryKey: ['playlist'] })) {
    const id = key[1];
    if (typeof id === 'string' && data?.playlist && Array.isArray(data.songs)) {
      mirror.savePlaylistDetail(id, data.playlist, data.songs);
    }
  }
  const starred = queryClient.getQueryData<Subsonic.Starred>(['starred']);
  if (starred) mirror.saveStarred(starred);
  for (const [key, data] of queryClient.getQueriesData<{
    album: Subsonic.Album;
    songs: Song[];
  }>({ queryKey: ['album'] })) {
    const id = key[1];
    if (typeof id === 'string' && data?.album && Array.isArray(data.songs)) {
      mirror.saveAlbum(id, data.album, data.songs);
    }
  }
}

/** Valora una canción (1-5; 0 quita la valoración). */
export function setRating(id: string, rating: number): Promise<void> {
  if (isOffline()) {
    // Offline de servidor: se apunta en el outbox y se sube al reconectar.
    if (serverOffline()) useOfflineQueue.getState().setRating(id, rating);
    return Promise.resolve();
  }
  return Subsonic.setRating(auth(), id, rating);
}

/**
 * Búsqueda solo de álbumes (para filtrar al explorar). Va al servidor porque
 * la lista de álbumes está paginada: filtrar en cliente solo miraría las
 * páginas ya cargadas.
 */
export function searchAlbums(query: string, count?: number): Promise<Subsonic.Album[]> {
  if (isOffline()) return Local.searchAlbums(query, count);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.searchAlbums(a, query, count);
  if (ids.length === 1) return Subsonic.searchAlbums(a, query, count, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.searchAlbums(a, query, count, id))).then((parts) =>
    dedupeById(parts.flat()),
  );
}

export function search(query: string): Promise<Subsonic.SearchResult> {
  if (isOffline()) return Local.search(query);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.search(a, query);
  if (ids.length === 1) return Subsonic.search(a, query, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.search(a, query, id))).then((parts) => ({
    artists: dedupeById(parts.flatMap((p) => p.artists)),
    albums: dedupeById(parts.flatMap((p) => p.albums)),
    songs: dedupeById(parts.flatMap((p) => p.songs)),
  }));
}

export function scrobble(id: string): Promise<void> {
  if (isOffline()) return Promise.resolve();
  return Subsonic.scrobble(auth(), id);
}

export async function addToPlaylist(playlistId: string, songId: string): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.addToPlaylist(playlistId, songId);
    const ids = await currentPlaylistSongIds(playlistId);
    useOfflineQueue.getState().setPlaylist(playlistId, { songIds: [...ids, songId] });
    // Guarda la metadata de la canción para poder mostrarla en la lista offline.
    const catalog = await getDownloadsCatalog();
    const song = resolveSong(songId, catalog);
    if (song) useOfflineQueue.getState().rememberSongs([song]);
    return;
  }
  return Subsonic.addToPlaylist(auth(), playlistId, songId);
}

/** Crea una playlist vacía y devuelve su id (temporal si es offline). */
export function createPlaylist(name: string): Promise<string> {
  if (isOffline()) {
    if (!serverOffline()) return Local.createPlaylist(name);
    // Id temporal: al reconectar se crea en el servidor y recibe su id real.
    const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    useOfflineQueue.getState().setPlaylist(tmpId, { created: true, name, songIds: [] });
    return Promise.resolve(tmpId);
  }
  return Subsonic.createPlaylist(auth(), name);
}

export async function deletePlaylist(id: string): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.deletePlaylist(id);
    await useOfflineQueue.getState().load();
    const entry = useOfflineQueue.getState().data.playlists?.[id];
    // Creada offline (nunca llegó al servidor): se descarta sin más.
    if (entry?.created) useOfflineQueue.getState().removePlaylistEntry(id);
    else useOfflineQueue.getState().setPlaylist(id, { deleted: true });
    return;
  }
  return Subsonic.deletePlaylist(auth(), id);
}

export function getPlaylist(id: string): Promise<{ playlist: Subsonic.Playlist; songs: Subsonic.Song[] }> {
  if (isOffline()) {
    if (serverOffline()) return mirrorPlaylist(id);
    return Local.getPlaylist(id);
  }
  return Subsonic.getPlaylist(auth(), id).then((res) => {
    useLibraryMirror.getState().savePlaylistDetail(id, res.playlist, res.songs);
    return res;
  });
}

async function mirrorPlaylist(
  id: string,
): Promise<{ playlist: Subsonic.Playlist; songs: Subsonic.Song[] }> {
  await loadMirror();
  const mirror = useLibraryMirror.getState().data;
  const catalog = await getDownloadsCatalog();
  const edit = useOfflineQueue.getState().data.playlists?.[id];
  const detail = mirror.playlistTracks?.[id];

  // Metadatos de la lista: creada offline / espejo / al menos su nombre.
  let playlist: Subsonic.Playlist;
  if (edit?.created) {
    playlist = { id, name: edit.name ?? '', comment: edit.comment, public: edit.public };
  } else if (detail) {
    playlist = { ...detail.playlist };
  } else {
    playlist = mirror.playlists?.find((p) => p.id === id) ?? { id, name: id };
  }
  if (edit?.name !== undefined) playlist = { ...playlist, name: edit.name };
  if (edit?.comment !== undefined) playlist = { ...playlist, comment: edit.comment };
  if (edit?.public !== undefined) playlist = { ...playlist, public: edit.public };

  // Tracklist: la edición del outbox, o el del espejo.
  const songIds = edit?.songIds ?? detail?.songs.map((s) => s.id);
  if (!songIds) {
    // Sin tracklist guardado ni edición: no hay canciones offline.
    return { playlist: { ...playlist, songCount: 0 }, songs: [] };
  }
  const songs = songIds
    .map((sid) => resolveSong(sid, catalog))
    .filter((s): s is Subsonic.Song => !!s);
  // El conteo refleja lo que se muestra (annotate puede ocultar las no descargadas).
  const annotated = annotate(songs);
  return { playlist: { ...playlist, songCount: annotated.length }, songs: annotated };
}

export async function updatePlaylist(
  id: string,
  changes: { name?: string; comment?: string; public?: boolean },
): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.updatePlaylist(id, changes);
    const patch: { name?: string; comment?: string; public?: boolean } = {};
    if (changes.name !== undefined) patch.name = changes.name;
    if (changes.comment !== undefined) patch.comment = changes.comment;
    if (changes.public !== undefined) patch.public = changes.public;
    useOfflineQueue.getState().setPlaylist(id, patch);
    return;
  }
  return Subsonic.updatePlaylist(auth(), id, changes);
}

export async function removeFromPlaylist(id: string, index: number): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.removeFromPlaylist(id, index);
    const ids = await currentPlaylistSongIds(id);
    useOfflineQueue.getState().setPlaylist(id, { songIds: ids.filter((_, i) => i !== index) });
    return;
  }
  return Subsonic.removeFromPlaylist(auth(), id, index);
}

/** Reescribe el orden de una lista (arrastrar y soltar). */
export async function reorderPlaylist(id: string, songIds: string[]): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.reorderPlaylist(id, songIds);
    useOfflineQueue.getState().setPlaylist(id, { songIds });
    return;
  }
  return Subsonic.reorderPlaylist(auth(), id, songIds);
}

// ── Fusión de varias bibliotecas (modo subconjunto) ──
//
// El API Subsonic solo filtra por una biblioteca por petición, así que cuando
// hay varias activas se consulta cada una y se fusionan los resultados aquí.

/** Baraja una copia (Fisher-Yates). */
function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Quita duplicados por id conservando el primero visto. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/** Trae la lista completa de álbumes paginando hasta el final. */
async function fetchAllAlbums(
  fetchPage: (size: number, offset: number) => Promise<Subsonic.Album[]>,
): Promise<Subsonic.Album[]> {
  const PAGE = 500;
  const out: Subsonic.Album[] = [];
  for (let offset = 0; offset <= 20000; offset += PAGE) {
    const chunk = await fetchPage(PAGE, offset);
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

/**
 * Fusiona las listas por-biblioteca (cada una ya ordenada por el servidor según
 * `type`). Cuando hay clave de orden disponible en el álbum (nombre, artista,
 * favorito) se reordena de verdad; para el resto (recientes/añadidos/frecuentes,
 * cuyos campos no vienen en el álbum) se intercalan en round-robin para no
 * amontonar una biblioteca antes que otra.
 */
function mergeAlbums(perFolder: Subsonic.Album[][], type: Subsonic.AlbumListType): Subsonic.Album[] {
  if (type === 'alphabeticalByName') {
    return dedupeById(perFolder.flat()).sort((a, b) => a.name.localeCompare(b.name));
  }
  if (type === 'alphabeticalByArtist') {
    return dedupeById(perFolder.flat()).sort(
      (a, b) => (a.artist ?? '').localeCompare(b.artist ?? '') || a.name.localeCompare(b.name),
    );
  }
  if (type === 'starred') {
    return dedupeById(perFolder.flat()).sort((a, b) => (b.starred ?? '').localeCompare(a.starred ?? ''));
  }
  // Intercalado round-robin conservando el orden interno de cada biblioteca.
  const interleaved: Subsonic.Album[] = [];
  const max = Math.max(0, ...perFolder.map((f) => f.length));
  for (let i = 0; i < max; i++) {
    for (const folder of perFolder) {
      if (folder[i]) interleaved.push(folder[i]);
    }
  }
  return dedupeById(interleaved);
}

/**
 * Sirve una página de la lista fusionada de varias bibliotecas. La lista
 * completa se cachea un rato para no rehacer el trabajo en cada página del
 * scroll infinito.
 */
async function mergedAlbumPage(
  a: Subsonic.SubsonicAuth,
  cacheBase: string,
  type: Subsonic.AlbumListType,
  ids: string[],
  size: number,
  offset: number,
  fetchOne: (id: string, size: number, offset: number) => Promise<Subsonic.Album[]>,
): Promise<Subsonic.Album[]> {
  const cacheKey = `${cacheBase}|${profileKeyOf(a)}|${ids.join(',')}`;
  let all = readAlbumCache<Subsonic.Album>(cacheKey);
  if (!all) {
    const perFolder = await Promise.all(ids.map((id) => fetchAllAlbums((s, o) => fetchOne(id, s, o))));
    all = mergeAlbums(perFolder, type);
    writeAlbumCache(cacheKey, all);
  }
  return all.slice(offset, offset + size);
}
