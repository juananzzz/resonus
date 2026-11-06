/**
 * Offline downloads (server → device).
 *
 * Files go to the app's private storage
 * (`documentDirectory/downloads/<server hash>/`) and alongside them a JSON
 * catalog is saved with metadata already known from the server (title, artist,
 * album, ids, cover) — without re-scanning ID3 tags. The local profile merges
 * this catalog with the scan of the chosen source (`localQueries.ensureCatalog`).
 * Since MediaStore and SAF don't see the private directory, the merge never
 * produces duplicates.
 *
 * Ids are kept as-is from the server (song and album), which enables the ↓ badge
 * on any profile and, in the future, deferred scrobbling or re-download at
 * another quality. The artist id is normalized to the local key (`normKey(name)`)
 * so artists merge with those from scanning.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { create } from 'zustand';

import {
  COVER,
  coverArtUrl,
  downloadUrl,
  getAlbum,
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
import { transcodeTarget } from '@/lib/audioQuality';
import {
  forgetCover,
  hashKey,
  normKey,
  registerCover,
  replaceCover,
  urlExtension,
  UNKNOWN_ARTIST,
} from '@/lib/localLibrary';
import { serializeLrc } from '@/lib/lrc';
import { siblingLrcUri } from '@/lib/localLyrics';
import * as Db from '@/lib/downloadsDb';
import type { DlAlbum } from '@/lib/downloadsDb';
import { netTally, note, timed } from '@/lib/perfLog';
import { queryClient } from '@/lib/query';
import { primaryUrl } from '@/lib/serverUrls';
import { isManualOffline } from '@/api/netGate';
import { profileScopeId, useAuthStore } from './auth';
import { useLibraryMirror } from './libraryMirror';
import { useSettings } from './settings';
import { useToast } from './toast';
import {
  clearDownloadRecords,
  downloadedBytes,
  downloadedForChannel,
  dropDownloads,
  listAllEpisodes,
  listDownloads,
  saveDownload,
} from '@/lib/podcastDb';

// What a podcast download needs from an episode: its address and the show it
// belongs to. Both a stored `PodcastEpisode` and the episode-as-song the menu
// hands over (id, url, podcastChannelId) satisfy this shape.
interface EpisodeSource {
  id: string;
  url?: string;
  channelId: string;
}

const ROOT_DIR = FileSystem.documentDirectory + 'downloads/';

// Podcast episode files: no server, so no auth-keyed directory — one folder per
// profile, next to that profile's podcast database. The player finds them through
// the same `files` map it uses for server downloads (see `hydrate`).
const PODCAST_ROOT = FileSystem.documentDirectory + 'podcast-downloads/';

function podcastScope(): string {
  return hashKey(profileScopeId());
}

function podcastFileDir(): string {
  return `${PODCAST_ROOT}${podcastScope()}/files/`;
}

// ── How much of the server we take at once ──────────────────────────────────
// The limit used to be three per group, and a group is not the unit anybody
// cares about: a discography downloading while an auto-download playlist
// reconciles was two groups, so six songs at a time, and on a server that
// transcodes each one that is six ffmpeg processes (#83). These slots are the
// whole app's budget, whatever is downloading and however it started.

/** Transfers in flight right now, across every group. */
let slotsInUse = 0;
/** Workers waiting for one, woken in order. */
const slotQueue: (() => void)[] = [];

function maxSlots(): number {
  return useSettings.getState().downloadConcurrency;
}

async function takeSlot(): Promise<void> {
  // Re-checked after waking: the limit can have been lowered in the meantime,
  // and waking one too many is then harmless, it just waits again.
  while (slotsInUse >= maxSlots()) {
    await new Promise<void>((resolve) => slotQueue.push(resolve));
  }
  slotsInUse++;
}

function freeSlot(): void {
  slotsInUse = Math.max(0, slotsInUse - 1);
  slotQueue.shift()?.();
}

/**
 * A server saying "not now" is not a song that cannot be downloaded, and until
 * now it was counted as one: whatever the server refused was skipped and
 * reported as failed at the end (#83). Three attempts, backing off in between.
 */
const ATTEMPTS = 3;
const RETRY_PAUSE_MS = 1500;

/** Is this worth trying again, or is the answer going to be the same? */
function worthRetrying(status: number | undefined): boolean {
  // No response at all (the network went away mid-transfer), too many requests,
  // or the server having a bad time. A 404 will still be a 404.
  return status === undefined || status === 429 || status >= 500;
}

class TransferError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface GroupProgress {
  done: number;
  total: number;
  /** Fraction (0..1) of the current file, so the progress bar advances between songs. */
  fraction: number;
}

/** Mergeable view by the local profile (artists derived from albums). */
export interface DownloadsCatalog {
  songs: Song[];
  albums: DlAlbum[];
  artists: (Artist & { coverUri?: string })[];
}

export function serverDir(auth: SubsonicAuth): string {
  // PRIMARY URL, not the active one: when switching networks the active one
  // changes, and with it this directory, hiding downloads. The primary
  // identifies the profile.
  return `${ROOT_DIR}${hashKey(`${primaryUrl(auth)}|${auth.username}`)}/`;
}

/**
 * Serializes deletes and clears against each other. The catalog itself no
 * longer needs it: SQLite is the one keeping writes consistent.
 */
let catalogLock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = catalogLock.then(fn);
  catalogLock = run.catch(() => {});
  return run;
}

/** All server directories with downloads. */
async function serverDirs(): Promise<string[]> {
  try {
    const entries = await FileSystem.readDirectoryAsync(ROOT_DIR);
    return entries.map((e) => `${ROOT_DIR}${e}/`);
  } catch {
    return []; // ROOT_DIR does not exist yet
  }
}

// ── Active account's catalog, cached in memory ───────────────────────────

/** The albums and artists, which every offline screen needs. */
let cachedShelf: Omit<DownloadsCatalog, 'songs'> | null = null;
/**
 * The read in flight, if there is one.
 *
 * Six screens ask for this within the same second of a cold start, and none of
 * them had anything to wait on: each saw an empty cache and read the whole
 * shelf again. On a big library that is six times the same two hundred
 * milliseconds. Now the first one reads and the rest wait for it.
 */
let shelfReading: { dir: string; work: Promise<Omit<DownloadsCatalog, 'songs'>> } | null = null;
/** Same, for the songs, which cost twenty times more. */
let songsReading: { dir: string; work: Promise<Song[]> } | null = null;
let cachedForDir: string | null = null;
/** Every song, which only the screens that resolve ids need. Kept apart from
 *  the shelf because it is twenty times the size and comes at twenty times the
 *  cost (see `getDownloadsCatalog`). */
let cachedSongs: Song[] | null = null;
let cachedSongsDir: string | null = null;
/** The two of them handed out as one object, and always the SAME object: what
 *  reads it keys its own index on that identity (see `catalogSongs`). */
let cachedFull: DownloadsCatalog | null = null;

/** Counts hydrations, so a slower earlier one can't overwrite a later one. */
let hydrateRun = 0;

/** Download directory for the active server account (null if none). */
export function activeServerDir(): string | null {
  const auth = useAuthStore.getState().auth;
  return auth ? serverDir(auth) : null;
}

function deriveArtists(
  albums: DlAlbum[],
  /** What the catalog knows about them beyond their records: their picture. */
  known: Map<string, Db.DlArtist>,
): (Artist & { coverUri?: string })[] {
  const map = new Map<string, Artist & { coverUri?: string }>();
  for (const al of albums) {
    // The key is the untranslatable one (it is the artist's id, see
    // localLibrary); the name is what gets read, so it is the translated one.
    const key = normKey(al.artist || UNKNOWN_ARTIST);
    const name = al.artist || tg('Unknown artist');
    const existing = map.get(key);
    if (existing) {
      existing.albumCount = (existing.albumCount ?? 0) + 1;
      if (!existing.coverUri) existing.coverUri = al.coverUri;
    } else {
      map.set(key, { id: key, name, coverArt: key, albumCount: 1, coverUri: al.coverUri });
    }
  }
  // Their own picture wins over the album cover that was standing in for it.
  // The stand-in is kept where there is none: a face nobody has is not a
  // reason to show a grey square instead of the record it belongs to.
  for (const [key, artist] of map) {
    const cover = known.get(key)?.coverUri;
    if (cover) artist.coverUri = cover;
  }
  return Array.from(map.values());
}

