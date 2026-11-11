/**
 * Local catalog queries mirroring the Subsonic API.
 * Loads the catalog on demand if it isn't in memory yet.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { tg } from '@/i18n';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { usePlayCounts } from '@/store/playCounts';
import { usePlayHistory } from '@/store/playHistory';
import { type Album, type Artist, type ArtistInfo, type FolderContents, type GuestAlbum, type MusicFolder, type Playlist, type SearchResult, type Song, type SongListSort, type StarType, type Starred } from '@/api/subsonic';
import { queryClient } from '@/lib/query';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import { activeServerDir, getDownloadShelf, getDownloadsCatalog } from '@/store/downloads';
import * as Cat from './downloadsDb';
import * as LocalCat from './localDb';
import {
  clearLocalCatalog,
  clearLocalCatalogDisk,
  ensureScanned,
  folderNameFromUri,
  getLocalCatalog,
  hashKey,
  localCheckedAt,
  localPlaylistFiles,
  loadDeviceSongs,
  folderSetKey,
  loadFolderSongs,
  normKey,
  refreshSource,
  registerCover,
  writeTextToFolder,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
} from './localLibrary';
import { baseOf, buildM3u, commonRoot, dirOf, folderTree, m3uMatcher, parseM3u, pathOfTree, pathOfUri, type FolderNode } from './localPaths';

// Local favorites and playlists are PER PROFILE (each account/profile has its
// own): stored under `<base>.<profile hash>`. The bare base key is the old
// (shared) version; only the local profile inherits it (migration).
const FAVS_KEY = 'resonus.localFavorites';

/** Favorites key for the active profile. */
function favsKey(): string {
  return `${FAVS_KEY}.${hashKey(profileScopeId())}`;
}

interface LocalFavStore {
  songs: string[];
  albums: string[];
  artists: string[];
}

// The cache is tagged with the profile key it was loaded for: if the profile
// changes, `loadFavs` discards it and re-reads on its own (without relying on
// someone calling clearLocalFavs on every transition).
let favCache: LocalFavStore | null = null;
let favCacheKey: string | null = null;

async function loadFavs(): Promise<LocalFavStore> {
  const key = favsKey();
  if (favCache && favCacheKey === key) return favCache;
  favCacheKey = key;
  try {
    // The local profile inherits the favorites from the old (global) key until
    // something changes; every other profile starts empty.
    const raw =
      (await getItem(key)) ??
      (profileScopeId() === 'local' ? await getItem(FAVS_KEY) : null);
    favCache = raw ? (JSON.parse(raw) as LocalFavStore) : { songs: [], albums: [], artists: [] };
  } catch {
    favCache = { songs: [], albums: [], artists: [] };
  }
  return favCache;
}

async function saveFavs(favs: LocalFavStore) {
  const key = favsKey();
  favCache = favs;
  favCacheKey = key;
  await setItem(key, JSON.stringify(favs));
  // Migration: now that we write under the profile key, drop the inherited global one.
  if (profileScopeId() === 'local') await deleteItem(FAVS_KEY);
}

/**
 * `playlist` is not one of these and is dropped rather than mis-filed.
 *
 * This store has three lists and Subsonic's three kinds of favourite; a
 * favourite playlist is Navidrome's own and lives only on its server (see
 * `StarType`). Without saying so, the `else` below would file a playlist id
 * among the songs, where it would come back out as a song that does not exist.
 * Nothing reaches this with one today, since the heart is not offered
 * offline, and this is what keeps that from mattering.
 */
export async function starLocal(id: string, type?: StarType) {
  if (type === 'playlist') return;
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

/** See `starLocal`: a playlist is not one of the three lists here. */
export async function unstarLocal(id: string, type?: StarType) {
  if (type === 'playlist') return;
  const favs = await loadFavs();
  if (type === 'album' || type === 'artist') {
    const key = type === 'album' ? 'albums' : 'artists';
    favs[key] = favs[key].filter((x) => x !== id);
  } else {
    favs.songs = favs.songs.filter((x) => x !== id);
  }
  await saveFavs(favs);
}

/**
 * Forgets a scan in flight, so the next call starts one for the source that is
 * current now. Without it, changing folders mid-scan would wait for the old
 * one and then look for a catalog under the new key, which nobody built.
 */
export function resetLocalLoading(): void {
  loadingPromise = null;
  scanning = null;
  lastCheck = 0;
}

/** Clears the favorites cache (on source change). */
export function clearLocalFavs() {
  favCache = null;
  favCacheKey = null;
}

function sourceInfo() {
  const { offlineSource } = useAuthStore.getState();
  const uris = offlineSource?.mode === 'folder' ? offlineSource.uris : [];
  return {
    mode: offlineSource?.mode ?? 'device',
    uris,
    // The whole set is what the catalog is cached under, so adding a folder is
    // a different catalog and not a stale one.
    key: uris.length > 0 ? folderSetKey(uris) : undefined,
  };
}

let loadingPromise: Promise<any> | null = null;

/** Minimal shape shared by album/artist between the scan and the downloads. */
interface CatAlbum {
  id: string;
  name: string;
  artist?: string;
  coverUri?: string;
  songCount?: number;
  year?: number;
  addedAt?: number;
  // Persisted by `toLocalAlbum` (it spreads the full server Album), so multi-disc
  // subtitles survive offline; the narrow shape just has to keep them typed.
  discTitles?: Album['discTitles'];
  // Same story, and the reason an offline discography was one undivided shelf:
  // what kind of record this is was in the catalog all along and stopped here,
  // at the shape that describes it (see `releaseGroups`).
  releaseTypes?: Album['releaseTypes'];
  isCompilation?: Album['isCompilation'];
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

/** Catalog for the chosen source (device/folder), loading it if needed. */
async function ensureScanCatalog() {
  const { mode, uris, key } = sourceInfo();
  const cached = getLocalCatalog(mode, key);
  if (cached) return cached;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      try {
        if (mode === 'folder' && uris.length > 0) {
          await loadFolderSongs(uris);
        } else {
          await loadDeviceSongs();
        }
      } finally {
        loadingPromise = null;
      }
      // A catalog just appeared where there was none, so whatever the screens
      // have cached predates the music existing: without this, Home stays empty
      // until you refresh it by hand. Same as what downloads and libraries do
      // when their catalog changes.
      void queryClient.invalidateQueries();
    })();
  }
  await loadingPromise;
  return getLocalCatalog(mode, key);
}

