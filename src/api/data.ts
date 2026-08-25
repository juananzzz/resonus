/**
 * Unified data layer. Screens use these functions instead of calling the
 * Subsonic API directly. The module automatically decides whether to read
 * from the server or the local catalog based on the mode (online/offline).
 */
import { profileScopeId, useAuthStore } from '@/store/auth';
import {
  getDownloadShelf,
  getDownloadsCatalog,
  noteDownloadedArtist,
  useDownloads,
} from '@/store/downloads';
import {
  enabledFolderIds,
  profileKeyOf,
  readAlbumCache,
  writeAlbumCache,
} from '@/store/libraries';
import { hashKey } from '@/lib/localLibrary';
import { bump } from '@/lib/perfLog';
import { queryClient } from '@/lib/query';
import { getItem, setItem } from '@/lib/storage';
import { useLastPlayed } from '@/store/lastPlayed';
import { useLibraryMirror } from '@/store/libraryMirror';
import { useOfflineQueue, type PlayOp, type QueuePlaylist } from '@/store/offlineQueue';
import { usePlayHistory } from '@/store/playHistory';
import { isManualOffline } from './netGate';
import { getLocalLyrics, getOnlineLyrics } from '@/lib/localLyrics';
import { isAudiobookGenre } from '@/store/albumProgress';
import { useSettings, type LyricsSource } from '@/store/settings';
import * as Navidrome from './navidrome';
import * as Subsonic from './backend';
import * as Local from '@/lib/localQueries';
import type { Song } from './subsonic';

function isOffline() { return useAuthStore.getState().offline; }
function auth() { return useAuthStore.getState().auth!; }

/** Offline mode WITH a server account (not the local files-only profile):
 *  here the Library is a mirror of the server (see store/libraryMirror). */
function serverOffline(): boolean {
  const s = useAuthStore.getState();
  return s.offline && !!s.auth;
}

/**
 * Marks each song in the mirror as available or not based on downloads:
 * downloaded ones get their `localUri` (played from disk); the rest get
 * `unavailable` (shown grayed out and don't play). In offline mode the
 * set of downloads doesn't change, so the mark is stable during the session.
 *
 * Album art: downloaded art re-pins `coverArt` to `albumId` (the local index
 * goes by albumId). Non-downloaded keeps the server `coverArt`, so the
 * offline URL matches the online one and expo-image serves it from its cache
 * (or downloads it if offline is manual with network); otherwise the placeholder remains.
 */
function annotate(songs: Song[]): Song[] {
  const files = useDownloads.getState().files;
  // Ratings made offline (outbox): override the mirror's rating so they
  // show immediately and persist after refresh or restart, until synced.
  const ratings = useOfflineQueue.getState().data.ratings ?? {};
  // Setting: hide non-downloaded items instead of showing them grayed out.
  const hideUnavailable = useSettings.getState().hideUnavailableOffline;
  const annotated = songs.map((s0) => {
    const s = ratings[s0.id] !== undefined ? { ...s0, userRating: ratings[s0.id] } : s0;
    const uri = files[s.id];
    // Both point at the album's cover, downloaded or not. A server can give
    // each song a cover id of its own, and offline that is a file we do not
    // have and will not keep: one per track, for a picture that is the album's
    // in all but the rarest case. The album's is saved once and serves the
    // shelf, the header and every row under it.
    return uri
      ? { ...s, coverArt: s.albumId ?? s.coverArt, localUri: uri, unavailable: false }
      : { ...s, coverArt: s.albumId ?? s.coverArt, unavailable: true };
  });
  return hideUnavailable ? annotated.filter((s) => !s.unavailable) : annotated;
}

/**
 * Loads the mirror and the outbox for the profile, and registers the album art
 * of downloads in the local index (without this, offline album art won't
 * appear).
 *
 * The shelf, not the whole catalog: the songs behind it are only needed to
 * resolve ids, whoever needs them asks for them, and waiting for fifteen
 * thousand of them was the offline start standing still with placeholders on
 * screen whatever the screen was showing.
 */
async function loadMirror(): Promise<void> {
  await Promise.all([
    useLibraryMirror.getState().load(),
    useOfflineQueue.getState().load(),
    getDownloadShelf(),
  ]);
}

/** Same idea for the downloads, which is the other list walked once per id.
 *  Keyed on the catalog object, which is rebuilt whenever it changes. */
let catalogIndex: { source: unknown; byId: Map<string, Song> } | null = null;

function catalogSongs(catalog: { songs: Song[] }): Map<string, Song> {
  if (catalogIndex?.source === catalog) return catalogIndex.byId;
  const byId = new Map<string, Song>();
  for (const s of catalog.songs) if (!byId.has(s.id)) byId.set(s.id, s);
  catalogIndex = { source: catalog, byId };
  return byId;
}

/**
 * Metadata for these song ids, from whatever offline source knows them: the
 * outbox (songs added to a playlist offline), the mirror, and the downloads.
 *
 * By the batch, because that is how they are needed: a playlist asks about all
 * of its songs at once. The mirror answers with one query for the lot, which
 * is what its own table of songs is for.
 */
async function resolveSongs(ids: string[]): Promise<Map<string, Song>> {
  const out = new Map<string, Song>();
  const meta = useOfflineQueue.getState().data.songMeta ?? {};
  const pending: string[] = [];
  for (const id of ids) {
    const m = meta[id];
    if (m) out.set(id, m);
    else pending.push(id);
  }
  if (pending.length > 0) {
    const fromMirror = await useLibraryMirror.getState().songs(pending);
    for (const id of pending) {
      const s = fromMirror.get(id);
      if (s) out.set(id, s);
    }
    // The downloads catalog is the fallback, and it is only built if the mirror
    // came up short: it is every downloaded song parsed out of the database, and
    // asking for it to resolve a handful of ids the mirror already knows was
    // paying for the whole library to answer a question about six covers.
    const missing = pending.filter((id) => !out.has(id));
    if (missing.length > 0) {
      const local = catalogSongs(await getDownloadsCatalog());
      for (const id of missing) {
        const s = local.get(id);
        if (s) out.set(id, s);
      }
    }
  }
  return out;
}

/** One song, for the places that only need one. */
async function resolveSong(id: string): Promise<Song | undefined> {
  return (await resolveSongs([id])).get(id);
}

/** Final desired tracklist for an offline playlist: the outbox edit if any,
 *  or the mirror's tracklist. */
async function currentPlaylistSongIds(id: string): Promise<string[]> {
  await loadMirror();
  const edited = useOfflineQueue.getState().data.playlists?.[id]?.songIds;
  if (edited) return edited;
  const d = await useLibraryMirror.getState().playlistDetail(id);
  return (d?.songs ?? []).map((s) => s.id);
}

export type { Album, AlbumListType, Artist, ArtistInfo, FolderContents, FolderEntry, MusicFolder, Playlist, RadioStation, SearchResult, Song, StarType, Starred, SubsonicAuth } from './subsonic';
export { COVER, normalizeUrl } from './subsonic';

/**
 * Marks a cover that may only be shown if it is already in the image cache.
 * Deliberately not a URL: anything that tries to load it fails instead of
 * reaching the network, which is the whole point (see `coverArtUrl`).
 */
export const CACHED_COVER = 'cached-cover:';



export function coverArtUrl(id: string | undefined, _size?: number): string | undefined {
  // If the album art is downloaded (album/artist on disk), use it even
  // when in server mode: it works offline and doesn't use data, just
  // like audio plays from the downloaded file.
  const local = Local.coverUrl(id);
  if (local) return local;
  // Offline: whatever is already on the phone, and nothing fetched. Handing
  // back the server's URL is what made offline mode fetch the covers of albums
  // it could not even play, one by one (#89): a URL given to the image loader
  // is a request like any other, it just doesn't look like one in the code.
  //
  // But most of those covers ARE on the phone, in the image cache, from when
  // they were seen online. So what comes back is the URL wearing a prefix that
  // makes it useless as a URL: nothing can fetch `cached-cover:https://…`, and
  // the one thing that understands it (`Cover`) looks it up in the cache and
  // shows it only if it is already there. Misusing it draws a placeholder,
  // which is the failure this should have.
  if (isOffline()) {
    if (!serverOffline()) return undefined;
    return CACHED_COVER + Subsonic.coverArtUrl(auth(), id, _size);
  }
  return Subsonic.coverArtUrl(auth(), id, _size);
}

/**
 * The cover for one song, which is not always the same picture offline.
 *
 * Online a song's own art wins, because on a compilation or a live take it is
 * the one that belongs to the track. Offline that art is usually nothing: on a
 * server that gives every track its own cover id, nothing on this phone was
 * ever saved under it. What was saved is the album's, both by a download and
 * by the mirror, so offline the album's is what gets asked for. A picture from
 * the right record beats a grey square, which is what the rows of a playlist
 * were showing.
 *
 * A station has no album to fall back to, and its `url` is what says so.
 */