/**
 * Downloads for the active SERVER account. This is the library for the "server
 * account offline" mode (the local profile only shows phone music). Each account
 * sees only its own. Registers covers in the global index.
 */
export async function getDownloadsCatalog(): Promise<DownloadsCatalog> {
  const dir = activeServerDir();
  if (!dir) return { songs: [], albums: [], artists: [] };
  const shelf = await getDownloadShelf();
  if (!cachedSongs || cachedSongsDir !== dir) {
    // Every song, which is what resolving an id offline needs. The shelf above
    // does not, and neither does the screen that shows it, so this waits until
    // something actually asks: on fifteen thousand downloads it is fifteen
    // thousand rows parsed out of the database, and it used to happen on the way
    // into the first offline screen whatever that screen was showing.
    if (!songsReading || songsReading.dir !== dir) {
      songsReading = { dir, work: timed('offline catalog', () => Db.allSongs(dir)) };
    }
    try {
      cachedSongs = await songsReading.work;
    } finally {
      if (songsReading?.dir === dir) songsReading = null;
    }
    cachedSongsDir = dir;
    cachedFull = null;
  }
  if (!cachedFull) cachedFull = { ...shelf, songs: cachedSongs };
  return cachedFull;
}

/**
 * The albums and artists of what is downloaded, without the songs.
 *
 * This is what the offline Library is made of, and what registers the covers of
 * downloads in the global index, so it is also what the data layer waits for
 * before answering anything. Six hundred albums where the songs are fifteen
 * thousand: the difference is the offline start.
 */
export async function getDownloadShelf(): Promise<Omit<DownloadsCatalog, 'songs'>> {
  const dir = activeServerDir();
  if (!dir) return { albums: [], artists: [] };
  if (!cachedShelf || cachedForDir !== dir) {
    if (!shelfReading || shelfReading.dir !== dir) {
      shelfReading = {
        dir,
        work: timed('offline shelf', async () => {
          const [albums, known] = await Promise.all([Db.allAlbums(dir), Db.allArtists(dir)]);
          return { albums, artists: deriveArtists(albums, new Map(known.map((a) => [a.id, a]))) };
        }),
      };
    }
    try {
      cachedShelf = await shelfReading.work;
    } finally {
      if (shelfReading?.dir === dir) shelfReading = null;
    }
    cachedForDir = dir;
  }
  // Always (not just on build): clearLocalCatalog() empties the global cover
  // index and downloaded covers need to be re-registered.
  for (const a of cachedShelf.albums) {
    registerCover(a.id, a.coverUri);
    // Under the server's id, so a song from the mirror or the queue finds its
    // own picture too, not only the catalog's rows (#214).
    for (const [id, uri] of Object.entries(a.trackCovers ?? {})) registerCover(id, uri);
  }
  for (const a of cachedShelf.artists) registerCover(a.id, a.coverUri);
  return cachedShelf;
}

/** Does the active account have downloads? A count, not the catalog. */
export async function hasDownloads(): Promise<boolean> {
  const dir = activeServerDir();
  if (!dir) return false;
  return (await Db.songCount(dir)) > 0;
}

/**
 * Keeps a downloaded artist's picture and their server id, from the artist
 * screen while there is a connection.
 *
 * The download itself writes the row, but at that moment all it has is what
 * the album says about them. This is the other half, and the half that covers
 * everything downloaded before any of this existed: opening an artist online
 * is when the app holds the real thing, so that is when it is written down.
 *
 * Only for artists whose music is actually on the phone. Everything else that
 * gets browsed belongs to the library mirror, which has its own rules about
 * what is worth keeping; the download catalog is about the files.
 */
export async function noteDownloadedArtist(auth: SubsonicAuth, artist: Artist): Promise<void> {
  const dir = activeServerDir();
  if (!dir || !artist.name) return;
  const key = normKey(artist.name);
  try {
    const known = await Db.artistByServerId(dir, artist.id);
    // Nothing to add: their picture is already here, under either id.
    if (known?.coverUri) return;
    // An indexed lookup, and the answer is almost always no.
    if ((await Db.artistAlbums(dir, key)).length === 0) return;
    const art = await downloadArtistArt(auth, dir, key, artist.coverArt ?? artist.id);
    await Db.saveArtists(dir, [
      { id: key, name: artist.name, serverId: artist.id, coverUri: art?.uri, dlBytes: art?.bytes },
    ]);
    // The shelf in memory was built before this, and the cover index already
    // has the album that was standing in for them. Without both of these the
    // picture only turns up on the next start, which is the bug this is fixing.
    if (art) {
      replaceCover(key, art.uri);
      resetCatalogCache();
    }
  } catch {
    // Best effort, like the covers: the artist screen has already been drawn.
  }
}

/**
 * Saves the own pictures of these downloaded songs that are not on the phone
 * yet, and points the catalog's rows at them. Returns whether anything changed.
 *
 * For what was downloaded before a track's own cover came down with it (#214):
 * those rows got the album's and the file was never fetched. `songs` carry the
 * server's cover id, because the catalog wrote the album's over it.
 */
async function keepTrackCovers(
  auth: SubsonicAuth,
  dir: string,
  albumId: string,
  songs: { id: string; cover: string }[],
): Promise<boolean> {
  const [existing] = await Db.albumsByIds(dir, [albumId]);
  if (!existing) return false;
  const catalog = await Db.albumSongs(dir, albumId);
  // Rows of a download that already fetched it: its bytes are in the total.
  const counted = new Set(catalog.map((s) => s.coverArt));
  const trackCovers = { ...existing.trackCovers };
  let added = false;
  let bytes = 0;
  for (const cover of new Set(songs.map((s) => s.cover))) {
    if (trackCovers[cover]) continue;
    const art = await downloadTrackArt(auth, dir, cover);
    if (!art) continue;
    trackCovers[cover] = art.uri;
    registerCover(cover, art.uri);
    if (!counted.has(art.uri)) bytes += art.bytes;
    added = true;
  }
  const coverOf = new Map(songs.map((s) => [s.id, trackCovers[s.cover]]));
  const rows = catalog.flatMap((s) => {
    const uri = coverOf.get(s.id);
    return uri && s.coverArt !== uri ? [{ ...s, coverArt: uri }] : [];
  });
  if (!added && rows.length === 0) return false;
  await Db.addToCatalog(dir, {
    songs: rows,
    albums: added ? [{ ...existing, trackCovers, dlBytes: (existing.dlBytes ?? 0) + bytes }] : [],
  });
  return true;
}

/**
 * The album screen's half of `keepTrackCovers`: a downloaded album opened with
 * a connection, which is when the server says which tracks have their own art.
 */
export async function noteDownloadedAlbum(
  auth: SubsonicAuth,
  album: Album,
  songs: Song[],
): Promise<void> {
  const dir = activeServerDir();
  if (!dir) return;
  const files = useDownloads.getState().files;
  const albumCover = album.coverArt ?? album.id;
  // On an ordinary record this comes out empty: no read and no request.
  const own = songs.flatMap((s) =>
    files[s.id] && s.coverArt && s.coverArt !== albumCover ? [{ id: s.id, cover: s.coverArt }] : [],
  );
  if (own.length === 0) return;
  try {
    if (await keepTrackCovers(auth, dir, album.id, own)) resetCatalogCache();
  } catch {
    // Best effort: the album screen has already been drawn.
  }
}