/**
 * Offline-mode catalog, depending on who is active:
 *   - Server account offline (`auth` present): ONLY the server's downloads.
 *   - Local profile (no `auth`): ONLY the music on the chosen device/folder.
 *
 * They are different things: the local profile is for music you have on the
 * phone, and the server's downloads have their own mode (the server account
 * without a connection). That's why they are no longer merged.
 */
async function ensureCatalog(): Promise<MergedCatalog | null> {
  if (useAuthStore.getState().auth) {
    const dl = await getDownloadsCatalog().catch(() => ({ songs: [], albums: [], artists: [] }));
    if (dl.songs.length === 0) return null;
    return { songs: dl.songs, albums: dl.albums, artists: dl.artists };
  }
  // Local profile: only the scan of the chosen source (no downloads).
  if (!useAuthStore.getState().offlineSource) return null;
  return (await ensureScanCatalog().catch(() => undefined)) ?? null;
}


/**
 * The downloads catalog, when that is what is being browsed, as a database
 * rather than as a list in memory.
 *
 * The queries below take this road when it is there: a server account offline
 * browses its downloads, and on a library of fifteen thousand songs sorting or
 * searching them in JavaScript means walking all of them for a screen that
 * shows twenty. The local profile keeps the in-memory catalog it has always
 * had, which is the music on the phone and a different size of problem.
 *
 * Null means "not that source", and every caller falls back to what it did
 * before, which is also what happens if a query throws.
 */
function downloadsDir(): string | null {
  if (!useAuthStore.getState().auth) return null;
  return activeServerDir();
}

/** For the handful of queries that mean "all of them": SQLite takes a limit
 *  and there is no library this does not cover. */
const ALL_ROWS = 1_000_000;

/** A scan in progress, so that six screens asking at once on a cold start
 *  produce one of them and not six. */
let scanning: Promise<{ src: LocalCat.Source; scanned: boolean }> | null = null;

/**
 * The local profile's catalog, as a database to ask, scanning the source first
 * if it has never been read.
 *
 * Null when this is not the local profile: a server account with no connection
 * browses its downloads, which is a different catalog next door, and a profile
 * that has not been told where its music is has nothing to ask.
 *
 * The twin of `downloadsDir` above, and the queries below use them the same
 * way: the database answers with the rows a screen draws, and the catalog in
 * memory is what is left for when it cannot.
 */
async function localSrc(): Promise<LocalCat.Source | null> {
  const state = useAuthStore.getState();
  if (state.auth || !state.offlineSource) return null;
  const { mode, uris } = sourceInfo();
  if (mode === 'folder' && uris.length === 0) return null;
  if (!scanning) {
    scanning = ensureScanned(mode, uris).finally(() => {
      scanning = null;
    });
  }
  const { src, scanned } = await scanning;
  // A library just appeared where there was none, so whatever the screens have
  // cached predates the music existing.
  if (scanned) void queryClient.invalidateQueries();
  return src;
}

/**
 * Rescans the local source: discards the cached catalog (and the covers) and
 * rebuilds it by reading the files' tags again. Useful after adding or
 * changing music without restarting the app.
 */
export async function rescan(): Promise<void> {
  clearLocalCatalog();
  await clearLocalCatalogDisk();
  loadingPromise = null;
  scanning = null;
  tree = null;
  // Through the database on the local profile, which is what reads it from now
  // on: `ensureCatalog` would rebuild the whole library in memory to answer a
  // question nobody asked.
  if (!(await localSrc())) await ensureCatalog();
}

// ── Keeping up with the files ───────────────────────────────────────────────

/** A check walks every folder, so coming back to the app does not start one
 *  each time. */
const CHECK_EVERY_MS = 5 * 60_000;
let lastCheck = 0;
let checking: Promise<boolean> | null = null;

/**
 * Looks for music that was added or removed since the catalog was made, and
 * for playlist files. True if anything on screen is now out of date.
 */
export function refreshLocal(force = false): Promise<boolean> {
  if (checking) return checking;
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return Promise.resolve(false);
  checking = (async () => {
    const src = await localSrc();
    if (!src) return false;
    lastCheck = Date.now();
    const { mode, uris } = sourceInfo();
    const changed = await refreshSource(mode, uris);
    if (changed) tree = null;
    // Asked again: the folders may have been changed while this walked them.
    const now = sourceInfo();
    if (now.mode !== mode || now.key !== (uris.length > 0 ? folderSetKey(uris) : undefined)) return false;
    const imported = await importPlaylistFiles(src, localPlaylistFiles(mode, uris));
    if (changed || imported) void queryClient.invalidateQueries();
    return changed || imported;
  })()
    .catch(() => false)
    .finally(() => {
      checking = null;
    });
  return checking;
}

/** How much music the local profile has, and when it was last looked at. */
export async function localInfo(): Promise<{ songs: number; checkedAt: number } | null> {
  const src = await localSrc();
  if (!src) return null;
  const { mode, uris } = sourceInfo();
  return { songs: await LocalCat.songCount(src), checkedAt: await localCheckedAt(mode, uris) };
}

// ── Folders ─────────────────────────────────────────────────────────────────

/** The folders with music in them, worked out once per catalog: ids and paths
 *  only, never the songs. */
let tree: { name: string; map: Map<string, FolderNode> } | null = null;

async function localTree(src: LocalCat.Source): Promise<Map<string, FolderNode>> {
  if (tree?.name === src.name) return tree.map;
  const map = folderTree(await LocalCat.songUris(src));
  tree = { name: src.name, map };
  return map;
}

/** Where browsing by folder starts: the chosen folders, or the one all of the
 *  device's music is under. */