export function songCoverUrl(
  song: Pick<Song, 'coverArt' | 'albumId' | 'url'>,
  size?: number,
): string | undefined {
  const album = song.url ? undefined : song.albumId;
  return coverArtUrl(isOffline() ? (album ?? song.coverArt) : (song.coverArt ?? album), size);
}

/**
 * Marks what cannot be played without a connection, for a list that builds
 * itself rather than coming from the mirror (the history, which is written on
 * this phone as it plays). Rows read `unavailable` to dim themselves and to
 * say so when tapped instead of pretending.
 *
 * The rule is the player's own: a radio, a track from the phone's library or a
 * downloaded file. Online it marks nothing, since everything can be streamed.
 */
export function markUnplayableOffline(songs: Song[]): Song[] {
  if (!isOffline()) return songs;
  const files = useDownloads.getState().files;
  return songs.map((s) => {
    const uri = s.localUri ?? files[s.id];
    if (s.url) return { ...s, unavailable: false };
    return uri ? { ...s, localUri: uri, unavailable: false } : { ...s, unavailable: true };
  });
}

/**
 * "Recently played" with only what was actually played. Servers order that list
 * by play date and let the albums with no play date trail along, so once your
 * history runs out the list is padded with albums you never opened. With
 * several libraries it was blatant: one you had never played still filled its
 * share of the shelf.
 *
 * Only when the server marks plays at all (OpenSubsonic `played`); otherwise
 * there's nothing to tell apart and the list is left exactly as it came.
 */
function onlyPlayed(albums: Subsonic.Album[]): Subsonic.Album[] {
  return albums.some((al) => al.played) ? albums.filter((al) => al.played) : albums;
}

export function getAlbumList(type: Subsonic.AlbumListType = 'newest', size?: number, offset?: number): Promise<Subsonic.Album[]> {
  if (isOffline()) return Local.getAlbumList(type, size, offset);
  const a = auth();
  const ids = enabledFolderIds(a);
  const page =
    type === 'byYear' && (!ids || ids.length === 1)
      ? byYearPage(a, size ?? 20, offset ?? 0, ids?.[0])
      : !ids
        ? Subsonic.getAlbumList(a, type, size, offset)
        : ids.length === 1
          ? Subsonic.getAlbumList(a, type, size, offset, ids[0])
          : mergedAlbumPage(a, `albums|${type}`, type, ids, size ?? 20, offset ?? 0, (id, s, o) =>
              Subsonic.getAlbumList(a, type, s, o, id),
            );
  return type === 'recent' ? page.then(onlyPlayed) : page;
}

/**
 * "New releases", in the order the name promises.
 *
 * `getAlbumList2` sorts `byYear` by the year and nothing else, so every record
 * released this year ties and the server settles it by album name: asking for
 * twenty gave twenty albums off one end of the alphabet, never the twenty most
 * recent. The window here is read once, sorted by the date the records actually
 * came out, and the caller's page is cut from that.
 */
async function byYearPage(
  a: Subsonic.SubsonicAuth,
  size: number,
  offset: number,
  folderId?: string,
): Promise<Subsonic.Album[]> {
  const depth = Math.max(BYYEAR_WINDOW, offset + size);
  const cacheKey = `albums|byYear|${profileKeyOf(a)}|${folderId ?? ''}|${depth}`;
  let all = readAlbumCache<Subsonic.Album>(cacheKey);
  if (!all) {
    all = (
      await fetchTopAlbums(depth, (s, o) => Subsonic.getAlbumList(a, 'byYear', s, o, folderId))
    ).sort(byRelease);
    writeAlbumCache(cacheKey, all);
  }
  return all.slice(offset, offset + size);
}

export function getAlbum(id: string): Promise<{ album: Subsonic.Album; songs: Subsonic.Song[] }> {
  if (isOffline()) {
    if (serverOffline()) return mirrorAlbum(id);
    return Local.getAlbum(id);
  }
  return Subsonic.getAlbum(auth(), id).then((res) => {
    useLibraryMirror.getState().saveAlbum(id, res.album, res.songs, useDownloads.getState());
    return res;
  });
}