/** Written once the sweep has gone through a profile's downloads. */
const TRACK_COVERS_MARK = 'track-covers-1';
let sweepingTrackCovers = false;

/**
 * Once per profile, the same for everything downloaded before 0.7.7, without
 * waiting for each album to be opened. The mirror still knows which cover id
 * each track had, so the server is only asked for the pictures themselves.
 */
async function sweepTrackCovers(): Promise<void> {
  const auth = useAuthStore.getState().auth;
  const dir = activeServerDir();
  if (!auth || !dir || useAuthStore.getState().offline || sweepingTrackCovers) return;
  sweepingTrackCovers = true;
  try {
    const mark = `${dir}${TRACK_COVERS_MARK}`;
    if ((await FileSystem.getInfoAsync(mark)).exists) return;
    const byAlbum = new Map<string, { id: string; cover: string }[]>();
    const ids = Object.keys(useDownloads.getState().files);
    for (const s of await useLibraryMirror.getState().ownCoverSongs(ids)) {
      byAlbum.set(s.album, [...(byAlbum.get(s.album) ?? []), s]);
    }
    let changed = false;
    for (const [albumId, songs] of byAlbum) {
      // Left for the next start rather than half done without a connection.
      if (useAuthStore.getState().offline) return;
      changed = (await keepTrackCovers(auth, dir, albumId, songs)) || changed;
    }
    if (changed) resetCatalogCache();
    await FileSystem.writeAsStringAsync(mark, '');
  } catch {
    // Tried again on the next start.
  } finally {
    sweepingTrackCovers = false;
  }
}

/** Has this album got anything downloaded? One row, not the whole library. */
export async function albumHasDownloads(albumId: string): Promise<boolean> {
  const dir = activeServerDir();
  if (!dir) return false;
  return Db.albumHasSongs(dir, albumId);
}

/** Drops the in-memory view of the catalog, without asking anyone to re-read. */
function resetCatalogCache() {
  cachedShelf = null;
  cachedForDir = null;
  cachedSongs = null;
  cachedSongsDir = null;
  cachedFull = null;
  shelfReading = null;
  songsReading = null;
}

function invalidate() {
  resetCatalogCache();
  // Offline the whole library IS this catalog, so every list has to be asked
  // again. Online none of it comes from here — the server answers those, and
  // the "downloaded" mark on a row reads this store directly, which is already
  // reactive. Invalidating everything there meant that finishing a download
  // sent the app off to re-fetch its entire visible state from the server, for
  // nothing (#50).
  if (useAuthStore.getState().offline) void queryClient.invalidateQueries();
}

// ── File download ─────────────────────────────────────────────────────────

/** Reads a header case-insensitively (casing varies by platform). */
export function header(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : '';
}

/**
 * Is the response an error disguised as a file?
 *
 * Subsonic signals errors with **HTTP 200 and an error body** (`status:
 * "failed"`), not with an HTTP code, so checking `res.status` is not enough.
 * Tested against Navidrome 0.63.2: requesting `/rest/stream` or `/rest/download`
 * with a nonexistent id returns 200 and 182 bytes of JSON. Without this filter
 * that would be saved as .mp3, the song would be marked as downloaded, and it
 * would never be retried (`pending` skips what's already in `files`); you'd find
 * out when there's no coverage, which is exactly why you downloaded it.
 *
 * Uses a blocklist on purpose, not requiring `audio/*`: `/rest/download`
 * returns the raw file and some servers send it as
 * `application/octet-stream`. Requiring audio/* would leave those unable to
 * download anything — we'd replace a rare bug with a constant one. Here only
 * what cannot possibly be audio is rejected: the API's own JSON/XML, and
 * incidentally the HTML from a proxy or a wifi captive portal.
 */
export function isErrorBody(headers: Record<string, string> | undefined): boolean {
  return /^\s*(application\/json|application\/xml|text\/xml|text\/html)/i.test(
    header(headers, 'content-type'),
  );
}

// File extension the server returns when transcoding to each codec.
// '' = default transcoder (MP3 in Navidrome). AAC: Navidrome outputs raw
// ADTS (.aac); other servers may use MP4 container (.m4a), but it sounds
// the same (expo-audio detects by content) and only the label would vary.
const FORMAT_EXT: Record<string, string> = { '': 'mp3', mp3: 'mp3', opus: 'opus', aac: 'aac' };

function songFileUrl(
  auth: SubsonicAuth,
  song: Song,
): { url: string; ext: string; bitRate?: number } {
  const s = useSettings.getState();
  const { bitRate, format } = transcodeTarget(
    song,
    s.downloadBitRate,
    s.downloadFormat,
    s.downloadLosslessOnly,
  );
  return fileUrlFor(auth, song, bitRate, format);
}

/** Why a song did not download, for the Diagnostics report. No URL: it carries credentials. */
function noteFailure(auth: SubsonicAuth, song: Song, e: unknown) {
  const why = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S*/g, '<url>').slice(0, 120);
  const { ext, bitRate } = songFileUrl(auth, song);
  const as = bitRate ? ` as ${ext} ${bitRate}k` : '';
  note(`download failed: ${why} (${song.suffix ?? '?'}${as})`);
}

/** Where to fetch a song's file from at this quality, and what it will be. */
export function fileUrlFor(
  auth: SubsonicAuth,
  song: Song,
  bitrate: number,
  format: string,
): { url: string; ext: string; bitRate?: number } {
  if (bitrate > 0) {
    return {
      url: streamUrl(auth, song.id, bitrate, 0, format),
      ext: FORMAT_EXT[format] ?? 'mp3',
      bitRate: bitrate,
    };
  }
  return { url: downloadUrl(auth, song.id), ext: song.suffix || 'mp3' };
}

/** Song as it enters the local catalog: server id + local file. */
function toLocalSong(
  song: Song,
  fileUri: string,
  dlBitRate?: number,
  dlBytes?: number,
  /**
   * Where this track's own cover was saved, when it had one of its own and it
   * came down (see `downloadTrackArt`). A file URI rather than the server's id
   * on purpose: `localCoverUrl` already answers one of those directly, the way
   * it does for a playlist's uploaded picture, so nothing has to be registered
   * at startup and nothing has to be read off disk to find out it is there.
   */
  coverUri?: string,
): Song {
  return {
    ...song,
    localUri: fileUri,
    // Written down now, while the file is right here: adding these up is what
    // Storage used reads, instead of asking the file system once per file.
    dlBytes,
    // Transcode bitrate at download time (if any): the file on disk doesn't
    // carry it, so the quality label can show it offline.
    dlBitRate,
    // Local artist id (by name) to merge with artists from scanning.
    artistId: normKey(song.artist || UNKNOWN_ARTIST),
    // Server ids don't work offline: we re-peg each artist by name.
    artists: song.artists?.map((a) => ({ id: normKey(a.name), name: a.name })),
    // Server ids, and no offline page to open.
    contributors: undefined,
    // Its own picture when this phone has it, the album's otherwise, which is
    // what every track used to get and what the ones with no cover of their
    // own still get (#214).
    coverArt: coverUri ?? song.albumId,
    addedAt: Date.now(),
    // Server favorites don't apply to the local profile (uses local favorites).
    starred: undefined,
  };
}

function toLocalAlbum(
  album: Album,
  coverUri?: string,
  dlBytes?: number,
  trackCovers?: Record<string, string>,
): DlAlbum {
  return {
    ...album,
    artistId: normKey(album.artist || UNKNOWN_ARTIST),
    artists: album.artists?.map((a) => ({ id: normKey(a.name), name: a.name })),
    coverArt: album.id,
    coverUri,
    dlBytes,
    trackCovers,
    addedAt: Date.now(),
  };
}

/**
 * Saves to the library mirror the COMPLETE tracklist of each album for these
 * songs (best-effort, in the background, while online). Thus, offline, an album
 * from which you only downloaded some songs shows in full with the non-downloaded
 * ones grayed out. Skips those already in the mirror to avoid repeated requests.
 */