export async function getMusicFolders(): Promise<MusicFolder[]> {
  const src = await localSrc();
  if (!src) return [];
  const { mode, uris } = sourceInfo();
  if (mode === 'folder') {
    return uris.map((uri) => ({ id: pathOfTree(uri), name: folderNameFromUri(uri) }));
  }
  const root = commonRoot(await localTree(src));
  return [{ id: root, name: baseOf(root) || root }];
}

export async function getMusicDirectory(id: string): Promise<FolderContents> {
  const src = await localSrc();
  const node = src ? (await localTree(src)).get(id) : undefined;
  if (!src || !node) return { id, name: baseOf(id), dirs: [], songs: [] };
  const map = await localTree(src);
  const found = await LocalCat.songsByIds(src, node.songs);
  const songs = node.songs
    .map((songId) => found.get(songId))
    .filter((song): song is Song => !!song)
    .sort(
      (a, b) =>
        (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
        (a.track ?? Infinity) - (b.track ?? Infinity) ||
        a.title.localeCompare(b.title),
    );
  const dirs = [...node.dirs]
    .map((path) => ({ id: path, name: baseOf(path), coverArt: map.get(path)?.albumId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { id, name: baseOf(id), dirs, songs };
}

// An album and an artist with nothing to go by are grouped under a name that
// cannot change, because it is their id (see localLibrary). This is where that
// name stops being an id and becomes something to read, so it is also where it
// gets translated. Everything the local catalog shows passes through here.
function toAlbum(local: CatAlbum): Album {
  registerCover(local.id, local.coverUri);
  return {
    id: local.id,
    name: local.name === UNKNOWN_ALBUM ? tg('Unknown album') : local.name,
    artist: local.artist,
    artistId: local.artist ? normKey(local.artist) : undefined,
    coverArt: local.id,
    songCount: local.songCount,
    year: local.year,
    discTitles: local.discTitles,
    releaseTypes: local.releaseTypes,
    isCompilation: local.isCompilation,
  };
}

function toArtist(local: CatArtist): Artist {
  registerCover(local.id, local.coverUri);
  return {
    id: local.id,
    name: local.name === UNKNOWN_ARTIST ? tg('Unknown artist') : local.name,
    coverArt: local.id,
    albumCount: local.albumCount,
  };
}

/** Our list types in the local catalog's own words. The two that are missing
 *  are not orders at all: they are this phone's history and play counts. */
const LOCAL_ALBUM_ORDER: Record<string, LocalCat.AlbumOrder> = {
  newest: 'newest',
  byYear: 'year',
  random: 'random',
  alphabeticalByArtist: 'artist',
  alphabeticalByName: 'name',
};

/**
 * The albums this phone has played, from the stores that record it rather than
 * from the catalog: the history and the counter know the ids, and the database
 * is then asked only for those rows.
 */
async function playedAlbums(
  src: LocalCat.Source,
  type: 'recent' | 'frequent',
): Promise<CatAlbum[]> {
  const weight = new Map<string, number>();
  if (type === 'recent') {
    // Only what has actually played, like the server does; with an empty
    // history the list is empty and the Home section does not show.
    for (const e of usePlayHistory.getState().entries) {
      const id = e.song.albumId;
      if (id && (weight.get(id) ?? 0) < e.playedAt) weight.set(id, e.playedAt);
    }
  } else {
    const counts = usePlayCounts.getState().counts;
    const played = Object.keys(counts).filter((id) => counts[id] > 0);
    const songs = await LocalCat.songsByIds(src, played);
    for (const [id, song] of songs) {
      if (song.albumId) weight.set(song.albumId, (weight.get(song.albumId) ?? 0) + counts[id]);
    }
  }
  const ids = [...weight.keys()].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0));
  const rows = await LocalCat.albumsByIds<CatAlbum>(src, ids);
  return ids.map((id) => rows.get(id)).filter((a): a is CatAlbum => !!a);
}

/** The songs this phone has played, on the same terms as `playedAlbums`. */
async function playedSongs(
  src: LocalCat.Source,
  type: 'recent' | 'frequent',
): Promise<Song[]> {
  const weight = new Map<string, number>();
  if (type === 'recent') {
    for (const e of usePlayHistory.getState().entries) {
      if ((weight.get(e.song.id) ?? 0) < e.playedAt) weight.set(e.song.id, e.playedAt);
    }
  } else {
    const counts = usePlayCounts.getState().counts;
    for (const [id, n] of Object.entries(counts)) if (n > 0) weight.set(id, n);
  }
  const ids = [...weight.keys()].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0));
  const rows = await LocalCat.songsByIds(src, ids);
  return ids.map((id) => rows.get(id)).filter((song): song is Song => !!song);
}