async function mirrorAlbum(
  id: string,
): Promise<{ album: Subsonic.Album; songs: Subsonic.Song[] }> {
  await loadMirror();
  const d = await useLibraryMirror.getState().albumDetail(id);
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

/** All local albums (offline mode). Only used offline. */
export function getAllAlbums(): Promise<Subsonic.Album[]> {
  return Local.getAllAlbums();
}

/** Re-scan the local catalog (offline mode). */
export function rescanLocal(): Promise<void> {
  return Local.rescan();
}

/** Server genres (global; the API doesn't filter genres by library). */
export function getGenres(): Promise<Subsonic.Genre[]> {
  return Subsonic.getGenres(auth());
}

/** How many albums are asked for per audiobook genre. */
const AUDIOBOOK_PAGE = 200;

/**
 * Every album in the library that reads as an audiobook, for the Home chip.
 *
 * Asked for by genre, because that is the only question a Subsonic server can
 * answer: `getAlbumList2` filters by genre and by nothing else useful here.
 * So the library's own genre list is fetched first and intersected with the
 * ones that mean spoken word, which costs one small request and means a
 * library with no such genre asks for nothing at all and shows no chip.
 *
 * What this cannot reach is a record whose `RELEASETYPE` says audiobook while
 * its genre says Fiction. The album screen knows that one, since it has the
 * album in its hands; finding them all would mean pulling every album in the
 * library down to look, which is not worth a chip.
 */
export async function getAudiobookAlbums(): Promise<Subsonic.Album[]> {
  const genres = await getGenres();
  const names = genres.filter((g) => isAudiobookGenre(g.value)).map((g) => g.value);
  if (names.length === 0) return [];
  const pages = await Promise.all(
    names.map((name) => getAlbumsByGenre(name, AUDIOBOOK_PAGE, 0).catch(() => [])),
  );
  // One record can carry two of these genres ("Hörbuch" and "Hörspiel"), and
  // it is one book either way.
  const byId = new Map<string, Subsonic.Album>();
  for (const album of pages.flat()) {
    if (!byId.has(album.id)) byId.set(album.id, album);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The orders a genre's albums can be asked for in, on the same terms as its
 * songs: `getAlbumList2` takes one of its own fixed types OR a genre, never
 * both, so a plain Subsonic server has exactly one order to give and no menu
 * is shown.
 */
export type AlbumListSort =
  | 'server'
  | 'alpha'
  | 'frequent'
  | 'artist'
  | 'year'
  | 'added'
  | 'random';

const ND_ALBUM_SORT: Record<AlbumListSort, Navidrome.NdAlbumSort> = {
  // Only reachable when a direction was picked without a field, since `server`
  // is not in the menu (see `genreAlbumSorts`); it is the same album name the
  // server would have sorted by anyway.
  server: 'name',
  alpha: 'name',
  frequent: 'play_count',
  artist: 'artist',
  year: 'max_year',
  added: 'recently_added',
  random: 'random',
};

export function genreAlbumSorts(): AlbumListSort[] {
  if (isOffline()) return [];
  const a = auth();
  if (!canListNative(a)) return [];
  // No "default" here. On a server that can sort, the order it would have
  // given for a genre IS the album's name, which is the next entry down: two
  // ways of saying one thing, and one of them saying nothing about itself.
  // `server` stays in the type because it is still what a server that cannot
  // sort answers, and that one is never offered a menu.
  return ['alpha', 'frequent', 'artist', 'year', 'added', 'random'];
}

export function getAlbumsByGenre(
  genre: string,
  size?: number,
  offset?: number,
  sort: AlbumListSort = 'server',
  dir?: Subsonic.SortDirection,
): Promise<Subsonic.Album[]> {
  const a = auth();
  if ((sort !== 'server' || dir) && canListNative(a)) {
    return ndGenreMap(a)
      .then((byName) => {
        const id = byName.get(genre.toLowerCase());
        if (!id) throw new Error('unknown genre');
        return Navidrome.listAlbums(
          a,
          ND_ALBUM_SORT[sort],
          size ?? 30,
          offset ?? 0,
          enabledFolderIds(a),
          id,
          dir,
        );
      })
      .catch(() => {
        bump('genre albums · native failed');
        return subsonicGenreAlbums(a, genre, size, offset);
      });
  }
  return subsonicGenreAlbums(a, genre, size, offset);
}

function subsonicGenreAlbums(
  a: Subsonic.SubsonicAuth,
  genre: string,
  size?: number,
  offset?: number,
): Promise<Subsonic.Album[]> {
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

/**
 * Songs tagged with a genre. Not the same list as its albums: tags live per
 * file, so a genre's songs can sit inside albums tagged as something else.
 *
 * With several libraries each is asked for the same page and the results are
 * concatenated: this list has no meaningful global order to merge by (the
 * server returns them however it stores them), so there's nothing to sort.
 */
/**
 * Can Navidrome itself be asked for a page of songs on this profile?
 *
 * Needs the password its own API wants, which is kept when logging in to a
 * Navidrome server (and is the same one cleartext auth already stores). A
 * profile that logged in before any of that existed doesn't have it, and gets
 * what Subsonic can do until it logs in again: a box asking for a password in
 * the middle of a music screen is worse than one pill fewer.
 *
 * A library filter is no obstacle: the native listing takes the libraries it
 * should keep to, so it stays one sorted list instead of the per-folder pages
 * the Subsonic path has to stitch together.
 */
function canListNative(a: Subsonic.SubsonicAuth): boolean {
  return a.serverType === 'navidrome' && !!(a.ndPassword ?? a.password);
}

/** Our orders in Navidrome's own words. */
const ND_SORT: Record<Subsonic.SongListSort, Navidrome.NdSongSort> = {
  server: 'title',
  recent: 'play_date',
  added: 'recently_added',
  alpha: 'title',
  frequent: 'play_count',
  random: 'random',
};

/**
 * The songs played most recently, newest first. Straight off this device's own
 * history, which records every song as it starts and is what the "Recently
 * played" screen shows.
 *
 * Not the albums: deriving this from the recently played ALBUMS puts the whole
 * record in the list the moment one of its songs plays, which is not what
 * anybody means by recent songs. Subsonic has no endpoint that answers this,
 * and the history is the honest answer the device already holds.
 */
async function recentSongs(count: number): Promise<Subsonic.Song[]> {
  await usePlayHistory.getState().hydrate();
  return usePlayHistory
    .getState()
    .entries.slice(0, count)
    .map((e) => e.song);
}

/**
 * Songs of the albums the server puts first for this order, album by album and
 * in that order: how "recently added" and "most played" songs are arrived at on
 * a server that can only sort albums. Whole albums are the right answer for
 * these two: an album is added at once, and playing it through is what makes it
 * a most played one.
 *
 * It goes through this layer's own `getAlbumList` on purpose: that is where the
 * several-libraries merge lives, along with the corrections a raw server list
 * needs.
 *
 * The pool is deliberately small: every album is a request of its own.
 */
const DERIVED_POOL = 15;

async function derivedSongList(
  sort: 'added' | 'frequent',
  count: number,
): Promise<Subsonic.Song[]> {
  const type = sort === 'added' ? 'newest' : 'frequent';
  // And counted at the other end too, whatever the reason for being here: this
  // is the one list in the app that costs fifteen requests to draw.
  bump('song list · from albums');
  const albums = await getAlbumList(type, DERIVED_POOL);
  const parts = await Promise.all(
    albums.map((al) =>
      // Through the query cache, under the same key the album screen uses: an
      // album opened a minute ago, or one this list already asked for, costs
      // nothing the second time. Fifteen requests every time the screen was
      // shown is what this list used to be.
      queryClient
        .fetchQuery({ queryKey: ['album', al.id], queryFn: () => getAlbum(al.id) })
        .then((d) => d.songs)
        .catch(() => [] as Subsonic.Song[]),
    ),
  );
  const songs = parts.flat();
  // Most played is the one order the songs themselves can improve on, when the
  // server counts plays per song (OpenSubsonic). Otherwise the albums' order is
  // the best there is.
  if (sort === 'frequent' && songs.some((s) => (s.playCount ?? 0) > 0)) {
    return songs
      .filter((s) => (s.playCount ?? 0) > 0)
      .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
      .slice(0, count);
  }
  return songs.slice(0, count);
}

/**
 * The library's songs, a page at a time (the Songs screen). Offline it is the
 * local catalog, which can order itself because it is already in memory; on a
 * server it is whatever that server can do, which `songListSorts` states.
 */
export function getSongList(
  sort: Subsonic.SongListSort = 'server',
  count = 50,
  offset = 0,
): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getSongList(sort, count, offset);
  const a = auth();
  // Navidrome sorts and pages songs through its own API, which is the only way
  // any of this is alphabetical. If it says no (an older server, a password
  // that no longer works, anything), the Subsonic paths below still answer.
  if (canListNative(a)) {
    return Navidrome.listSongs(a, ND_SORT[sort], count, offset, enabledFolderIds(a)).catch(() => {
      // Counted, because falling back here is expensive and silent: Navidrome
      // sorts songs itself in one request, and what follows sorts albums and
      // then asks for fifteen of them. A server where this quietly fails looks
      // exactly like one that never had the native path at all.
      bump('song list · native failed');
      return subsonicSongList(a, sort, count, offset);
    });
  }
  return subsonicSongList(a, sort, count, offset);
}

/** What a Subsonic server can do about listing songs, orders included. */
function subsonicSongList(
  a: Subsonic.SubsonicAuth,
  sort: Subsonic.SongListSort,
  count: number,
  offset: number,
): Promise<Subsonic.Song[]> {
  // Jellyfin sorts songs itself; the rest need the albums as a way in. Derived
  // orders are a capped list rather than a window, so there is nothing to hand
  // back past the first page.
  if (a.serverType !== 'jellyfin' && sort === 'recent') {
    return offset > 0 ? Promise.resolve([]) : recentSongs(count);
  }
  if (a.serverType !== 'jellyfin' && (sort === 'added' || sort === 'frequent')) {
    return offset > 0 ? Promise.resolve([]) : derivedSongList(sort, count);
  }
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getSongList(a, sort, count, offset);
  if (ids.length === 1) return Subsonic.getSongList(a, sort, count, offset, ids[0]);
  // Several libraries: the same page from each, concatenated. Like the songs of
  // a genre, this listing has no global order to merge by.
  return Promise.all(ids.map((id) => Subsonic.getSongList(a, sort, count, offset, id))).then(
    (lists) => dedupeById(lists.flat()).slice(0, count),
  );
}

/**
 * Orders the Songs screen can offer here, in the order it shows them, which is
 * the one browsing albums and artists already use.
 *
 * Offline the catalog is in memory, so it sorts by anything without asking
 * anyone. Jellyfin sorts songs itself, and so does Navidrome when its own API
 * can be reached. What is left is a Subsonic server that cannot sort songs at
 * all: there the rest are arrived at through the albums it does sort, and its
 * own order stands where A-Z would be, being the only listing that really
 * covers everything.
 */
export function songListSorts(): Subsonic.SongListSort[] {
  const full: Subsonic.SongListSort[] = ['recent', 'frequent', 'added', 'alpha', 'random'];
  if (isOffline()) return full;
  const a = auth();
  if (a.serverType === 'jellyfin' || canListNative(a)) return full;
  return ['recent', 'frequent', 'added', 'server', 'random'];
}

// ── A genre's songs, in an order somebody chose ─────────────────────────────
// `getSongsByGenre` is a Subsonic endpoint that takes a genre, a count and an
// offset, and no order at all. Sorting the page that happens to be loaded is
// not an answer: "alphabetical" over the fifty songs the server sent first is
// not the fifty songs that come first alphabetically, and the list would
// reshuffle itself every time another page arrived. So the order has to be the
// server's, and only a server that can give one gets asked (`genreSongSorts`).

/**
 * Genre name to the id Navidrome's own filters take, per profile.
 *
 * One request for the whole list, kept for the session. The key carries the
 * profile so a second account does not inherit the first one's ids, which are
 * not the same numbers on another server.
 */
const ndGenreIds = new Map<string, Promise<Map<string, string>>>();

function ndGenreMap(a: Subsonic.SubsonicAuth): Promise<Map<string, string>> {
  const key = profileScopeId();
  const known = ndGenreIds.get(key);
  if (known) return known;
  const asking = Navidrome.listGenres(a)
    .then((list) => new Map(list.map((g) => [g.name.toLowerCase(), g.id])))
    .catch((e: unknown) => {
      // Not cached: a hiccup here would send every genre listing down the
      // unsorted path for the rest of the session.
      ndGenreIds.delete(key);
      throw e;
    });
  ndGenreIds.set(key, asking);
  return asking;
}

/**
 * The orders a genre's songs can be asked for in.
 *
 * Empty means the server has none to give, and the screen shows no control at
 * all rather than one that would sort what is on screen and nothing else.
 *
 * Two backends can: Jellyfin, which filters items by genre and sorts them in
 * the same request, and Navidrome through its own API. What is left is plain
 * Subsonic and Ampache, where `getSongsByGenre` takes a genre, a count and an
 * offset and no order at all, so there is nothing to offer and nothing to
 * pretend.
 *
 * The first is what the screen opens on, and on both of them it is by album
 * rather than by whatever the server would have said on its own, so the screen
 * names it for that.
 */
/**
 * Which way round each of those reads before anybody says otherwise. The
 * server's own idea of each one: A-Z for the ones that read as a list, newest
 * or most first for the ones about time and counting.
 */
export function genreSongDir(sort: Subsonic.SongListSort): Subsonic.SortDirection {
  return sort === 'added' || sort === 'recent' || sort === 'frequent' ? 'desc' : 'asc';
}

export function genreAlbumDir(sort: AlbumListSort): Subsonic.SortDirection {
  return sort === 'added' || sort === 'year' || sort === 'frequent' ? 'desc' : 'asc';
}

export function genreSongSorts(): Subsonic.SongListSort[] {
  if (isOffline()) return [];
  const a = auth();
  if (a.serverType !== 'jellyfin' && !canListNative(a)) return [];
  return ['server', 'frequent', 'alpha', 'added', 'recent', 'random'];
}

/**
 * What the genre opens on, where the server can be asked for an order.
 *
 * A genre is a heap of songs off dozens of records, and the useful way through
 * it is record by record: the album's songs together, in the order they were
 * meant to be heard. Navidrome's `album` sort is exactly that — it expands to
 * the album's sort name, then disc, then track — and Jellyfin answers the same
 * shape from `Album,ParentIndexNumber,IndexNumber`, which it has always done
 * here. So what both hand back reads like the Albums tab with each record
 * opened out.
 *
 * Plain Subsonic's `getSongsByGenre` sorts by nothing at all. Its list stays
 * complete and paged, in whatever order that server felt like, and there is no
 * menu to change it with. Deriving the order there —asking for the genre's
 * albums and expanding each one, the way the Songs screen arrives at "recently
 * added"— would cost more than it gives: that route is a capped list rather
 * than a window, so a genre would quietly stop after a dozen records, and it
 * is the same call the download walks to gather everything.
 */
const ND_GENRE_DEFAULT: Navidrome.NdSongSort = 'album';

export function getSongsByGenre(
  genre: string,
  count = 50,
  offset = 0,
  sort: Subsonic.SongListSort = 'server',
  dir?: Subsonic.SortDirection,
): Promise<Subsonic.Song[]> {
  const a = auth();
  if (canListNative(a)) {
    return ndGenreMap(a)
      .then((byName) => {
        const id = byName.get(genre.toLowerCase());
        // The server knows no genre by that name: nothing to filter by, and
        // guessing would list the whole library under one genre's heading.
        if (!id) throw new Error('unknown genre');
        const nd = sort === 'server' ? ND_GENRE_DEFAULT : ND_SORT[sort];
        return Navidrome.listSongs(a, nd, count, offset, enabledFolderIds(a), id, dir);
      })
      .catch(() => {
        // Counted like the library listing's own fallback: a server where this
        // quietly fails looks exactly like one that never offered the orders,
        // except it offered them.
        bump('genre songs · native failed');
        return subsonicGenreSongs(a, genre, count, offset, sort, dir);
      });
  }
  return subsonicGenreSongs(a, genre, count, offset, sort, dir);
}

function subsonicGenreSongs(
  a: Subsonic.SubsonicAuth,
  genre: string,
  count: number,
  offset: number,
  // Carried through for Jellyfin, which is the one backend behind this door
  // that can order a genre. A Subsonic server ignores it, which is why the
  // screen is never offered the choice there.
  sort: Subsonic.SongListSort = 'server',
  dir?: Subsonic.SortDirection,
): Promise<Subsonic.Song[]> {
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getSongsByGenre(a, genre, count, offset, undefined, sort, dir);
  if (ids.length === 1) {
    return Subsonic.getSongsByGenre(a, genre, count, offset, ids[0], sort, dir);
  }
  return Promise.all(
    ids.map((id) => Subsonic.getSongsByGenre(a, genre, count, offset, id, sort, dir)),
  ).then((lists) => dedupeById(lists.flat()).slice(0, count));
}

// ── Folder navigation (Subsonic servers only; the UI hides it on
// Jellyfin and offline) ───────────────────────────────────────────────────
export function getMusicFolders(): Promise<Subsonic.MusicFolder[]> {
  return Subsonic.getMusicFolders(auth());
}

/** Top-level directories of a library (folder root). */
export function getFolderIndexes(musicFolderId?: string): Promise<Subsonic.FolderEntry[]> {
  return Subsonic.getIndexes(auth(), musicFolderId);
}

/** Contents of a directory: subfolders + songs. */
export function getMusicDirectory(id: string): Promise<Subsonic.FolderContents> {
  return Subsonic.getMusicDirectory(auth(), id);
}

export function getArtist(id: string): Promise<{ artist: Subsonic.Artist; albums: Subsonic.Album[] }> {
  if (isOffline()) {
    if (serverOffline()) return mirrorArtist(id);
    return Local.getArtist(id);
  }
  return Subsonic.getArtist(auth(), id)
    .catch(async (e: unknown) => {
      // An id the server does not know, which happens with an artist opened
      // from something that was written down offline: down there they are
      // keyed by their name, and that key means nothing up here. The catalog
      // holds both, so this is one lookup away from being the right artist
      // rather than an error message (see `Local.serverArtistId`).
      const mapped = await Local.serverArtistId(id);
      if (!mapped || mapped === id) throw e;
      return Subsonic.getArtist(auth(), mapped);
    })
    .then((res) => {
      useLibraryMirror.getState().saveArtist(res.artist.id, res.artist, res.albums);
      // Their picture, for the downloads, while there is a connection to get
      // it with. Only if their music is on the phone; it decides that itself.
      void noteDownloadedArtist(auth(), res.artist);
      return res;
    });
}

async function mirrorArtist(
  id: string,
): Promise<{ artist: Subsonic.Artist; albums: Subsonic.Album[] }> {
  await loadMirror();
  const mirror = useLibraryMirror.getState();
  const d = await mirror.artistDetail(id);
  // Album art resolved by their id (so they work offline).
  if (d) return { artist: d.artist, albums: d.albums.map((al) => ({ ...al, coverArt: al.id })) };
  // No entry of their own: reachable all the same, from a favourited album
  // whose artist was never opened online. Their name and their albums are in
  // what the mirror does hold. Without this the screen showed the server's id
  // where the name goes, since the local catalog is keyed by name and cannot
  // answer for a server id either.
  const found = await mirror.artistFallback(id);
  if (found.name || found.albums.length > 0) {
    return {
      artist: { id, name: found.name ?? '', albumCount: found.albums.length },
      albums: found.albums.map((al) => ({ ...al, coverArt: al.id })),
    };
  }
  return Local.getArtist(id);
}

export function getArtistInfo(id: string): Promise<Subsonic.ArtistInfo> {
  if (isOffline()) return Promise.resolve(Local.getArtistInfo(id));
  return Subsonic.getArtistInfo(auth(), id);
}

/** Albums where the artist appears without being the album artist. */
export function getAppearsOn(artistId: string, artistName: string): Promise<Subsonic.GuestAlbum[]> {
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

/** Songs similar to a given one (suggestions). Online only. */
export function getSimilarSongs(id: string, count?: number): Promise<Subsonic.Song[]> {
  if (isOffline()) return Promise.resolve([]);
  return Subsonic.getSimilarSongs(auth(), id, count);
}

/** Most played songs (composition over "frequent" albums in Subsonic). */
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
 * Random songs from the library (the Home mix).
 *
 * With several libraries active each one is asked separately, since the API
 * filters by one at a time, and the merged result is shuffled so they don't
 * come out grouped.
 *
 * How much each one is asked for is the whole question. Asking them all for
 * the same amount and shuffling afterwards is one turn each in disguise: the
 * pool is already biased and no shuffle over it can undo that (issue #39). So
 * each brings its share, by the same weights the random album shelf uses.
 *
 * A genre is left alone: those weights say how much music a library holds, not
 * how much of a given genre, and a library that happens to own most of it would
 * be asked for a fraction of what it could give.
 */
export async function getRandomSongs(size = 200, genre?: string): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getRandomSongs(size);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.getRandomSongs(a, size, genre);
  if (ids.length === 1) return Subsonic.getRandomSongs(a, size, genre, ids[0]);
  const depths = genre ? ids.map(() => size) : await randomDepths(a, ids, size);
  const lists = await Promise.all(
    ids.map((fid, i) => Subsonic.getRandomSongs(a, depths[i], genre, fid)),
  );
  return shuffled(dedupeById(lists.flat())).slice(0, size);
}

export function getPlaylists(): Promise<Subsonic.Playlist[]> {
  if (isOffline()) {
    if (serverOffline()) return mirrorPlaylists();
    return Local.getPlaylists();
  }
  // Whose list this is, read before asking rather than when the answer lands:
  // a profile switch while the request is in flight would otherwise measure the
  // new profile's recents against the old one's playlists and delete the lot.
  const asked = profileScopeId();
  return Subsonic.getPlaylists(auth()).then((list) => {
    useLibraryMirror.getState().savePlaylists(list);
    // These are all of them, so a playlist recorded as played and not in here
    // was deleted on the server. Its record outlived it and kept drawing a tile
    // on Home and a row in the car's Recents, both of which are drawn from what
    // was written down when it played rather than from any list: that is what
    // let it survive clearing the cache. Only on the way back from the server,
    // never from the mirror or the local files, which are not the whole story.
    if (profileScopeId() === asked) {
      useLastPlayed.getState().forgetMissing(
        'playlist',
        list.map((p) => p.id),
      );
    }
    // Cache each playlist's tracklist in the background so they are
    // available offline without opening them one by one (non-blocking).
    void prefetchPlaylistDetails(list);
    return list;
  });
}

/**
 * Caches the tracklist of favourited albums for offline, a few at a time.
 *
 * Favouriting an album put it in the offline Library but not its songs: only
 * albums that had been opened online were stored, so a favourite you had never
 * looked at opened empty and the screen bailed. Keeping them all was out of
 * the question while the mirror was one file rewritten in full; now an album
 * is a row of its own.
 *
 * Same manners as the playlists: nothing while the app is opening, a handful
 * per run, and a long wait in between. It is a convenience for a mode that may
 * never be used, so it never competes with what somebody is waiting for.
 */
let prefetchingAlbums = false;
let lastAlbumPrefetch = 0;
const ALBUM_PREFETCH_PER_RUN = 8;

async function prefetchStarredAlbums(albums: Subsonic.Album[]): Promise<void> {
  if (prefetchingAlbums) return;
  if (Date.now() - appStartedAt < PREFETCH_QUIET_MS) return;
  if (Date.now() - lastAlbumPrefetch < PREFETCH_COOLDOWN_MS) return;
  const a = useAuthStore.getState().auth;
  if (!a || albums.length === 0) return;
  prefetchingAlbums = true;
  lastAlbumPrefetch = Date.now();
  try {
    const stored = await useLibraryMirror.getState().albumIds();
    const missing = albums.filter((al) => !stored.has(al.id)).slice(0, ALBUM_PREFETCH_PER_RUN);
    const dl = useDownloads.getState();
    for (const al of missing) {
      try {
        const res = await Subsonic.getAlbum(a, al.id);
        useLibraryMirror.getState().saveAlbum(al.id, res.album, res.songs, dl);
      } catch {
        // Best effort: whatever fails is tried again on the next run.
      }
    }
  } finally {
    prefetchingAlbums = false;
  }
}

/** Prevents overlapping prefetch runs (getPlaylists can fire multiple times). */
let prefetchingPlaylists = false;
/**
 * And a cooldown between runs. `getPlaylists` fires on Home and on the Library,
 * so this ran on every visit; it skips what hasn't changed, which is free when
 * nothing does, but a server with smart playlists moves `changed` on its own
 * and there the whole tracklist came down again and again (#50).
 */
const PREFETCH_COOLDOWN_MS = 10 * 60 * 1000;
let lastPlaylistPrefetch = 0;
/**
 * Tracklists fetched per run: the rest wait for the next one.
 *
 * On a real server this went and got all twenty five at once, 37 MB of JSON
 * downloaded and parsed on the JS thread, during the cold start, for an offline
 * mode that may never be used that session. Now it is a trickle.
 */
const PREFETCH_PER_RUN = 5;
/** And not while the app is still opening, which is when it can least afford
 *  it: Home is fetching its shelves and the mirror is being read. */
const PREFETCH_QUIET_MS = 20 * 1000;
const appStartedAt = Date.now();

/**
 * In the background, caches the tracklist of server playlists for offline
 * mode. Skips those that already have details with the same `changed` (cheap
 * after the first sync) and limits concurrency. Best-effort: ignores
 * failures and writes the mirror only once when done.
 */
async function prefetchPlaylistDetails(list: Subsonic.Playlist[]): Promise<void> {
  if (prefetchingPlaylists) return;
  if (Date.now() - appStartedAt < PREFETCH_QUIET_MS) return;
  if (Date.now() - lastPlaylistPrefetch < PREFETCH_COOLDOWN_MS) return;
  const a = useAuthStore.getState().auth;
  if (!a) return;
  prefetchingPlaylists = true;
  lastPlaylistPrefetch = Date.now();
  try {
    await loadMirror();
    // Which ones are stored and at which version, in one query rather than
    // the whole mirror in memory. No size limit any more: a long playlist is
    // now one row of its own instead of a rewrite of everything.
    const cached = await useLibraryMirror.getState().playlistVersions();
    // Only those missing or changed on the server (by `changed`).
    const stale = list
      .filter((p) => {
        const prev = cached[p.id];
        return !(p.id in cached) || (p.changed != null && prev !== p.changed);
      })
      .slice(0, PREFETCH_PER_RUN);
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
    // And the covers of what is already stored, which no fetch would ever reach
    // again: a playlist kept since before covers were saved at all is skipped
    // here for ever, since the server keeps saying it has not changed.
    useLibraryMirror.getState().keepStoredCovers();
  } finally {
    prefetchingPlaylists = false;
  }
}

/** Mirror playlists: ALL server playlists that have been seen online (even if
 *  nothing is downloaded); within those, downloaded ones play and the rest are
 *  grayed out. Album art uses the first downloaded track (resolves offline) or
 *  the playlist's own. Without a mirror copy yet, falls back to local behavior. */
async function mirrorPlaylists(): Promise<Subsonic.Playlist[]> {
  await loadMirror();
  const mirror = useLibraryMirror.getState();
  const stored = await mirror.playlists();
  const qpls = useOfflineQueue.getState().data.playlists ?? {};
  const files = useDownloads.getState().files;
  if (!stored && Object.keys(qpls).length === 0) return Local.getPlaylists();

  // The song ids of the ones being listed, in one query. What this screen needs
  // of a tracklist is how long it is and which song is the first downloaded
  // one; reading the tracklists themselves was a query per playlist and every
  // song in them parsed, fifty times over, each time Home or the Library drew.
  const details = await mirror.playlistSongIds();

  // The cover of a playlist without one is the album art of one of its tracks:
  // a downloaded one for preference, since that album's cover is certainly on
  // the phone, and otherwise simply the first, whose cover the mirror has
  // probably kept too. Falling back only to downloaded tracks left a playlist
  // with none of them as a blank tile on Home, which is what it looked like.
  // The ids are resolved in one go rather than one at a time inside the loop.
  const firstDownloaded = (songIds: string[]) => songIds.find((sid) => files[sid]);
  const firstShowable = (songIds: string[]) => firstDownloaded(songIds) ?? songIds[0];
  const wanted: string[] = [];
  for (const edit of Object.values(qpls)) {
    if (!edit.created || edit.deleted) continue;
    const f = firstShowable(edit.songIds ?? []);
    if (f) wanted.push(f);
  }
  for (const p of stored ?? []) {
    if (p.coverArt) continue;
    const known = details.get(p.id);
    const songIds = qpls[p.id]?.songIds ?? (known && known.length > 0 ? known : []);
    const f = firstShowable(songIds);
    if (f) wanted.push(f);
  }
  const covers = await resolveSongs(wanted);

  const out: Subsonic.Playlist[] = [];
  // Playlists created offline (still with a temporary id).
  for (const [id, edit] of Object.entries(qpls)) {
    if (!edit.created || edit.deleted) continue;
    const songIds = edit.songIds ?? [];
    const firstDl = firstShowable(songIds);
    out.push({
      id,
      name: edit.name ?? '',
      songCount: songIds.length,
      coverArt: firstDl ? covers.get(firstDl)?.albumId : undefined,
      comment: edit.comment,
      public: edit.public,
    });
  }
  // Server playlists with overlay (rename/tracklist), minus deleted ones.
  for (const p of stored ?? []) {
    const edit = qpls[p.id];
    if (edit?.deleted) continue;
    // An empty list is not a tracklist we know: a stored playlist whose entry
    // has no songs in it comes back that way, and taking it at its word turned
    // the count into "0 songs" for playlists nobody had opened yet.
    const stored = details.get(p.id);
    const detailIds = stored && stored.length > 0 ? stored : undefined;
    const songIds = edit?.songIds ?? detailIds ?? [];
    const firstDl = firstShowable(songIds);
    // With known tracklist (cached details or offline edit) the real count;
    // otherwise, the count provided by the server playlist.
    const haveTracks = edit?.songIds != null || detailIds != null;
    out.push({
      ...p,
      name: edit?.name ?? p.name,
      songCount: haveTracks ? songIds.length : p.songCount,
      // The playlist's own cover comes first: it's the image the user set on
      // the server, and replacing it with the album art of whichever track
      // happened to be downloaded looked like a random cover offline. The
      // downloaded album art is only a fallback for playlists without one,
      // where it's better than nothing.
      coverArt: p.coverArt ?? (firstDl ? covers.get(firstDl)?.albumId : undefined),
    });
  }
  return out;
}

/**
 * Whether the favorites arrive newest-favorited first, which decides what the
 * Favorites screen calls its first order.
 *
 * Subsonic's `getStarred` is sorted by when each thing was starred, so what
 * comes back already is "recently added" and can say so. Jellyfin has no such
 * sort —being a favorite is a flag on the item, without a date to order by—
 * and answers in its own order, so there the list is only "however this server
 * keeps them". The local profile does keep the order they were marked in, and
 * `localQueries.getStarred` hands them back that way round.
 */
export function starredByDate(): boolean {
  return useAuthStore.getState().auth?.serverType !== 'jellyfin';
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
  // Copy for offline mode (Library as server mirror).
  return p.then((s) => {
    useLibraryMirror.getState().saveStarred(s);
    // And, in the background, the tracklists of the favourited albums, so they
    // open offline instead of being listed and then coming up empty.
    void prefetchStarredAlbums(s.albums ?? []);
    return s;
  });
}

/** Favorites from the mirror (server offline); if no copy exists yet, falls
 *  back to the usual local behavior (derived from downloads).
 *
 *  Favorite songs: all, with non-downloaded ones grayed out. Albums and
 *  artists: all favorited ones (albums without downloads look the same and
 *  open gray/empty, like the rest of non-downloaded content). */
async function mirrorStarred(): Promise<Subsonic.Starred> {
  await loadMirror();
  const mirror = useLibraryMirror.getState();
  // The shelf: what is asked of it here is which albums are downloaded, and
  // that does not need the songs behind them.
  const catalog = await getDownloadShelf();
  await useOfflineQueue.getState().load();
  const favs = useOfflineQueue.getState().data.favs ?? {};
  const hasQueue = Object.keys(favs).length > 0;

  // Base: the server snapshot. If no copy yet but there are offline changes,
  // we start from local to avoid losing favorites made offline.
  const base = (await mirror.starred()) ?? (hasQueue ? await Local.getStarred() : null);
  if (!base) return Local.getStarred();

  let songs = base.songs ?? [];
  let albums = base.albums ?? [];
  let artists = base.artists ?? [];

  // The downloaded albums by id, so the loop below asks a map rather than
  // walking the catalog once per favourite added offline.
  const catalogAlbums = new Map(catalog.albums.map((a) => [a.id, a]));

  // Outbox overlay: remove unstarred ones and add those starred offline.
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
        const a = (await mirror.albumDetail(id))?.album ?? catalogAlbums.get(id);
        if (a) albums = [a, ...albums];
      }
    } else if (v.type === 'artist') {
      if (!artists.some((x) => x.id === id)) {
        const a = (await mirror.artistDetail(id))?.artist;
        if (a) artists = [a, ...artists];
      }
    } else if (!songs.some((x) => x.id === id)) {
      const song = await resolveSong(id);
      if (song) songs = [song, ...songs];
    }
  }

  // Favorited albums: ALL of them, even if they have no downloaded songs (they
  // open grayed out like non-downloaded songs, or empty if never seen online).
  // Downloaded ones use their local album art (by id); non-downloaded ones keep
  // the server URL, served from expo-image's cache if seen online (or downloaded
  // if offline is manual with network).
  const downloadedAlbumIds = new Set(catalog.albums.map((a) => a.id));
  albums = albums.map((al) =>
    downloadedAlbumIds.has(al.id) ? { ...al, coverArt: al.id } : al,
  );

  return { songs: annotate(songs), albums, artists };
}

export function star(id: string, type?: Subsonic.StarType): Promise<void> {
  if (isOffline()) {
    // Server offline: recorded in the outbox and uploaded on reconnect.
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
 * Flushes the offline action queue to the server (on reconnect). Best-effort:
 * whatever fails is kept for the next reconnection.
 */
export async function flushOfflineQueue(auth: Subsonic.SubsonicAuth): Promise<void> {
  const q = useOfflineQueue.getState();
  await q.load();
  // Read the outbox through this, never off `q`: `getState()` hands back a
  // snapshot of the moment it was called, and both the load above and the
  // repair below replace it. Read off the snapshot taken on the way in, a
  // flush that had just read the file uploaded what was in memory before it,
  // which on a cold start is an empty queue. The actions are safe to keep,
  // they go through the store themselves.
  const data = () => useOfflineQueue.getState().data;

  // Settle a possible id migration BEFORE anything goes up.
  //
  // Going back online pings, and a ping that sees a new server version starts
  // the migration check in the background. The flush used to run right behind
  // it, so a race that nobody would ever reproduce by hand could upload every
  // queued favourite and listen against ids the server had just renumbered.
  // Those are accepted, match nothing, and are then dropped from the outbox as
  // sent: the one way this repair could lose the very data it exists to save.
  //
  // Only paid for when there is something to lose. On an empty outbox there is
  // nothing to get wrong, and a profile already settled answers from its mark
  // without a request.
  if (!q.isEmpty()) {
    try {
      await (await import('@/lib/navidromeRepair')).repairIfMigrated(auth);
    } catch {
      // A check that could not run is not a reason to hold somebody's
      // favourites hostage: the ids are no more wrong than they were.
    }
  }

  // Favorites.
  const favs = data().favs ?? {};
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

  // Ratings.
  const ratings = data().ratings ?? {};
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

  // Listens. Each one goes up with the time it happened, so an evening's music
  // lands where it belongs in the server's history (and in Last.fm) instead of
  // arriving all at once the moment the phone finds the network. Sent oldest
  // first, and only what actually arrived is taken off the queue.
  const plays = data().plays ?? [];
  bump('outbox · plays queued', plays.length);
  const sent: PlayOp[] = [];
  let refused = 0;
  for (const play of plays) {
    try {
      await Subsonic.submitPlay(auth, play.id, play.at);
      sent.push(play);
      refused = 0;
    } catch (e) {
      // Out of network again: the ones behind would each wait out a timeout to
      // learn the same thing. They keep their turn for the next reconnection.
      if (e instanceof Subsonic.SubsonicRequestError && e.network) {
        bump('outbox · plays no network');
        break;
      }
      bump('outbox · plays refused');
      // The server answered and turned this one down, which is usually about
      // that listen alone (a song no longer on the server), so it doesn't get
      // to hold up the rest. Several in a row is the server or the session
      // refusing everything, and there is no sense walking the whole queue to
      // hear it again. Nothing is discarded either way.
      if (++refused >= 5) break;
    }
  }
  bump('outbox · plays sent', sent.length);
  if (sent.length > 0) q.removePlays(sent);

  // Playlists. Rewrites the final state of each one (create/delete/rename +
  // full tracklist via reorderPlaylist, which avoids index juggling).
  const playlists = data().playlists ?? {};
  const plFailed: [string, QueuePlaylist][] = [];
  for (const [id, edit] of Object.entries(playlists)) {
    try {
      if (edit.created) {
        if (edit.deleted) continue; // created and deleted offline: nothing to upload
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
 * Snapshots the current state of the React Query cache (playlists,
 * favorites, albums) into the mirror just before going offline. This way, if
 * you edit something online (e.g. remove a song from a playlist) and then go
 * offline without that query being refetched, the mirror reflects the latest
 * seen state instead of sticking with the old server copy.
 */
export function snapshotCachesToMirror(): Promise<void> {
  const mirror = useLibraryMirror.getState();
  // The two lists, which are the ones that may have moved without being
  // written: everything else — an album, a playlist's tracklist — was written
  // when it arrived, so walking the cache to write it again was doing a whole
  // session's work a second time, and the more you had browsed the longer it
  // took. That is what made the app feel slower the longer it ran.
  const playlists = queryClient.getQueryData<Subsonic.Playlist[]>(['playlists']);
  if (playlists) mirror.savePlaylists(playlists);
  const starred = queryClient.getQueryData<Subsonic.Starred>(['starred']);
  if (starred) mirror.saveStarred(starred);
  // And nothing may be left waiting: from here on the mirror is not a copy of
  // what was browsed, it is the library.
  return mirror.flush();
}

/** Rate a song (1-5; 0 removes the rating). */
export function setRating(id: string, rating: number): Promise<void> {
  if (isOffline()) {
    // Server offline: recorded in the outbox and uploaded on reconnect.
    if (serverOffline()) useOfflineQueue.getState().setRating(id, rating);
    return Promise.resolve();
  }
  return Subsonic.setRating(auth(), id, rating);
}

/**
 * Album-only search (for filtering while browsing). Goes to the server because
 * the album list is paginated: filtering client-side would only look at
 * already-loaded pages.
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

/** Songs matching the text: what browsing songs searches with. */
export function searchSongs(query: string, count?: number): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.searchSongs(query, count);
  const a = auth();
  const ids = enabledFolderIds(a);
  if (!ids) return Subsonic.searchSongs(a, query, count);
  if (ids.length === 1) return Subsonic.searchSongs(a, query, count, ids[0]);
  return Promise.all(ids.map((id) => Subsonic.searchSongs(a, query, count, id))).then((parts) =>
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

/**
 * Lyrics for a song, from wherever this profile's lyrics come from.
 *
 * The decision used to live in the hook that displays them, which made it the
 * one screen that knew about servers and files at the same time. It belongs
 * here, with the rest of the choosing: offline it reads what is on the phone,
 * online it asks the server and falls back the way the setting says.
 *
 * Three places have them, and they are not interchangeable. A downloaded song
 * kept its `.lrc` beside the file, and a track from the phone's own library can
 * carry them inside (USLT). The server has whatever it was given. LRCLIB is a
 * public database, and whether it is asked at all is the person's choice
 * (Settings › Lyrics): as a fallback, as the first place to look, or never.
 */
export async function getSongLyrics(
  song: Song,
  source: LyricsSource,
): Promise<Subsonic.SongLyrics | null> {
  const allowOnline = source !== 'off';
  const preferOnline = source === 'online';
  const downloaded = () => song.localUri ?? useDownloads.getState().files[song.id];
  // Offline: the phone first, and the question is whether anything else is
  // allowed at all. LRCLIB is not this server: an offline the app fell into
  // means one server stopped answering, and the phone's connection is very
  // probably fine, so the lyrics are still there to be found. An offline
  // somebody chose means use no network, and that covers LRCLIB too (#89).
  if (isOffline()) {
    const online = allowOnline && !isManualOffline();
    const uri = downloaded();
    if (uri) return getLocalLyrics({ ...song, localUri: uri }, online, preferOnline);
    return online ? getOnlineLyrics(song) : null;
  }
  // A file already on the phone is read first even online: it is right there,
  // and it is what the person chose to carry.
  if (song.localUri) return getLocalLyrics(song, allowOnline, preferOnline);
  if (!useAuthStore.getState().auth) return null;
  if (__DEV__) {
    console.log(`[lyrics] asking · source=${source} · ${song.artist} — ${song.title}`);
  }
  try {
    // 'online': LRCLIB first (it absorbs its own network errors and answers
    // null), then the server.
    if (preferOnline) {
      const online = await getOnlineLyrics(song);
      if (online) return online;
    }
    try {
      const structured = await Subsonic.getLyricsBySongId(auth(), song.id);
      if (structured) return structured;
      // It answered, and it has nothing. The classic endpoint reads the same
      // place, so asking it as well was a second request per song for an answer
      // already given: seventy of them in a twenty three minute session, queued
      // in front of what the screens were waiting for (#50). Only a server that
      // rejects the modern one, which throws, gets the old question.
      return allowOnline && !preferOnline ? getOnlineLyrics(song) : null;
    } catch {
      // Server without the songLyrics extension: try the classic endpoint.
    }
    const plain = await Subsonic.getLyrics(auth(), song.artist ?? '', song.title ?? '');
    if (plain) return { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
    // The server has none: LRCLIB if allowed and not already tried above.
    if (allowOnline && !preferOnline) return getOnlineLyrics(song);
    return null;
  } catch (e) {
    if (__DEV__) console.log('[lyrics] the server path threw', e);
    // Only reached with no network: with one, the inner catch has already
    // absorbed a server without the extension. A downloaded song still has the
    // `.lrc` saved next to it when it was downloaded.
    const dl = downloaded();
    if (dl) return getLocalLyrics({ ...song, localUri: dl }, allowOnline, preferOnline);
    throw e;
  }
}

export function scrobble(id: string): Promise<void> {
  if (isOffline()) return Promise.resolve();
  // The backend lets its errors through now (#126). This one keeps the shape it
  // had: the player is what decides to keep a refused listen, and it does not
  // come through here.
  return Subsonic.scrobble(auth(), id).catch(() => {});
}

export async function addToPlaylist(playlistId: string, songId: string): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.addToPlaylist(playlistId, songId);
    const ids = await currentPlaylistSongIds(playlistId);
    useOfflineQueue.getState().setPlaylist(playlistId, { songIds: [...ids, songId] });
    // Save the song's metadata so it can be displayed in the offline playlist.
    const song = await resolveSong(songId);
    if (song) useOfflineQueue.getState().rememberSongs([song]);
    return;
  }
  return Subsonic.addToPlaylist(auth(), playlistId, songId);
}

/** Creates an empty playlist and returns its id (temporary if offline). */
export function createPlaylist(name: string): Promise<string> {
  if (isOffline()) {
    if (!serverOffline()) return Local.createPlaylist(name);
    // Temporary id: on reconnect it's created on the server and gets its real id.
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
    // Created offline (never reached the server): just discard it.
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
  const mirror = useLibraryMirror.getState();
  const edit = useOfflineQueue.getState().data.playlists?.[id];
  const detail = await mirror.playlistDetail(id);

  // Playlist metadata: created offline / mirror / at least its name.
  let playlist: Subsonic.Playlist;
  if (edit?.created) {
    playlist = { id, name: edit.name ?? '', comment: edit.comment, public: edit.public };
  } else if (detail) {
    playlist = { ...detail.playlist };
  } else {
    playlist = (await mirror.playlists())?.find((p) => p.id === id) ?? { id, name: id };
  }
  if (edit?.name !== undefined) playlist = { ...playlist, name: edit.name };
  if (edit?.comment !== undefined) playlist = { ...playlist, comment: edit.comment };
  if (edit?.public !== undefined) playlist = { ...playlist, public: edit.public };

  // Tracklist: the outbox edit, or the mirror's.
  const songIds = edit?.songIds ?? detail?.songs.map((s) => s.id);
  if (!songIds) {
    // No saved tracklist nor edit: no songs offline.
    return { playlist: { ...playlist, songCount: 0 }, songs: [] };
  }
  // Every id at once: one query for the playlist instead of one per song.
  const found = await resolveSongs(songIds);
  const songs = songIds
    .map((sid) => found.get(sid))
    .filter((s): s is Subsonic.Song => !!s);
  // The count reflects what is actually shown (annotate may hide non-downloaded ones).
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

/** Reorder a playlist's tracks (drag and drop). */
export async function reorderPlaylist(id: string, songIds: string[]): Promise<void> {
  if (isOffline()) {
    if (!serverOffline()) return Local.reorderPlaylist(id, songIds);
    useOfflineQueue.getState().setPlaylist(id, { songIds });
    return;
  }
  return Subsonic.reorderPlaylist(auth(), id, songIds);
}

// ── Multi-library merging (subset mode) ──
//
// The Subsonic API only filters by one library per request, so when multiple
// are active, each is queried and the results are merged here.

/** Shuffles a copy (Fisher-Yates). */
function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deduplicates by id, keeping the first seen. */
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

/**
 * How deep into each library a page is served from, rounded up so the pages of
 * an infinite scroll share one fetch instead of triggering one each.
 */
const MERGE_DEPTH = 100;

/**
 * How deep "New releases" reads before deciding which records are the newest.
 *
 * It has to cover a whole year of the library, because that is the granularity
 * the server sorts at: anything short of it is still a slice of the alphabet.
 * One request either way (the endpoint caps a page at 500), so what this really
 * buys is fewer albums to parse on the JS thread, which is the part that was
 * costing on Home (#50).
 */
const BYYEAR_WINDOW = 250;

// ── Library sizes (for the random pool) ──
//
// The API has no count of its own, but `getArtists` carries `albumCount` per
// artist and takes a library, so one request per library adds up to how many
// albums it holds. Cached well beyond the album lists: this only moves when the
// server scans, not between one shelf and the next.

const LIBRARY_SIZE_TTL_MS = 24 * 60 * 60 * 1000;
/** Sizes of the active profile's libraries, by folder id. */
const librarySizes = new Map<string, LibrarySize>();
/** Storage key whose sizes are the ones in the map ('' = none read yet). */
let sizesLoadedFor = '';
let sizesLoading: Promise<void> | null = null;

interface LibrarySize {
  at: number;
  count: number;
}

function sizesKey(a: Subsonic.SubsonicAuth): string {
  // Hashed: SecureStore only takes [A-Za-z0-9._-] and a profile key is a URL.
  // Without one (Jellyfin) there is no subset mode either, so the name is only
  // there to keep the map honest.
  return `resonus.librarySizes.${hashKey(profileKeyOf(a) ?? 'none')}`;
}

/** Brings the profile's saved sizes into memory, once. */
async function loadLibrarySizes(a: Subsonic.SubsonicAuth): Promise<void> {
  const key = sizesKey(a);
  if (sizesLoadedFor === key) return;
  if (sizesLoading) {
    await sizesLoading;
    if (sizesLoadedFor === key) return;
  }
  sizesLoading = (async () => {
    let saved: Record<string, LibrarySize> = {};
    try {
      const raw = await getItem(key);
      if (raw) saved = JSON.parse(raw) as Record<string, LibrarySize>;
    } catch {
      // Unreadable or from another version: start over rather than retry.
    }
    librarySizes.clear();
    for (const [id, e] of Object.entries(saved)) {
      if (typeof e?.count === 'number' && typeof e?.at === 'number') librarySizes.set(id, e);
    }
    sizesLoadedFor = key;
  })();
  try {
    await sizesLoading;
  } finally {
    sizesLoading = null;
  }
}

function saveLibrarySizes(a: Subsonic.SubsonicAuth): void {
  const out: Record<string, LibrarySize> = {};
  for (const [id, e] of librarySizes) out[id] = e;
  void setItem(sizesKey(a), JSON.stringify(out));
}

/**
 * Albums in one library, 0 if the server doesn't say.
 *
 * An approximation: a server may report an artist's albums across the whole
 * collection rather than within the asked library, so an artist present in two
 * gets counted twice. It's a weight, not a figure anyone is shown.
 *
 * Kept for a day AND across restarts. `getArtists` returns every artist of the
 * library, which on a big one is not a small answer, and the count only moves
 * when the server scans. In memory alone it was asked again on every cold
 * start, once per library, which is the moment it is least welcome.
 */
async function libraryAlbumCount(a: Subsonic.SubsonicAuth, folderId: string): Promise<number> {
  await loadLibrarySizes(a);
  const hit = librarySizes.get(folderId);
  if (hit && Date.now() - hit.at < LIBRARY_SIZE_TTL_MS) return hit.count;
  try {
    const artists = await Subsonic.getArtists(a, folderId);
    const count = artists.reduce((n, ar) => n + (ar.albumCount ?? 0), 0);
    librarySizes.set(folderId, { at: Date.now(), count });
    return count;
  } catch {
    return 0;
  }
}

/**
 * How much of the random pool each library contributes.
 *
 * Asking every library for the same amount and shuffling the result is still
 * one turn each, only disguised: the pool itself is what's biased, so no
 * shuffle over it can fix the proportions (issue #39). A library holding a
 * twentieth of the music has to bring a twentieth of the pool.
 *
 * Their share of the total, then, with a floor of one so a small library still
 * turns up now and then, and an equal split as the fallback for a server that
 * doesn't report album counts.
 */
async function randomDepths(
  a: Subsonic.SubsonicAuth,
  ids: string[],
  pool: number,
): Promise<number[]> {
  const counts = await Promise.all(ids.map((id) => libraryAlbumCount(a, id)));
  // One write for the whole round, not one per library.
  saveLibrarySizes(a);
  const total = counts.reduce((n, c) => n + c, 0);
  if (total <= 0) return ids.map(() => Math.ceil(pool / ids.length));
  return counts.map((c) => Math.max(1, Math.round(pool * (c / total))));
}

/** First `depth` albums of one library, in chunks the endpoint accepts. */
async function fetchTopAlbums(
  depth: number,
  fetchPage: (size: number, offset: number) => Promise<Subsonic.Album[]>,
): Promise<Subsonic.Album[]> {
  const PAGE = 500; // the endpoint's own cap
  const out: Subsonic.Album[] = [];
  for (let offset = 0; offset < depth; offset += PAGE) {
    const chunk = await fetchPage(Math.min(PAGE, depth - offset), offset);
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

/** Album field each list type is really ordered by, when the server sends it. */
const ALBUM_SORT_FIELD: Partial<
  Record<Subsonic.AlbumListType, 'created' | 'played' | 'playCount' | 'year'>
> = {
  newest: 'created',
  recent: 'played',
  frequent: 'playCount',
};

/**
 * The release date as one comparable number (YYYYMMDD), or -Infinity when the
 * record does not say.
 *
 * A record released this March and one released this November are the same
 * `year`, which is the only thing `getAlbumList2` sorts by: the server breaks
 * that tie with the album name, so "New releases" came out as a slice of the
 * alphabet. The day is in the answer already (OpenSubsonic), and this is what
 * reads it.
 */
function releaseValue(album: Subsonic.Album): number {
  const d = album.originalReleaseDate ?? album.releaseDate;
  if (d?.year) return d.year * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0);
  return album.year != null ? album.year * 10000 : -Infinity;
}

/**
 * Newest release first, and the most recently added of those that came out the
 * same day.
 *
 * Plenty of libraries carry no more than a year per record, and every one of
 * them ties: leaving that tie to the server is what put the alphabet on a shelf
 * that promises new music. Of the two things left to go on, when it was added
 * is the one that tracks what someone would call new; it only ever decides
 * between records of the same date, so the year still comes first.
 */
function byRelease(a: Subsonic.Album, b: Subsonic.Album): number {
  const diff = releaseValue(b) - releaseValue(a);
  if (diff) return Number.isNaN(diff) ? 0 : diff;
  return albumSortValue(b, 'created') - albumSortValue(a, 'created') || 0;
}

/** The field as a number (dates become timestamps) to sort descending by.
 *  Missing sinks to the bottom instead of jumping to the top. */
function albumSortValue(
  album: Subsonic.Album,
  field: 'created' | 'played' | 'playCount' | 'year',
): number {
  const v = album[field];
  if (v == null) return -Infinity;
  return typeof v === 'number' ? v : (Date.parse(v) || -Infinity);
}

/**
 * Merges per-library lists (each already sorted by the server according to
 * `type`) into ONE list ordered as if the libraries didn't exist.
 *
 * This used to interleave round-robin whenever the album carried no sort key,
 * which is what "recently added" and friends fell into. With libraries of very
 * different sizes that is badly wrong: a tiny library that hasn't changed in a
 * year still takes every other slot, so it crowds out a big one and the same
 * old albums come back forever (issue #39). Albums do carry `created`, and
 * `played`/`playCount` on OpenSubsonic servers, so the merge sorts by those.
 *
 * Round-robin stays as the fallback for a server that sends none of it: with
 * nothing to order by, alternating is still fairer than piling one library
 * ahead of the rest.
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
  const all = dedupeById(perFolder.flat());
  // Random has no order to respect: one shuffle over everything. Interleaving
  // per-library shuffles would still hand out one turn each — and so would
  // shuffling a pool built with the same amount from each, which is why the
  // pool comes weighted by library size (see `randomDepths`).
  if (type === 'random') return shuffled(all);
  if (type === 'byYear') return all.sort(byRelease);
  const field = ALBUM_SORT_FIELD[type];
  if (field && all.some((al) => al[field] != null)) {
    return all.sort((a, b) => {
      const diff = albumSortValue(b, field) - albumSortValue(a, field);
      // Two albums with nothing to compare: -Infinity minus itself is NaN,
      // which would leave the sort undefined.
      return Number.isNaN(diff) ? 0 : diff;
    });
  }
  // Round-robin interleaving, preserving each library's internal order.
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
 * Serves a page of the merged list from multiple libraries. The full list
 * is cached for a while to avoid redoing the work on each page of the
 * infinite scroll.
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
  // Only as deep as the page needs. Every library comes back sorted the same
  // way, so the first N of each is guaranteed to contain the first N of the
  // merge — there is no need to walk them whole, which is what this did: to
  // show twenty albums on Home it paginated every library to its end, one
  // request per 500 albums, per library, on every shelf (#50).
  //
  // The first page asks for exactly what it shows. Rounding it up to a hundred
  // is what makes the pages of an infinite scroll share one fetch, and that is
  // worth it once someone is scrolling — but everyone pays the first page, on
  // every shelf, on every cold start. On Home that was six requests of a
  // hundred albums each, per shelf, to put twenty on screen, and all of it
  // parsed on the JS thread.
  const depth = Math.max(
    offset === 0 ? size : Math.ceil((offset + size) / MERGE_DEPTH) * MERGE_DEPTH,
    // "New releases" is sorted here, not by the server, so each library has to
    // hand over enough of its newest year for that sort to mean anything.
    type === 'byYear' ? BYYEAR_WINDOW : 0,
  );
  const cacheKey = `${cacheBase}|${profileKeyOf(a)}|${ids.join(',')}|${depth}`;
  let all = readAlbumCache<Subsonic.Album>(cacheKey);
  if (!all) {
    // Same total as the flat depth, split by size instead of equally: for the
    // sorted lists the field decides and taking the first N of each is enough,
    // but a shuffle can only be as fair as the pool it shuffles.
    const depths =
      type === 'random'
        ? await randomDepths(a, ids, depth * ids.length)
        : ids.map(() => depth);
    const perFolder = await Promise.all(
      ids.map((id, i) => fetchTopAlbums(depths[i], (s, o) => fetchOne(id, s, o))),
    );
    all = mergeAlbums(perFolder, type);
    writeAlbumCache(cacheKey, all);
  }
  return all.slice(offset, offset + size);
}