async function mirrorAlbumTracklists(auth: SubsonicAuth, songs: Song[]): Promise<void> {
  const mirror = useLibraryMirror.getState();
  const dir = activeServerDir();
  const ids = [...new Set(songs.map((s) => s.albumId).filter((id): id is string => !!id))];
  let refreshed = false;
  for (const id of ids) {
    // Already mirrored: asked one at a time, which is a row lookup.
    if (await mirror.albumDetail(id)) continue;
    try {
      const res = await getAlbum(auth, id);
      mirror.saveAlbum(id, res.album, res.songs, useDownloads.getState());
      if (dir) refreshed = (await refreshCatalogAlbum(auth, dir, res.album)) || refreshed;
    } catch {
      // best-effort: if the album can't be requested, it stays unmirrored.
    }
  }
  // The catalog in memory was read before any of that: this runs after the
  // group has finished and its own invalidation has already gone by.
  if (refreshed) resetCatalogCache();
}

/**
 * Puts the server's own album over the one the catalog wrote down, when the
 * catalog only had a stand-in.
 *
 * Downloading a playlist never sees an album: each row is a song, and the
 * album that goes into the catalog is assembled from what the song says (see
 * `albumFromSong`). That is a name and a year, so offline those records said
 * nothing about what kind of release they are and their artist had no id the
 * server would recognize. This is the same request the mirror was making
 * anyway, so the real album costs nothing extra here.
 *
 * The cover and the date stay: they are this phone's, not the server's.
 */
async function refreshCatalogAlbum(
  auth: SubsonicAuth,
  dir: string,
  album: Album,
): Promise<boolean> {
  const [existing] = await Db.albumsByIds(dir, [album.id]);
  if (!existing) return false;
  await Db.addToCatalog(dir, {
    albums: [
      {
        ...toLocalAlbum(album, existing.coverUri, existing.dlBytes, existing.trackCovers),
        addedAt: existing.addedAt ?? Date.now(),
      },
    ],
  });
  await saveAlbumArtist(auth, dir, album);
  return true;
}

/**
 * Writes down who an album is by.
 *
 * Their picture is what stands between an album cover standing in for a face
 * and a real artist screen offline, and the id the server knows them by is
 * what lets that screen be reached from anything that remembers them from when
 * there was a connection — a recent search, a mirrored album.
 *
 * Servers answer for an artist's picture by their id, so without one there is
 * nothing to ask for. The row is still worth writing: opening the artist while
 * online fills the rest in (see `noteDownloadedArtist`).
 */
async function saveAlbumArtist(auth: SubsonicAuth, dir: string, album: Album): Promise<void> {
  const key = normKey(album.artist || UNKNOWN_ARTIST);
  const art = album.artistId ? await downloadArtistArt(auth, dir, key, album.artistId) : undefined;
  await Db.saveArtists(dir, [
    {
      id: key,
      name: album.artist ?? '',
      serverId: album.artistId,
      coverUri: art?.uri,
      dlBytes: art?.bytes,
    },
  ]);
}

/** Synthesized album from a song (playlists with partially downloaded albums). */
function albumFromSong(song: Song): Album {
  return {
    id: song.albumId ?? `dl-${hashKey(song.album || song.id)}`,
    name: song.album || tg('Unknown album'),
    artist: song.artist,
    year: song.year,
  };
}

/**
 * Caches a newly downloaded song's lyrics as `.lrc` alongside the
 * file, so the local profile finds them without network (lyrics phase 2).
 * Without lyrics (or without the songLyrics extension on the server) nothing happens.
 */
async function cacheLyricsForDownload(auth: SubsonicAuth, song: Song, audioFile: string): Promise<void> {
  try {
    let lyrics: SongLyrics | null = null;
    try {
      lyrics = await getLyricsBySongId(auth, song.id);
      // It answered, and it has nothing. The classic endpoint reads the same
      // place, so asking it too is a second request per song for an answer
      // already given, and downloading a library makes thousands of them queue
      // in front of what the screens are waiting for (#50). Playback stopped
      // doing this; the download path had been left behind.
      if (!lyrics) return;
    } catch {
      // Server without the songLyrics extension: try the classic endpoint.
      const plain = await getLyrics(auth, song.artist ?? '', song.title);
      if (plain) lyrics = { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
    }
    if (!lyrics) return;
    const lrcFile = siblingLrcUri(audioFile);
    if (lrcFile) await FileSystem.writeAsStringAsync(lrcFile, serializeLrc(lyrics));
  } catch {
    // The download is still valid without lyrics.
  }
}

/**
 * Sizes for downloads made before they were written down, filled in once.
 *
 * In parallel batches rather than one file after another, and saved into the
 * catalog, so a library downloaded with an older version pays this once and
 * never again.
 */
async function measureMissing(
  dir: string,
  entries: { id: string; uri: string }[],
): Promise<number> {
  const BATCH = 24;
  let total = 0;
  const measured: { id: string; bytes: number }[] = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const sizes = await Promise.all(batch.map((e) => fileSize(e.uri)));
    batch.forEach((e, j) => {
      measured.push({ id: e.id, bytes: sizes[j] });
      total += sizes[j];
    });
  }
  await Db.setSongBytes(dir, measured);
  return total;
}