export async function getAlbumList(type: string, size = 20, offset = 0): Promise<Album[]> {
  // The orders that are the database's to answer. "Recently played" and "most
  // played" are not: they come from this phone's own history and counts, which
  // live in a store, so those stay below. Neither is "new releases": the year
  // lives inside the album's blob and not in a column to sort on.
  const dir = downloadsDir();
  const order = ({ newest: 'newest', random: 'random', alphabeticalByArtist: 'artist' } as const)[
    type as 'newest' | 'random' | 'alphabeticalByArtist'
  ];
  const inMemory = type === 'recent' || type === 'frequent' || type === 'byYear';
  if (dir && (order || !inMemory)) {
    try {
      const rows = await Cat.albumsPage(dir, order ?? 'name', size, offset);
      return rows.map(toAlbum);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const src = await localSrc();
  if (src) {
    try {
      const local = LOCAL_ALBUM_ORDER[type];
      const rows = local
        ? await LocalCat.albumsPage<CatAlbum>(src, local, size, offset)
        : (await playedAlbums(src, type as 'recent' | 'frequent')).slice(offset, offset + size);
      return rows.map(toAlbum);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  let albums = [...c.albums];
  switch (type) {
    case 'newest':
      // Recently added: by file date (by year when missing).
      albums.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || (b.year ?? 0) - (a.year ?? 0));
      break;
    case 'recent': {
      // Recently played, from the local history (which records in this mode
      // too). Only albums that have actually played, like the server does; with
      // an empty history the list is empty and the Home section doesn't show.
      // Shallower than on a server: the history keeps ~100 songs.
      const lastPlayed = new Map<string, number>();
      for (const e of usePlayHistory.getState().entries) {
        const id = e.song.albumId;
        if (id && (lastPlayed.get(id) ?? 0) < e.playedAt) lastPlayed.set(id, e.playedAt);
      }
      albums = albums
        .filter((a) => lastPlayed.has(a.id))
        .sort((a, b) => (lastPlayed.get(b.id) ?? 0) - (lastPlayed.get(a.id) ?? 0));
      break;
    }
    case 'frequent': {
      // Most played: by the album's accumulated local play count.
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
    case 'byYear':
      // New releases: the year off the tags, newest first. An album with none
      // sinks to the bottom rather than leading the list.
      albums.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name));
      break;
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

/** Every album in the local catalog, sorted alphabetically. */
export async function getAllAlbums(): Promise<Album[]> {
  const src = await localSrc();
  if (src) {
    try {
      // No paging here on purpose: this is the one caller that wants the lot,
      // and it is the grid the local library opens on.
      return (await LocalCat.albumsPage<CatAlbum>(src, 'name', ALL_ROWS, 0)).map(toAlbum);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  return [...c.albums].sort((a, b) => a.name.localeCompare(b.name)).map(toAlbum);
}

export async function getAlbum(albumId: string): Promise<{ album: Album; songs: Song[] }> {
  const dir = downloadsDir();
  if (dir) {
    try {
      const songs = await Cat.albumSongs(dir, albumId);
      if (songs.length > 0) {
        const shelf = (await getDownloadShelf()).albums.find((a) => a.id === albumId);
        const first = songs[0];
        return {
          album: shelf
            ? toAlbum(shelf)
            : {
                id: albumId,
                name: first.album ?? '',
                artist: first.artist,
                songCount: songs.length,
                coverArt: albumId,
              },
          songs,
        };
      }
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const src = await localSrc();
  if (src) {
    try {
      const [songs, album] = await Promise.all([
        LocalCat.albumSongs(src, albumId),
        LocalCat.albumById<CatAlbum>(src, albumId),
      ]);
      if (songs.length > 0 || album) {
        return {
          album: album
            ? toAlbum(album)
            : {
                id: albumId,
                name: songs[0]?.album || tg('Unknown album'),
                songCount: songs.length,
              },
          songs,
        };
      }
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  const songs = (c?.songs ?? [])
    .filter((s) => (s.albumId || normKey(s.album || UNKNOWN_ALBUM)) === albumId)
    // Disc first, then track number (those without one go last, by title). On
    // multi-disc albums track numbers repeat per disc, so sorting by track alone
    // interleaved the discs and mislabeled them (matches the online order now).
    .sort((a, b) => {
      const da = a.discNumber ?? 1;
      const db = b.discNumber ?? 1;
      if (da !== db) return da - db;
      const ta = a.track ?? Infinity;
      const tb = b.track ?? Infinity;
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    });
  const album = c?.albums.find((a) => a.id === albumId);
  return {
    // Without a catalog entry we fall back to the songs' tag; the id is NEVER
    // good as a name — in downloads it's the server's opaque id and the header
    // showed gibberish. With 0 songs the album no longer exists (local albums
    // are derived from them) and the screen exits on its own, so this name is
    // a belt for any other path, not the usual one.
    album: album
      ? toAlbum(album)
      : {
          id: albumId,
          name: songs[0]?.album || tg('Unknown album'),
          songCount: songs.length,
        },
    songs,
  };
}

export async function getArtists(): Promise<Artist[]> {
  // The artists are derived from the albums, which the shelf already holds:
  // this one never needed the songs, and asking for the catalog dragged all
  // fifteen thousand of them along.
  const dir = downloadsDir();
  if (dir) {
    try {
      const shelf = await getDownloadShelf();
      if (shelf.artists.length > 0) return shelf.artists.map(toArtist);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const src = await localSrc();
  if (src) {
    try {
      return (await LocalCat.allArtists<CatArtist>(src)).map(toArtist);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  return c.artists.map(toArtist);
}

export async function getArtist(artistId: string): Promise<{ artist: Artist; albums: Album[] }> {
  const dir = downloadsDir();
  if (dir) {
    try {
      // The id may be the server's, which this catalog is not keyed by: it
      // comes from anything that remembers the artist from when there was a
      // connection — a recent search, a mirrored album, the queue. They are
      // the same artist, and answering "nothing here" for one of their two
      // names is what left people on an artist screen with no records on it.
      const id = (await Cat.artistByServerId(dir, artistId))?.id ?? artistId;
      const shelf = (await getDownloadShelf()).artists.find((a) => a.id === id);
      let rows = await Cat.artistAlbums(dir, id);
      let name = shelf?.name;
      if (rows.length === 0 || !name) {
        // Nothing under their name, or no name to show. Both happen to an
        // artist credited on a track of somebody else's album: the ids here are
        // made from the strings the tags carry, so theirs belongs to the songs
        // and not to any album. Their name and their records are in the songs,
        // and showing the id instead is how "bring me the horizon . dimension
        // 32" ended up as somebody's name on screen. Asked with the id as it
        // arrived, since a song carries the server's artist id and not ours.
        const found = await Cat.artistFromSongs(dir, artistId);
        name = name ?? found.name;
        if (rows.length === 0) rows = await Cat.albumsByIds(dir, found.albumIds);
      }
      if (rows.length > 0 || name) {
        return {
          artist: {
            // The id as it was asked for, whichever of the two it is: the
            // screen is already showing it and everything it does next is
            // keyed by it.
            id: artistId,
            name: name ?? rows[0]?.artist ?? '',
            // Their own picture, saved with the downloads, rather than the
            // cover of whichever record happened to come first.
            coverArt: id,
            albumCount: rows.length,
          },
          albums: rows.map(toAlbum),
        };
      }
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const src = await localSrc();
  if (src) {
    try {
      const [albums, artist] = await Promise.all([
        LocalCat.artistAlbums<CatAlbum>(src, artistId),
        LocalCat.artistById<CatArtist>(src, artistId),
      ]);
      if (albums.length > 0 || artist) {
        return {
          artist: artist
            ? toArtist(artist)
            : { id: artistId, name: albums[0]?.artist || artistId, albumCount: albums.length },
          albums: albums.map(toAlbum),
        };
      }
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  const albums = (c?.albums ?? []).filter(
    (a) => normKey(a.artist || UNKNOWN_ARTIST) === artistId,
  );
  const artist = c?.artists.find((a) => a.id === artistId);
  return {
    // Here the id IS fine as a last resort, unlike in getAlbum: in local mode
    // an artist's id is their own normalized name, so the worst case is seeing
    // it lowercased. Better that than an "unknown" that throws the name away.
    // We still prefer the one from their albums, which keeps the capitals.
    //
    // Only in local mode, though. On a server account offline the id can be
    // the server's, and there it is not a name at all: an artist nothing on
    // this phone knows about was putting `ar-3f9a…` where their name goes.
    artist: artist
      ? toArtist(artist)
      : {
          id: artistId,
          name: albums[0]?.artist || (useAuthStore.getState().auth ? '' : artistId),
          albumCount: albums.length,
        },
    albums: albums.map(toAlbum),
  };
}

/**
 * What the server calls an artist whose music is downloaded, for an id that
 * only means something on this phone.
 *
 * The way back from `getArtist` above, and it is needed while ONLINE: a recent
 * search made offline remembers the artist by the local id, and asking the
 * server for that gets nothing at all.
 */
export async function serverArtistId(artistId: string): Promise<string | undefined> {
  const dir = downloadsDir();
  if (!dir) return undefined;
  try {
    return await Cat.serverIdOfArtist(dir, artistId);
  } catch {
    return undefined;
  }
}

/** Albums by other artists containing songs by this one ("Appears on"). */
export async function getAppearsOn(artistId: string): Promise<GuestAlbum[]> {
  const src = await localSrc();
  if (src) {
    try {
      const ids = await LocalCat.albumIdsOfArtist(src, artistId);
      const rows = await LocalCat.albumsByIds<CatAlbum>(src, ids);
      return [...rows.values()]
        // The album's own artist is compared here, so there is no ambiguity.
        .filter((a) => normKey(a.artist || UNKNOWN_ARTIST) !== artistId)
        .map((a) => ({ ...toAlbum(a), confirmed: true }));
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  const albumIds = new Set(
    c.songs
      .filter((s) => normKey(s.artist || UNKNOWN_ARTIST) === artistId)
      .map((s) => s.albumId || normKey(s.album || UNKNOWN_ALBUM)),
  );
  return c.albums
    .filter((a) => albumIds.has(a.id) && normKey(a.artist || UNKNOWN_ARTIST) !== artistId)
    // The album's own artist is compared here, so there's no ambiguity.
    .map((a) => ({ ...toAlbum(a), confirmed: true }));
}

export function getArtistInfo(_id: string): ArtistInfo {
  return { similarArtists: [] };
}

/**
 * The catalog's songs, a page at a time. Here everything is already in memory,
 * so ordering costs nothing and the screen offers what it likes: `server` is
 * the catalog's own order (how the library was read off the device).
 */
export async function getSongList(
  sort: SongListSort = 'server',
  count = 50,
  offset = 0,
): Promise<Song[]> {
  // The orders the database can answer, which is all of them except the two
  // that come from this phone's own history and play counts.
  const dir = downloadsDir();
  const order = ({ alpha: 'title', added: 'newest', random: 'random', server: 'title' } as const)[
    sort as 'alpha' | 'added' | 'random' | 'server'
  ];
  if (dir && order) {
    try {
      return await Cat.songsPage(dir, order, count, offset);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const src = await localSrc();
  if (src) {
    try {
      const local = ({ alpha: 'title', added: 'newest', random: 'random', server: 'server' } as const)[
        sort as 'alpha' | 'added' | 'random' | 'server'
      ];
      const rows = local
        ? await LocalCat.songsPage(src, local, count, offset)
        : (await playedSongs(src, sort as 'recent' | 'frequent')).slice(offset, offset + count);
      return rows;
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  let songs = [...c.songs];
  switch (sort) {
    case 'alpha':
      songs.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'added':
      // The file's own date, which is the only "added" a folder of music has.
      songs.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
      break;
    case 'recent': {
      // The local history, which records in this mode too. Only what has
      // actually played, like the server's own list.
      const played = new Map<string, number>();
      for (const e of usePlayHistory.getState().entries) {
        if ((played.get(e.song.id) ?? 0) < e.playedAt) played.set(e.song.id, e.playedAt);
      }
      songs = songs
        .filter((s) => played.has(s.id))
        .sort((a, b) => (played.get(b.id) ?? 0) - (played.get(a.id) ?? 0));
      break;
    }
    case 'frequent': {
      const counts = usePlayCounts.getState().counts;
      songs = songs
        .filter((s) => (counts[s.id] ?? 0) > 0)
        .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
      break;
    }
    case 'random':
      for (let i = songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [songs[i], songs[j]] = [songs[j], songs[i]];
      }
      break;
    default: // 'server': the catalog as it was read
      break;
  }
  return songs.slice(offset, offset + count);
}

/** Most played songs according to the local play counter. */
export async function getMostPlayedSongs(size = 50): Promise<Song[]> {
  const src = await localSrc();
  if (src) {
    try {
      return (await playedSongs(src, 'frequent')).slice(0, size);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  const counts = usePlayCounts.getState().counts;
  return c.songs
    .filter((s) => (counts[s.id] ?? 0) > 0)
    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
    .slice(0, size);
}

/**
 * Random songs from the local catalog (Home's shuffle).
 *
 * No genre filter unlike the server: genres are a server thing throughout the
 * app (there's no genres screen in local mode), so there would be nothing to
 * filter by here.
 */
export async function getRandomSongs(size = 200): Promise<Song[]> {
  const src = await localSrc();
  if (src) {
    try {
      return await LocalCat.songsPage(src, 'random', size, 0);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  // Fisher-Yates over a copy: `c.songs` is the live catalog.
  const a = c.songs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, size);
}

export async function getTopSongs(artist: string, count = 10): Promise<Song[]> {
  const counts = usePlayCounts.getState().counts;
  const src = await localSrc();
  if (src) {
    try {
      // Their songs first and the ranking here: the counter is a store and not
      // a column, so the database has nothing to sort them by.
      const songs = await LocalCat.songsByArtist(src, artist, ALL_ROWS);
      return songs
        .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
        .slice(0, count);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  // By local play counts, the way the server sorts its own; the sort is stable,
  // so with no plays the catalog's previous order is preserved.
  return c.songs
    .filter((s) => s.artist === artist)
    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
    .slice(0, count);
}

// ---- Local playlists (offline mode) ---------------------------------------
// Stored as song ids; resolved against the catalog when read, so songs that no
// longer exist in the current source are skipped.
// Per profile, like the favorites: `<base>.<profile hash>`.
const PLAYLISTS_KEY = 'resonus.localPlaylists';

/** Playlists key for the active profile. */
function playlistsKey(): string {
  return `${PLAYLISTS_KEY}.${hashKey(profileScopeId())}`;
}

interface LocalPlaylistRec {
  id: string;
  name: string;
  comment?: string;
  songIds: string[];
  createdAt: number;
  /** Custom cover (file:// copied into PLAYLIST_COVERS_DIR). */
  coverUri?: string;
}

// Cache tagged with the profile key: re-reads itself when the profile changes.
let playlistCache: LocalPlaylistRec[] | null = null;
let playlistCacheKey: string | null = null;

async function loadPlaylists(): Promise<LocalPlaylistRec[]> {
  const key = playlistsKey();
  if (playlistCache && playlistCacheKey === key) return playlistCache;
  playlistCacheKey = key;
  try {
    const raw = await getItem(key);
    if (raw) {
      playlistCache = JSON.parse(raw) as LocalPlaylistRec[];
    } else {
      // Migration from the old (shared global key) version: each profile
      // inherits only its own by id prefix — the local one the hand-made ones
      // (`lp_`), the server account those downloaded from its playlists (`dl_`).
      const legacy = await getItem(PLAYLISTS_KEY);
      const all = legacy ? (JSON.parse(legacy) as LocalPlaylistRec[]) : [];
      const local = profileScopeId() === 'local';
      playlistCache = all.filter((p) =>
        local ? p.id.startsWith('lp_') : p.id.startsWith('dl_'),
      );
    }
  } catch {
    playlistCache = [];
  }
  return playlistCache;
}

async function savePlaylists(list: LocalPlaylistRec[]) {
  const key = playlistsKey();
  playlistCache = list;
  playlistCacheKey = key;
  await setItem(key, JSON.stringify(list));
}

/** Clears the playlists cache (on source/profile change). */
export function clearLocalPlaylists() {
  playlistCache = null;
  playlistCacheKey = null;
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

/**
 * The songs the local playlists name, by id.
 *
 * A playlist is a list of ids and nothing else, so this is what turns it into
 * music. From the database when there is one, which asks for the songs the
 * playlists hold instead of the library they came from; a song that is no
 * longer in the source simply does not come back and the playlist is shorter.
 */
async function playlistSongs(): Promise<Map<string, Song>> {
  const src = await localSrc();
  if (src) {
    try {
      const list = await loadPlaylists();
      const ids = [...new Set(list.flatMap((p) => p.songIds))];
      return await LocalCat.songsByIds(src, ids);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  return new Map((c?.songs ?? []).map((song) => [song.id, song]));
}

/** The local playlists (in creation order, newest first). */
export async function getPlaylists(): Promise<Playlist[]> {
  const [list, byId] = await Promise.all([loadPlaylists(), playlistSongs()]);
  return list
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((rec) => toPlaylist(rec, rec.songIds.map((id) => byId.get(id)).filter(Boolean) as Song[]));
}

export async function getPlaylist(id: string): Promise<{ playlist: Playlist; songs: Song[] }> {
  const [list, byId] = await Promise.all([loadPlaylists(), playlistSongs()]);
  const rec = list.find((p) => p.id === id);
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

/** Every local playlist's song ids, including songs no longer in the source. */
export async function playlistTracklists(): Promise<Map<string, string[]>> {
  return new Map((await loadPlaylists()).map((p) => [p.id, p.songIds]));
}

/** Rewrites a local playlist's order with the new sequence of ids. */
export async function reorderPlaylist(id: string, songIds: string[]): Promise<void> {
  const list = await loadPlaylists();
  await savePlaylists(list.map((p) => (p.id === id ? { ...p, songIds } : p)));
}

export async function deletePlaylist(id: string): Promise<void> {
  const list = await loadPlaylists();
  deleteCoverFile(list.find((p) => p.id === id)?.coverUri);
  await savePlaylists(list.filter((p) => p.id !== id));
}

// ── Playlist files (#335) ───────────────────────────────────────────────────
// An `.m3u` in the music folders becomes a playlist. It is read again only
// when the file itself changes, so editing or deleting the playlist in the app
// is not undone by the next look at the folder.
const M3U_KEY = 'resonus.localM3u';

async function importPlaylistFiles(src: LocalCat.Source, files: string[]): Promise<boolean> {
  if (files.length === 0) return false;
  const key = `${M3U_KEY}.${hashKey(profileScopeId())}`;
  let seen: Record<string, string> = {};
  try {
    seen = JSON.parse((await getItem(key)) ?? '{}') as Record<string, string>;
  } catch {
    // Starts over: the worst case is importing them once more.
  }
  let match: ReturnType<typeof m3uMatcher> | null = null;
  let imported = false;
  let dirty = false;
  for (const uri of files) {
    let text: string;
    try {
      text = await FileSystem.readAsStringAsync(uri);
    } catch {
      continue;
    }
    const stamp = hashKey(text);
    if (seen[uri] === stamp) continue;
    // The same text under another name or by another road: one already read,
    // or one this app wrote.
    const known = Object.values(seen).includes(stamp);
    seen[uri] = stamp;
    dirty = true;
    if (known) continue;
    match = match ?? m3uMatcher(await LocalCat.songUris(src));
    const path = pathOfUri(uri);
    const ids = parseM3u(text)
      .map((entry) => match!(entry, dirOf(path)))
      .filter((id): id is string => !!id);
    if (ids.length === 0) continue;
    await upsertLocalPlaylist(`lp_m3u_${hashKey(uri)}`, baseOf(path).replace(/\.m3u8?$/i, ''), ids);
    imported = true;
  }
  if (dirty) await setItem(key, JSON.stringify(seen));
  return imported;
}

/**
 * Writes a local playlist into a folder as an `.m3u8`. The file is noted as
 * read: saved among the music, it would otherwise come back as a second copy
 * of the playlist it was made from.
 */
export async function exportPlaylistFile(id: string, folderUri: string): Promise<void> {
  const { playlist, songs } = await getPlaylist(id);
  const text = buildM3u(songs);
  const name = `${playlist.name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`;
  const file = await writeTextToFolder(folderUri, name, 'audio/x-mpegurl', text);
  const key = `${M3U_KEY}.${hashKey(profileScopeId())}`;
  let seen: Record<string, string> = {};
  try {
    seen = JSON.parse((await getItem(key)) ?? '{}') as Record<string, string>;
  } catch {
    // Starts over.
  }
  seen[file] = hashKey(text);
  await setItem(key, JSON.stringify(seen));
}

// ── Custom cover for local playlists ────────────────────────────────────────
// The chosen image is copied to a directory of its own: outside local-catalog/,
// which "Rescan" wipes entirely and would take the cover down with it.
const PLAYLIST_COVERS_DIR = FileSystem.documentDirectory + 'playlist-covers/';

function deleteCoverFile(uri?: string) {
  if (uri) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export async function setLocalPlaylistCover(id: string, srcUri: string): Promise<void> {
  await FileSystem.makeDirectoryAsync(PLAYLIST_COVERS_DIR, { intermediates: true }).catch(() => {});
  // A new name on every change: reusing the same URI would leave expo-image
  // showing the previous image it has cached.
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

/** Creates or updates a local playlist (used by playlist downloads). */
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

/** Deletes the local playlists with that id prefix (downloads cleanup). */
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

/**
 * The favorites, newest first — the order a Subsonic server gives them in, and
 * what the Favorites screen calls "Recently added".
 *
 * The store already knows it: `starLocal` appends, so its lists run oldest to
 * newest and reading them backwards is the answer. Walking the catalog instead
 * (which is what this did) threw that away and handed back the catalog's own
 * order, which is alphabetical and has nothing to do with when anything was
 * marked. Ids no longer in the catalog —a file that left the folder— simply
 * don't come out.
 */
function newestFirst<T>(ids: string[], items: T[], id: (x: T) => string): T[] {
  const byId = new Map(items.map((x) => [id(x), x]));
  const out: T[] = [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const item = byId.get(ids[i]);
    if (item) out.push(item);
  }
  return out;
}

export async function getStarred(): Promise<Starred> {
  const favs = await loadFavs();
  const src = await localSrc();
  if (src) {
    try {
      // The three lists are ids in a store, so the database is asked for those
      // rows and the order stays the store's: last starred, first shown.
      const [songs, albums, artists] = await Promise.all([
        LocalCat.songsByIds(src, favs.songs),
        LocalCat.albumsByIds<CatAlbum>(src, favs.albums),
        LocalCat.artistsByIds<CatArtist>(src, favs.artists),
      ]);
      const inOrder = <T>(ids: string[], rows: Map<string, T>): T[] =>
        ids
          .slice()
          .reverse()
          .map((id) => rows.get(id))
          .filter((row): row is T => !!row);
      return {
        songs: inOrder(favs.songs, songs),
        albums: inOrder(favs.albums, albums).map(toAlbum),
        artists: inOrder(favs.artists, artists).map(toArtist),
      };
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return { songs: [], albums: [], artists: [] };
  return {
    songs: newestFirst(favs.songs, c.songs, (s) => s.id),
    albums: newestFirst(favs.albums, c.albums, (a) => a.id).map(toAlbum),
    artists: newestFirst(favs.artists, c.artists, (a) => a.id).map(toArtist),
  };
}

/** Lowercase and without accents, so "nino" finds "Niño". */
function norm(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * How well a name matches, lower is better: 0 starts with the query, 1 contains
 * it, null doesn't match. Deeper tiers (2, 3…) are for things that only match
 * through something they contain.
 */
function rank(name: string | undefined, q: string): number | null {
  const n = norm(name ?? '');
  if (!n) return null;
  const at = n.indexOf(q);
  return at < 0 ? null : at === 0 ? 0 : 1;
}

/** How many of each kind come back, like the server's own caps. */
const SEARCH_MAX = 20;

/** Keeps what matched, best first, then alphabetically within a tier. */
function ranked<T>(items: T[], score: (x: T) => number | null, name: (x: T) => string): T[] {
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || name(a.item).localeCompare(name(b.item)))
    .map((x) => x.item)
    .slice(0, SEARCH_MAX);
}

/**
 * Local search, the twin of the server's `search3`.
 *
 * Each row is ranked by ITS OWN name first: an artist called "Artificial Brain"
 * must come before an artist who merely has a song with "artificial" in the
 * title. This used to derive artists and albums from whatever songs matched, so
 * a song title decided who showed up in the artists row and in what order —
 * nothing like what the server returns for the same query (issue #55).
 */
/**
 * How many rows each kind brings back before the ranking picks from them.
 *
 * Deliberately far above `SEARCH_MAX`: the database can only tell what contains
 * the text, and which of those comes first is decided here (a name that starts
 * with the query beats one that merely holds it). A tight limit would hand that
 * decision to whatever the alphabet put first.
 */
const SEARCH_POOL = 300;

export async function search(query: string): Promise<SearchResult> {
  const q0 = norm(query.trim());
  const src = q0 ? await localSrc() : null;
  if (src) {
    try {
      const text = query.trim();
      const [songs, named, artistsNamed, hits] = await Promise.all([
        LocalCat.searchSongs(src, text, SEARCH_POOL),
        LocalCat.searchAlbums<CatAlbum>(src, text, SEARCH_POOL),
        LocalCat.searchArtists<CatArtist>(src, text, SEARCH_POOL),
        LocalCat.albumIdsOfMatchingSongs(src, text, SEARCH_POOL),
      ]);
      // The albums and artists reached through a matching SONG are not in the
      // rows above — they match nothing themselves — so they are fetched by the
      // ids those songs carry and join the pool at their own tier.
      const [held, credited] = await Promise.all([
        LocalCat.albumsByIds<CatAlbum>(src, hits.albumIds),
        LocalCat.artistsByIds<CatArtist>(src, hits.artistKeys),
      ]);
      const withAlbumHit = named.map((a) => normKey(a.artist || UNKNOWN_ARTIST));
      const byAlbum = await LocalCat.artistsByIds<CatArtist>(src, withAlbumHit);
      const albumPool = [...new Map([...named, ...held.values()].map((a) => [a.id, a])).values()];
      const artistPool = [
        ...new Map(
          [...artistsNamed, ...byAlbum.values(), ...credited.values()].map((a) => [a.id, a]),
        ).values(),
      ];
      const albumsWithHit = new Set(hits.albumIds);
      const artistsWithSongHit = new Set(hits.artistKeys);
      const artistsWithAlbumHit = new Set(withAlbumHit);
      return {
        artists: ranked(
          artistPool,
          (a) =>
            rank(a.name, q0) ??
            (artistsWithAlbumHit.has(a.id) ? 2 : artistsWithSongHit.has(a.id) ? 3 : null),
          (a) => a.name,
        ).map(toArtist),
        albums: ranked(
          albumPool,
          (a) =>
            rank(a.name, q0) ??
            (rank(a.artist, q0) !== null ? 2 : albumsWithHit.has(a.id) ? 3 : null),
          (a) => a.name,
        ).map(toAlbum),
        songs: ranked(
          songs,
          (song) =>
            rank(song.title, q0) ??
            (rank(song.artist, q0) !== null || rank(song.album, q0) !== null ? 2 : null),
          (song) => song.title,
        ),
      };
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  const q = norm(query.trim());
  if (!c || !q) return { artists: [], albums: [], songs: [] };

  // Songs: by title, then the ones reached through their artist or album.
  const songs = ranked(
    c.songs,
    (s) => rank(s.title, q) ?? (rank(s.artist, q) !== null || rank(s.album, q) !== null ? 2 : null),
    (s) => s.title,
  );
  const titleHits = c.songs.filter((s) => rank(s.title, q) !== null);
  const albumsWithHit = new Set(titleHits.map((s) => s.albumId).filter(Boolean));
  const artistsWithSongHit = new Set(titleHits.map((s) => normKey(s.artist || '')));

  // Albums: by name, then by their artist, then by holding a matching song.
  const albums = ranked(
    c.albums,
    (a) =>
      rank(a.name, q) ??
      (rank(a.artist, q) !== null ? 2 : a.id && albumsWithHit.has(a.id) ? 3 : null),
    (a) => a.name,
  );
  const artistsWithAlbumHit = new Set(
    c.albums.filter((a) => rank(a.name, q) !== null).map((a) => normKey(a.artist || '')),
  );

  // Artists: by name, then by having a matching album, then a matching song.
  const artists = ranked(
    c.artists,
    (a) =>
      rank(a.name, q) ??
      (artistsWithAlbumHit.has(a.id) ? 2 : artistsWithSongHit.has(a.id) ? 3 : null),
    (a) => a.name,
  );

  return {
    artists: artists.map(toArtist),
    albums: albums.map(toAlbum),
    songs,
  };
}

/**
 * Albums-only search, the local twin of `Subsonic.searchAlbums`. Looks at the
 * album's name and artist, not its songs: whoever filters albums is after the
 * album, and `search` already covers finding it by one of its songs.
 */
export async function searchAlbums(query: string, count = 50): Promise<Album[]> {
  const dir = downloadsDir();
  if (dir && query.trim()) {
    try {
      return (await Cat.searchAlbums(dir, query.trim(), count)).map(toAlbum);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const src = query.trim() ? await localSrc() : null;
  if (src) {
    try {
      return (await LocalCat.searchAlbums<CatAlbum>(src, query.trim(), count)).map(toAlbum);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  const q = query.toLowerCase();
  return c.albums
    .filter(
      (a) =>
        (a.name?.toLowerCase() ?? '').includes(q) ||
        (a.artist?.toLowerCase() ?? '').includes(q),
    )
    .slice(0, count)
    .map(toAlbum);
}

/** Songs matching the text, over the catalog already in memory. */
export async function searchSongs(query: string, count = 50): Promise<Song[]> {
  const dir = downloadsDir();
  if (dir && query.trim()) {
    try {
      return await Cat.searchSongs(dir, query.trim(), count);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const src = query.trim() ? await localSrc() : null;
  if (src) {
    try {
      return await LocalCat.searchSongs(src, query.trim(), count);
    } catch {
      // Falls through to the catalog in memory.
    }
  }
  const c = await ensureCatalog();
  if (!c) return [];
  const q = query.toLowerCase();
  return c.songs
    .filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.artist?.toLowerCase() ?? '').includes(q) ||
        (s.album?.toLowerCase() ?? '').includes(q),
    )
    .slice(0, count);
}

export { localCoverUrl as coverUrl } from './localLibrary';