/** Size of a file, 0 if it can't be read. */
export async function fileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? ((info as { size?: number }).size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** The cover, with what it takes on disk: measured here, once per album, so
 *  Storage used never has to measure anything. */
function downloadCover(
  auth: SubsonicAuth,
  dir: string,
  album: Album,
): Promise<{ uri: string; bytes: number } | undefined> {
  return downloadArt(auth, dir, `${dir}covers/${hashKey(album.id)}.jpg`, album.coverArt ?? album.id);
}

/**
 * A track's own cover, for the tracks that have one.
 *
 * Keyed by the cover id and not by the song, because that is what tracks
 * sharing a picture share: Navidrome gives a track its own artwork id only
 * when the file really carries one (`mf.HasCoverArt && EnableMediaFileCoverArt`
 * in its `MediaFile.CoverArtID`), and otherwise hands back the disc's or the
 * album's. So on a two-disc record every track of a disc names the same `dc-…`
 * id, and one file on disk serves the lot.
 */
function downloadTrackArt(
  auth: SubsonicAuth,
  dir: string,
  coverId: string,
): Promise<{ uri: string; bytes: number } | undefined> {
  return downloadArt(auth, dir, `${dir}covers/track_${hashKey(coverId)}.jpg`, coverId);
}

/**
 * The artist's own picture, next to the covers and fetched the same way.
 *
 * Under a name of its own, `artist_…`, because the two are keyed by different
 * things — an album by the server's id, an artist by their name normalized —
 * and nothing says those can never hash to the same file.
 */
function downloadArtistArt(
  auth: SubsonicAuth,
  dir: string,
  artistKey: string,
  coverId: string,
): Promise<{ uri: string; bytes: number } | undefined> {
  return downloadArt(auth, dir, `${dir}covers/artist_${hashKey(artistKey)}.jpg`, coverId);
}

async function downloadArt(
  auth: SubsonicAuth,
  dir: string,
  file: string,
  coverId: string,
): Promise<{ uri: string; bytes: number } | undefined> {
  const url = coverArtUrl(auth, coverId, COVER.card);
  if (!url) return undefined;
  try {
    const existing = await FileSystem.getInfoAsync(file);
    if (existing.exists) {
      return { uri: file, bytes: (existing as { size?: number }).size ?? 0 };
    }
    await FileSystem.makeDirectoryAsync(`${dir}covers/`, { intermediates: true }).catch(() => {});
    netTally('coverArt.view (download)');
    const res = await FileSystem.downloadAsync(url, file);
    // Same care as with audio, and we also need to delete: the download writes
    // whatever comes, and with the bad file on disk the shortcut above
    // (`existing.exists`) would consider it a valid cover forever.
    if (res.status !== 200 || isErrorBody(res.headers)) {
      await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
      return undefined;
    }
    return { uri: file, bytes: Number(header(res.headers, 'content-length')) || (await fileSize(file)) };
  } catch {
    return undefined;
  }
}

interface DownloadsState {
  /** Song id (server) → uri of the downloaded file. */
  files: Record<string, string>;
  /**
   * Song id → bitrate (kbps) at which it was transcoded on download, if
   * transcoded. Queried by id (not by song object) because offline the player
   * may show the song from the server mirror, not the catalog. Only new
   * transcoded downloads have this.
   */
  dlBitRates: Record<string, number>;
  /** Progress per ongoing group: `album:<id>` / `playlist:<id>` / `artist:<id>`. */
  active: Record<string, GroupProgress>;
  /**
   * `files` has been read from disk. Until then it is empty, which reads the
   * same as "nothing is downloaded" — and whoever decides something by that
   * (see the library mirror) would decide it wrong.
   */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  downloadAlbum: (album: Album, songs: Song[]) => Promise<void>;
  downloadPlaylist: (playlist: Playlist, songs: Song[]) => Promise<void>;
  /**
   * Downloads an artist's discography (group `artist:<id>`). Receives songs
   * and albums already: the artist screen only has the album list, so
   * the caller is the one who already fetched them.
   */
  downloadArtist: (artistId: string, songs: Song[], albums: Album[]) => Promise<void>;
  /** Downloads all favorite songs (group 'favorites'). */
  /** Every song of a genre, gathered by the screen that asks (see the genre page). */
  downloadGenre: (genre: string, songs: Song[]) => Promise<void>;
  downloadFavorites: (songs: Song[]) => Promise<void>;
  downloadSong: (song: Song) => Promise<void>;
  /** Downloads a loose batch of songs (multiple selection). */
  downloadSongs: (songs: Song[]) => Promise<void>;
  /** Stops an ongoing group download (already downloaded items are kept). */
  cancelDownload: (groupKey: string) => void;
  /** Deletes files for those songs and removes them from the catalog. */
  deleteSongs: (songIds: string[]) => Promise<void>;
  /**
   * Downloads episodes straight from their enclosure address. Podcasts have no
   * server to fetch through, so this is a separate path from `downloadGroup`:
   * same slots, same progress, same `files` map the player reads, but the bytes
   * come from the episode's own url and land in that profile's podcast folder.
   */
  downloadPodcast: (channelId: string) => Promise<void>;
  downloadPodcastEpisode: (episode: EpisodeSource) => Promise<void>;
  /** New episodes of a favorite show: only on Wi-Fi, whatever the setting says. */
  autoDownloadEpisodes: (channelId: string, episodes: EpisodeSource[]) => Promise<void>;
  /** Deletes downloaded episode files and drops them from the podcast record. */
  deletePodcastDownloads: (episodeIds: string[]) => Promise<void>;
  /** Deletes every downloaded episode of a show, however many the screen
   *  never loaded; returns how many went. */
  deletePodcastChannelDownloads: (channelId: string) => Promise<number>;
  /**
   * Forgets a download whose file is not on the disk any more, and says whether
   * it did.
   *
   * The catalog is what the app goes by: a row here is a badge on the row, a
   * song that counts as playable offline and a file handed to the player
   * instead of the stream. A row whose file has gone is all three of those
   * promises broken at once, and the player is where it shows: it is the one
   * that gets handed the path (see `onPlaybackError`). An empty file counts as
   * gone: a download interrupted where nothing noticed is the same nothing to
   * play.
   *
   * Only when the file system answers. Not being able to look is not an answer,
   * and deleting somebody's download on the strength of it would be worse than
   * the failure it is trying to explain.
   */
  forgetIfMissing: (songId: string) => Promise<boolean>;
  clearAll: () => Promise<void>;
  usageBytes: () => Promise<number>;
}

/**
 * Is anything downloaded at all? A selector, not a count.
 *
 * `Object.keys(files).length > 0` was the way to ask, and on a library of
 * fifteen thousand downloads that allocates an array of fifteen thousand
 * strings to look at the first one. It ran in the root layout, in Settings and
 * on the artist screen, and it ran again on every change to this store, which
 * while something is downloading is several times a second.
 */
export function anyDownloads(s: { files: Record<string, string> }): boolean {
  for (const _ in s.files) return true;
  return false;
}

/**
 * Whether a group running in "Wi-Fi only" mode should stop before its next
 * item: the connection it started on was Wi-Fi, but that is only true of the
 * moment it started. Asked once per item, which is a cheap native call next
 * to a download.
 */
async function lostWifi(): Promise<boolean> {
  return useSettings.getState().downloadWifiOnly && (await onMobileData());
}

/** true only if the active connection is mobile data (for "Wi-Fi only" mode). */
async function onMobileData(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.CELLULAR;
  } catch {
    return false; // when in doubt, don't block the download
  }
}

export const useDownloads = create<DownloadsState>((set, get) => {
  // Groups with a stop requested: workers check this and stop picking new
  // songs. Already downloaded items are kept.
  const cancelling = new Set<string>();
  // Ongoing downloads per group, to abort them on stop (instant stop).
  const activeTasks = new Map<
    string,
    Set<ReturnType<typeof FileSystem.createDownloadResumable>>
  >();

  /** Downloads a group of songs and updates catalog + progress. */
  async function downloadGroup(groupKey: string, songs: Song[], albums: Album[]): Promise<void> {
    const { auth, offline } = useAuthStore.getState();
    if (!auth) return;
    // A download is a transfer, and offline mode makes none. It goes through
    // expo-file-system rather than the API, so the gate under the API layer
    // (see `api/netGate`) cannot see it: this is that same rule, said here.
    if (offline) return;
    if (get().active[groupKey]) return; // already in progress
    // No duplicates (a playlist may have the same song twice) nor
    // already downloaded, radio songs (url), or songs already local.
    const seen = new Set<string>();
    const pending = songs.filter((s) => {
      if (get().files[s.id] || s.url || s.localUri || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    if (pending.length === 0) return;

    // "Wi-Fi only" mode: don't start on mobile data.
    if (useSettings.getState().downloadWifiOnly && (await onMobileData())) {
      useToast.getState().show(tg('Connect to Wi-Fi to download'));
      return;
    }

    const dir = serverDir(auth);
    set((st) => ({ active: { ...st.active, [groupKey]: { done: 0, total: pending.length, fraction: 0 } } }));

    try {
      await FileSystem.makeDirectoryAsync(`${dir}files/`, { intermediates: true }).catch(() => {});

      // The cover and album entry are downloaded the first time one of their
      // songs appears, not all at once at the start. This way the download
      // begins immediately (without "scanning" all albums first) and the
      // stop is also responsive during that phase.
      const albumById = new Map(albums.map((a) => [a.id, a]));
      const albumDone = new Set<string>();
      const artistDone = new Set<string>();
      /**
       * Cover id of a track that has its own picture, and where it landed.
       *
       * Filled album by album in `ensureAlbum` rather than track by track as
       * the audio arrives: the distinct ids are known from the song list, one
       * album's worth is a handful of them at most, and doing it there is what
       * lets the bytes go into the album's own total instead of being spent
       * without anything counting them.
       */
      const trackArt = new Map<string, string>();
      /** Who the record is by, once per artist while this group runs. */
      const ensureArtist = async (album: Album): Promise<void> => {
        const key = normKey(album.artist || UNKNOWN_ARTIST);
        if (artistDone.has(key)) return;
        artistDone.add(key);
        await saveAlbumArtist(auth, dir, album);
      };

      const ensureAlbum = async (song: Song): Promise<void> => {
        const album = song.albumId ? albumById.get(song.albumId) : undefined;
        if (!album || albumDone.has(album.id)) return;
        albumDone.add(album.id); // mark before await: so another worker won't repeat it
        const cover = await downloadCover(auth, dir, album);

        // The pictures that are not the album's, which is how a compilation or
        // a set of singles keeps a different sleeve per track (#214). Only the
        // ones that name something else: on an ordinary record every track
        // names the album's id and this set comes out empty, so the usual
        // download pays nothing for this at all.
        const albumCoverId = album.coverArt ?? album.id;
        const own = new Set<string>();
        for (const track of pending) {
          if (track.albumId !== album.id) continue;
          if (track.coverArt && track.coverArt !== albumCoverId) own.add(track.coverArt);
        }
        // Kept from an earlier download of this album, which replacing the
        // row would otherwise forget.
        const [existing] = own.size > 0 ? await Db.albumsByIds(dir, [album.id]) : [];
        const trackCovers: Record<string, string> = { ...existing?.trackCovers };
        let artBytes = 0;
        for (const coverId of own) {
          if (cancelling.has(groupKey)) break;
          const art = await downloadTrackArt(auth, dir, coverId);
          if (!art) continue;
          trackArt.set(coverId, art.uri);
          trackCovers[coverId] = art.uri;
          registerCover(coverId, art.uri);
          artBytes += art.bytes;
        }

        await Db.addToCatalog(dir, {
          // The album's own row carries what its artwork costs, this included:
          // a song's `dlBytes` is the size of its audio and is read back as
          // such (see the Size row of `SongInfoSheet`), so a picture cannot go
          // in there.
          albums: [
            toLocalAlbum(
              album,
              cover?.uri,
              (cover?.bytes ?? 0) + artBytes,
              Object.keys(trackCovers).length > 0 ? trackCovers : undefined,
            ),
          ],
        });
        await ensureArtist(album);
      };

      // Ongoing tasks, aborted on stop (instant stop).
      const tasks = new Set<ReturnType<typeof FileSystem.createDownloadResumable>>();
      activeTasks.set(groupKey, tasks);

      /** One attempt at one song. Throws, so the caller decides about trying again. */
      const fetchSong = async (song: Song): Promise<void> => {
        const { url, ext, bitRate: dlBitRate } = songFileUrl(auth, song);
        const file = `${dir}files/${hashKey(song.id)}.${ext}`;
        const task = FileSystem.createDownloadResumable(url, file, {}, (p) => {
          if (p.totalBytesExpectedToWrite > 0) {
            const fraction = p.totalBytesWritten / p.totalBytesExpectedToWrite;
            const cur = get().active[groupKey];
            // Updates coarsely to avoid continuous re-renders.
            if (cur && fraction - cur.fraction > 0.05) {
              set((st) => ({
                active: { ...st.active, [groupKey]: { ...cur, fraction } },
              }));
            }
          }
        });
        tasks.add(task);
        try {
          const res = await task.downloadAsync();
          // The one request in the app that is measured in megabytes. Counted
          // here rather than guessed at from the catalog, so a report can say
          // whether the traffic was music or something asking again and again.
          netTally('stream.view (download)', Number(header(res?.headers, 'content-length')) || 0);
          if (!res || res.status !== 200) throw new TransferError(`HTTP ${res?.status}`, res?.status);
          if (isErrorBody(res.headers)) throw new TransferError('error body, not audio', 200);
          await cacheLyricsForDownload(auth, song, file);
          // The size comes from the response, which already counted it. Only
          // ask the file system when the server sent no length.
          const bytes = Number(header(res.headers, 'content-length')) || (await fileSize(file));
          // Each song is persisted on completion: if the app dies mid-album,
          // already downloaded items survive a restart.
          await Db.addToCatalog(dir, {
            songs: [
              toLocalSong(song, file, dlBitRate, bytes, song.coverArt ? trackArt.get(song.coverArt) : undefined),
            ],
          });
          set((st) => {
            const cur = st.active[groupKey];
            return {
              files: { ...st.files, [song.id]: file },
              dlBitRates:
                dlBitRate != null ? { ...st.dlBitRates, [song.id]: dlBitRate } : st.dlBitRates,
              active: cur
                ? { ...st.active, [groupKey]: { ...cur, done: cur.done + 1, fraction: 0 } }
                : st.active,
            };
          });
        } catch (e) {
          // Whatever arrived is not a song: half a file, or the server's excuse
          // for not sending one.
          await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
          throw e;
        } finally {
          tasks.delete(task);
        }
      };

      let failed = 0;
      let next = 0;
      let onData = false;
      // As many workers as slots at most: more would only queue up on the way in.
      const workers = Array.from({ length: Math.min(maxSlots(), pending.length) }, async () => {
        while (next < pending.length) {
          if (cancelling.has(groupKey) || onData) break; // stop requested by user
          // The Wi-Fi went while the group ran: what is in flight finishes,
          // nothing new starts on mobile data.
          if (await lostWifi()) {
            onData = true;
            break;
          }
          const song = pending[next++];
          for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            // Held across the whole song, cover and lyrics included: they are
            // requests to the same server as the audio.
            await takeSlot();
            try {
              if (cancelling.has(groupKey)) break;
              await ensureAlbum(song);
              if (cancelling.has(groupKey)) break; // may have stopped during the cover
              await fetchSong(song);
              break; // done
            } catch (e) {
              // A stop is not a failure; the toast already says it stopped.
              if (cancelling.has(groupKey)) break;
              const status = e instanceof TransferError ? e.status : undefined;
              if (attempt === ATTEMPTS || !worthRetrying(status)) {
                failed++;
                // The first few only: the report keeps 30 events (#328).
                if (failed <= 3) noteFailure(auth, song, e);
                break;
              }
            } finally {
              // Freed before the pause, so somebody else can use the server
              // while this one waits for it to calm down.
              freeSlot();
            }
            await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS * attempt));
          }
        }
      });
      await Promise.all(workers);

      invalidate();
      // In the background: mirrors the complete tracklist of touched albums,
      // to see them in full (with grays) offline even if only one song was downloaded.
      if (!cancelling.has(groupKey)) void mirrorAlbumTracklists(auth, pending);
      if (cancelling.has(groupKey)) {
        useToast.getState().show(tg('Download stopped'));
      } else if (onData) {
        useToast.getState().show(tg('Connect to Wi-Fi to download'));
      } else if (failed > 0) {
        useToast.getState().show(tg("{n} songs couldn't be downloaded", { n: failed }));
      } else {
        // Confirmation on finish (the initial "Downloading…" doesn't say when it ends).
        useToast
          .getState()
          .show(
            pending.length === 1
              ? tg('Song downloaded')
              : tg('{n} songs downloaded', { n: pending.length }),
          );
      }
    } finally {
      cancelling.delete(groupKey);
      activeTasks.delete(groupKey);
      set((st) => {
        const active = { ...st.active };
        delete active[groupKey];
        return { active };
      });
    }
  }

  /**
   * Downloads a show's episodes from their enclosure urls. The same shape as
   * `downloadGroup` (slots, progress, cancel, the `files` map) but with no
   * server: the bytes come straight from each episode's own address, and the
   * record of them lives in that profile's SQLite rather than a server catalog.
   */
  async function downloadPodcastGroup(
    groupKey: string,
    episodes: EpisodeSource[],
    wifiOnly = false,
  ): Promise<void> {
    // A podcast download never touches the server: the bytes come from the
    // publisher. Automatic offline (server down) may still download; only a
    // manual "use no network" says no. The rule lives here because the
    // transfer goes through expo-file-system, under the API gate's nose.
    if (isManualOffline()) return;
    if (get().active[groupKey]) return; // already in progress
    // No duplicates, nothing already on disk, nothing without an address.
    const seen = new Set<string>();
    const pending = episodes.filter((e) => {
      if (get().files[e.id] || !e.url || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    if (pending.length === 0) return;

    // "Wi-Fi only" mode: don't start on mobile data.
    if (useSettings.getState().downloadWifiOnly && (await onMobileData())) {
      useToast.getState().show(tg('Connect to Wi-Fi to download'));
      return;
    }

    const dir = podcastFileDir();
    set((st) => ({ active: { ...st.active, [groupKey]: { done: 0, total: pending.length, fraction: 0 } } }));

    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

      const tasks = new Set<ReturnType<typeof FileSystem.createDownloadResumable>>();
      activeTasks.set(groupKey, tasks);

      /** One attempt at one episode. Throws, so the worker decides about retrying. */
      const fetchEpisode = async (ep: EpisodeSource): Promise<void> => {
        // The container the enclosure's address names, so a show serving .m4a
        // stays .m4a (expo-audio reads it by content anyway); mp3 when the
        // address says nothing.
        const file = `${dir}${hashKey(ep.id)}.${urlExtension(ep.url, 'mp3')}`;
        const task = FileSystem.createDownloadResumable(ep.url!, file, {}, (p) => {
          if (p.totalBytesExpectedToWrite > 0) {
            const fraction = p.totalBytesWritten / p.totalBytesExpectedToWrite;
            const cur = get().active[groupKey];
            if (cur && fraction - cur.fraction > 0.05) {
              set((st) => ({ active: { ...st.active, [groupKey]: { ...cur, fraction } } }));
            }
          }
        });
        tasks.add(task);
        try {
          const res = await task.downloadAsync();
          // An enclosure host that answers other than "here is the file" is a
          // failure, not a half-written episode.
          if (!res || res.status < 200 || res.status >= 300)
            throw new TransferError(`HTTP ${res?.status}`, res?.status);
          // A portal or paywall page answers 200 with HTML: the album path
          // calls the same helper, and without it the page would be saved as
          // an episode and marked downloaded.
          if (isErrorBody(res?.headers))
            throw new TransferError('error body, not audio', 200);
          const bytes = Number(header(res?.headers, 'content-length')) || (await fileSize(file));
          // Persisted on completion: if the app dies mid-show, finished episodes
          // survive a restart.
          await saveDownload(podcastScope(), ep, file, bytes);
          set((st) => {
            const cur = st.active[groupKey];
            return {
              files: { ...st.files, [ep.id]: file },
              active: cur
                ? { ...st.active, [groupKey]: { ...cur, done: cur.done + 1, fraction: 0 } }
                : st.active,
            };
          });
        } catch (e) {
          await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
          throw e;
        } finally {
          tasks.delete(task);
        }
      };

      let failed = 0;
      let next = 0;
      let onData = false;
      const workers = Array.from({ length: Math.min(maxSlots(), pending.length) }, async () => {
        while (next < pending.length) {
          if (cancelling.has(groupKey) || onData) break; // stop requested by user
          // Same as songs: no new episode on mobile data once the Wi-Fi went.
          if ((await lostWifi()) || (wifiOnly && (await onMobileData()))) {
            onData = true;
            break;
          }
          const ep = pending[next++];
          for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            await takeSlot();
            try {
              if (cancelling.has(groupKey)) break;
              await fetchEpisode(ep);
              break; // done
            } catch (e) {
              if (cancelling.has(groupKey)) break;
              const status = e instanceof TransferError ? e.status : undefined;
              if (attempt === ATTEMPTS || !worthRetrying(status)) {
                failed++;
                break;
              }
            } finally {
              freeSlot();
            }
            await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS * attempt));
          }
        }
      });
      await Promise.all(workers);

      invalidate();
      if (cancelling.has(groupKey)) {
        useToast.getState().show(tg('Download stopped'));
      } else if (onData) {
        useToast.getState().show(tg('Connect to Wi-Fi to download'));
      } else if (failed > 0) {
        useToast.getState().show(tg("{n} episodes couldn't be downloaded", { n: failed }));
      } else {
        useToast.getState().show(
          pending.length === 1
            ? tg('Episode downloaded')
            : tg('{n} episodes downloaded', { n: pending.length }),
        );
      }
    } finally {
      cancelling.delete(groupKey);
      activeTasks.delete(groupKey);
      set((st) => {
        const active = { ...st.active };
        delete active[groupKey];
        return { active };
      });
    }
  }

  /** Takes the given episode downloads off the phone: the files, the map and
   *  the podcast record. The two delete actions differ only in where the ids
   *  come from — one from a screen, one from the record itself. */
  async function removeEpisodeDownloads(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const paths = ids.map((id) => get().files[id]).filter(Boolean);
    set((st) => {
      const files = { ...st.files };
      for (const id of ids) delete files[id];
      return { files };
    });
    await locked(async () => {
      for (const p of paths) await FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {});
      await dropDownloads(podcastScope(), ids);
    });
    invalidate();
    queryClient.invalidateQueries({ queryKey: ['podcastDownloads'] });
    return ids.length;
  }

  return {
    files: {},
    dlBitRates: {},
    active: {},
    hydrated: false,

    hydrate: async () => {
      // Which run this is. Restoring the session re-runs this while the first
      // one is still going, and that first one, having no account yet, reads
      // every profile and so finishes last: it used to land on top of the
      // right answer and leave the store holding every account's downloads at
      // once. A later run always wins.
      const run = ++hydrateRun;
      const files: Record<string, string> = {};
      const dlBitRates: Record<string, number> = {};
      // The active profile's catalog, or every one of them while there isn't
      // one yet (this runs before the session is restored, and runs again once
      // it is). Reading them all was three files and thirty three seconds on an
      // install that had been signed in more than once, for songs belonging to
      // accounts that aren't playing (#50).
      const active = activeServerDir();
      const dirs = active ? [active] : await serverDirs().catch(() => []);
      for (const dir of dirs) {
        try {
          // Two columns out of the database, not every song parsed out of a file.
          // Timed because offline this is on the way in: nothing is drawn until
          // the app knows whether there is anything downloaded, and on a library
          // of fifteen thousand that wait is the whole of the first screen.
          Object.assign(files, await timed('downloads hydrate', () => Db.downloadedFiles(dir)));
        } catch {
          // A catalog that cannot be read leaves this profile without
          // downloads, not the app without an answer: `hydrated` is what the
          // queue waits on before restoring itself.
        }
      }
      // Podcast episode files, for the profile that owns them. There is no
      // server to key them by, so they live in that profile's SQLite instead of
      // the server catalog; the player reads the same `files` map either way, so
      // a downloaded episode plays offline with no further plumbing.
      try {
        Object.assign(files, await listDownloads(podcastScope()));
      } catch {
        // A podcast database that cannot be read leaves the show's downloads
        // absent, not the app without its server downloads.
      }
      if (run !== hydrateRun) return;
      set({ files, hydrated: true });
      // Not on the way in: it may fetch pictures, though only ever once.
      if (active) setTimeout(() => void sweepTrackCovers(), 20_000);
      // The bitrates come after, on their own: nothing on the way in reads
      // them, and digging them out of the rows' JSON is the expensive half of
      // what this used to ask for (see `downloadedBitRates`).
      void (async () => {
        for (const dir of dirs) {
          try {
            Object.assign(
              dlBitRates,
              await timed('downloads bitrates', () => Db.downloadedBitRates(dir)),
            );
          } catch {
            // Same as above: a badge without its number, not an app without
            // its downloads.
          }
        }
        if (run !== hydrateRun) return;
        set({ dlBitRates });
      })();
    },

    downloadAlbum: async (album, songs) => {
      await downloadGroup(`album:${album.id}`, songs, [album]);
    },

    downloadArtist: async (artistId, songs, albums) => {
      await downloadGroup(`artist:${artistId}`, songs, albums);
    },

    downloadSong: async (song) => {
      await downloadGroup(`song:${song.id}`, [song], [albumFromSong(song)]);
    },

    downloadSongs: async (songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      // Unique key: each batch is an ephemeral group without its own progress UI.
      await downloadGroup(`batch:${Date.now()}`, songs, Array.from(byId.values()));
    },

    downloadPlaylist: async (playlist, songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      await downloadGroup(`playlist:${playlist.id}`, songs, Array.from(byId.values()));
      // The playlist also exists in the local profile, with its server ids.
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

    downloadPodcast: async (channelId) => {
      // The database, not the screen: a show only half loaded still
      // downloads completely.
      const episodes = await listAllEpisodes(podcastScope(), channelId);
      await downloadPodcastGroup(`podcast:${channelId}`, episodes);
      queryClient.invalidateQueries({ queryKey: ['podcastDownloads'] });
    },

    downloadPodcastEpisode: async (episode) => {
      // Its own group, so a stop on one episode doesn't disturb another.
      await downloadPodcastGroup(`episode:${episode.id}`, [episode]);
      queryClient.invalidateQueries({ queryKey: ['podcastDownloads'] });
    },

    autoDownloadEpisodes: async (channelId, episodes) => {
      if (await onMobileData()) return;
      await downloadPodcastGroup(`podcast:${channelId}`, episodes, true);
      queryClient.invalidateQueries({ queryKey: ['podcastDownloads'] });
    },

    deletePodcastDownloads: async (episodeIds) => {
      // The ids a screen holds: one episode's undo hands its own id over.
      await removeEpisodeDownloads(episodeIds);
    },

    deletePodcastChannelDownloads: async (channelId) => {
      // The record answers, never the screen: whatever is on disk for this
      // show goes, including episodes no loaded list ever showed. Returns
      // how many went, for the toast.
      const { ids } = await downloadedForChannel(podcastScope(), channelId);
      return await removeEpisodeDownloads(ids);
    },

    downloadGenre: async (genre, songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      // Keyed by name, which is what a genre is: the servers give it no id of
      // their own that every backend agrees on, and it is what the screen is
      // routed by.
      await downloadGroup(`genre:${genre}`, songs, Array.from(byId.values()));
    },

    downloadFavorites: async (songs) => {
      // Involved albums: those of the songs (partial entry if needed).
      const byId = new Map<string, Album>();
      for (const s of songs) {
        const al = albumFromSong(s);
        if (!byId.has(al.id)) byId.set(al.id, al);
      }
      await downloadGroup('favorites', songs, Array.from(byId.values()));
    },

    cancelDownload: (groupKey) => {
      if (!get().active[groupKey]) return;
      cancelling.add(groupKey);
      // Aborts what is currently downloading (doesn't wait for it to finish).
      const tasks = activeTasks.get(groupKey);
      if (tasks) for (const t of tasks) void t.cancelAsync().catch(() => {});
    },

    deleteSongs: async (songIds) => {
      // The state goes first, before touching the disk: deleting used to show
      // nothing at all until the files were gone, and behind an ongoing
      // download that could be a very long while — long enough to look broken
      // and be retried (#48).
      set((st) => {
        const files = { ...st.files };
        const dlBitRates = { ...st.dlBitRates };
        for (const id of songIds) {
          delete files[id];
          delete dlBitRates[id];
        }
        return { files, dlBitRates };
      });
      // Only the catalog view: the rows already follow `files`, and offline the
      // lists come from a catalog that hasn't changed yet, so asking every
      // screen to re-read here was a full refresh to show the same thing. The
      // one at the end, once the songs are actually gone, is the real one.
      resetCatalogCache();
      await locked(async () => {
        // The signed in profile's, or all of them if there isn't one: opening
        // another account's database has a cost and nothing to find.
        const active = activeServerDir();
        for (const dir of active ? [active] : await serverDirs()) {
          // The rows go first and tell us what they pointed at, so the files
          // are deleted knowing the catalog no longer claims to have them.
          const gone = await Db.removeFromCatalog(dir, songIds);
          for (const s of gone.songs) {
            if (!s.localUri) continue;
            await FileSystem.deleteAsync(s.localUri, { idempotent: true }).catch(() => {});
            // Also the cached lyrics alongside the file, if any.
            const lrc = siblingLrcUri(s.localUri);
            if (lrc) await FileSystem.deleteAsync(lrc, { idempotent: true }).catch(() => {});
          }
          // Albums left with nothing: their cover goes too.
          for (const a of gone.albums) {
            if (a.coverUri) await FileSystem.deleteAsync(a.coverUri, { idempotent: true }).catch(() => {});
            for (const [id, uri] of Object.entries(a.trackCovers ?? {})) {
              forgetCover(id);
              await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
            }
          }
          // And artists left without a single record, picture and all.
          for (const a of await Db.dropEmptyArtists(dir)) {
            if (a.coverUri) await FileSystem.deleteAsync(a.coverUri, { idempotent: true }).catch(() => {});
          }
        }
      });
      invalidate();
    },

    forgetIfMissing: async (songId) => {
      const uri = get().files[songId];
      if (!uri) return false;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists && ((info as { size?: number }).size ?? 1) > 0) return false;
      } catch {
        return false;
      }
      // The file's own address says which record promises it: a podcast
      // file lives under the podcast root, and its row is in the podcast
      // database, not in the server catalog `deleteSongs` walks.
      if (uri.startsWith(PODCAST_ROOT)) {
        await get().deletePodcastDownloads([songId]);
        return true;
      }
      await get().deleteSongs([songId]);
      return true;
    },

    clearAll: async () => {
      await locked(async () => {
        // The databases are closed before their directory goes, or the handles
        // would outlive the files they are pointing at.
        await Db.closeCatalogs();
        await FileSystem.deleteAsync(ROOT_DIR, { idempotent: true }).catch(() => {});
        // Podcast episodes: their files live under a root of their own, outside
        // the server folders. The databases stay — the shows and the hearts are
        // the person's own — but every row pointing at a file that is about to
        // go goes too, with the handles closed before the folder does.
        await clearDownloadRecords();
        await FileSystem.deleteAsync(PODCAST_ROOT, { idempotent: true }).catch(() => {});
      });
      // Local playlists created by downloads no longer resolve songs;
      // they are removed to avoid leaving empty lists.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require('@/lib/localQueries').deleteLocalPlaylistsByPrefix('dl_');
      set({ files: {}, dlBitRates: {}, active: {} });
      invalidate();
      // The sheet caches a show's download count with no expiry, and online
      // `invalidate` leaves the lists alone: without this, „Delete downloads"
      // is still offered for a show whose episodes just went.
      queryClient.invalidateQueries({ queryKey: ['podcastDownloads'] });
    },

    usageBytes: async () => timed('storage used', async () => {
      let total = 0;
      // From the catalog, which knows what each file took when it was written.
      // This used to ask the file system for the size of every single file, one
      // after another: eleven thousand round trips on a large library, each one
      // resolving a promise on the JS thread, so opening this screen made the
      // whole app stutter for as long as it took, and leaving the screen didn't
      // even stop it (#50).
      for (const dir of await serverDirs()) {
        // Added up by the database, which is what a database is for.
        const { known, missing } = await Db.usageBytes(dir);
        total += known;
        // Downloaded before sizes were recorded: measured once, written down,
        // and never measured again.
        if (missing.length > 0) total += await measureMissing(dir, missing);
      }
      // Podcast episodes, whose sizes the podcast database wrote down too.
      // Every profile's folder answers for its own episodes — the signed-in
      // one alone would drop another account's downloads out of the number,
      // the same shape the album side had fixed for #50.
      try {
        for (const scope of await FileSystem.readDirectoryAsync(PODCAST_ROOT)) {
          try {
            total += await downloadedBytes(scope);
          } catch {
            // A podcast database that cannot be read leaves its episodes out
            // of the number, not the screen without one.
          }
        }
      } catch {
        // No podcast folder at all: nothing was ever downloaded to count.
      }
      return total;
    }),
  };
});

/** State of a group's download button (album/playlist header). */
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
