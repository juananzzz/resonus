/**
 * Podcasts kept on the device, one SQLite database per profile. Not in the
 * download catalog, which can be emptied for space; a show the user opened is
 * theirs, so it lives here and not in a disposable cache.
 *
 * `podcast_channels` is both what gets refreshed and what was read from each
 * feed, including the error when the last read failed and the validators that
 * make the next read cheap. `podcast_episodes` is what the last read listed,
 * `podcast_favorites` the user's own hearts: a row is a favorited channel
 * (`kind = 'channel'`, `channel_id` its own id) or a favorited episode
 * (`kind = 'episode'`, `channel_id` the show it belongs to) — `channel_id`
 * names the show either way. A column only earns existing when SQL reads it;
 * everything else is the `data` blob, which is what the getters hand back.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import { hashKey, urlExtension } from '@/lib/localLibrary';

import type { PodcastChannel, PodcastEpisode } from '@/api/subsonic';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA journal_size_limit = 524288;
CREATE TABLE IF NOT EXISTS podcast_channels (
  id TEXT PRIMARY KEY NOT NULL,
  feed_url TEXT NOT NULL,
  title TEXT NOT NULL,
  last_published_at INTEGER,
  refreshed_at INTEGER,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS podcast_episodes (
  id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  published_at INTEGER,
  url TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_episodes_channel
  ON podcast_episodes(channel_id, published_at DESC);
CREATE TABLE IF NOT EXISTS podcast_favorites (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  channel_id TEXT,
  favorited_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_favorites_order
  ON podcast_favorites(kind, favorited_at DESC);
CREATE TABLE IF NOT EXISTS podcast_downloads (
  episode_id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  file TEXT NOT NULL,
  bytes INTEGER,
  downloaded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_downloads_channel
  ON podcast_downloads(channel_id, downloaded_at DESC);
CREATE TABLE IF NOT EXISTS podcast_progress (
  episode_id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  position_sec REAL NOT NULL,
  duration_sec REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const ROOT = `${FileSystem.documentDirectory}podcasts/`;

const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/** Where one profile's podcasts are kept. */
export function podcastDbDir(scope: string): string {
  return `${ROOT}${scope}/`;
}

/** The file a show's picture is saved to: derived from the show and its
 *  address, so a reader finds the same path without being told it. It lives
 *  next to the database, not in the downloads folder — the picture belongs
 *  to the kept show, and "delete all downloads" must not take it away. */
function podcastArtFile(scope: string, channelId: string, imageUrl: string): string {
  return `${podcastDbDir(scope)}art/${hashKey(channelId)}.${urlExtension(imageUrl, 'jpg')}`;
}

/** Files a show's picture, once: the feed read that brought the address brings
 * the bytes too, so manual offline has a real file to draw and expo-image's
 * evictable cache is no longer a promise. `known` is what an earlier read filed
 * for the same show, remembered on its row: one stat says whether those bytes
 * are still on disk, which is why the folder no longer has to be listed every
 * time the database opens. The path is what the row remembers, so drawing the
 * cover stays synchronous. A picture that will not land is not a failed read:
 * the show is already on the device, so this answers nothing. */
export async function savePodcastArt(
  scope: string,
  channelId: string,
  imageUrl: string,
  known?: string,
): Promise<string | undefined> {
  const dir = podcastDbDir(scope);
  const file = podcastArtFile(scope, channelId, imageUrl);
  if (known === file && (await FileSystem.getInfoAsync(file)).exists) return file;
  await FileSystem.makeDirectoryAsync(`${dir}art/`, { intermediates: true }).catch(() => {});
  const res = await FileSystem.downloadAsync(imageUrl, file).catch(() => undefined);
  if (!res || res.status !== 200) {
    await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
    return undefined;
  }
  return file;
}

async function openDb(dir: string): Promise<SQLite.SQLiteDatabase> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const db = await SQLite.openDatabaseAsync('podcasts.db', {}, dir.replace(/^file:\/\//, ''));
  await db.execAsync(SCHEMA);
  return db;
}

// Writes go one at a time. Two transactions at once on one connection is an
// error, not a wait — "cannot start a transaction within a transaction" is
// what two screens refreshing the same profile at once would look like. The
// downloads database keeps the same lock for the same reason.
let writeQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

function podcastDb(scope: string): Promise<SQLite.SQLiteDatabase> {
  const dir = podcastDbDir(scope);
  const existing = open.get(dir);
  if (existing) return existing;
  // A failure is not remembered, so the next caller tries again.
  const handle: Promise<SQLite.SQLiteDatabase> = openDb(dir).catch((e) => {
    if (open.get(dir) === handle) open.delete(dir);
    throw e;
  });
  open.set(dir, handle);
  return handle;
}

/** Closes one profile's database, for when its folder is about to go. */
export async function closePodcastDb(scope: string): Promise<void> {
  const dir = podcastDbDir(scope);
  const handle = open.get(dir);
  if (!handle) return;
  open.delete(dir);
  await handle.then((db) => db.closeAsync()).catch(() => {});
}

export async function saveChannel(scope: string, channel: PodcastChannel): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(() =>
    db.runAsync(
      `INSERT OR REPLACE INTO podcast_channels
         (id, feed_url, title, last_published_at, refreshed_at, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        channel.id,
        channel.feedUrl,
        channel.title,
        channel.lastPublishedAt ?? null,
        channel.refreshedAt ?? null,
        JSON.stringify(channel),
      ],
    ),
  );
}

/**
 * A channel's episodes, replaced by what its feed lists now: an episode the
 * publisher pulled goes too.
 *
 * A download whose episode the publisher renamed or pulled points at a file
 * nothing can reach any more: the row goes with it, and the file goes with
 * the row — left alone, those bytes would sit in „Storage used" under a badge
 * and a row no surface shows.
 */
export async function replaceEpisodes(
  scope: string,
  channelId: string,
  episodes: PodcastEpisode[],
): Promise<void> {
  const db = await podcastDb(scope);
  const orphans: string[] = [];
  await serialized(() =>
    db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM podcast_episodes WHERE channel_id = ?', [channelId]);
      for (const e of episodes) {
        await db.runAsync(
          `INSERT OR REPLACE INTO podcast_episodes
             (id, channel_id, published_at, url, data)
           VALUES (?, ?, ?, ?, ?)`,
          [
            e.id,
            e.channelId,
            e.publishedAt ?? null,
            e.url ?? null,
            JSON.stringify(e),
          ],
        );
      }
      // Read once the new episodes are in: these are the downloads this very
      // read orphaned. The file's own address is in the row, so the file can
      // go with it.
      const rows = await db.getAllAsync<{ file: string }>(
        `SELECT d.file FROM podcast_downloads AS d
         WHERE d.channel_id = ?
         AND NOT EXISTS (SELECT 1 FROM podcast_episodes AS e WHERE e.id = d.episode_id)`,
        [channelId],
      );
      for (const r of rows) orphans.push(r.file);
      await db.runAsync(
        `DELETE FROM podcast_downloads
         WHERE channel_id = ?
         AND NOT EXISTS (SELECT 1 FROM podcast_episodes AS e WHERE e.id = episode_id)`,
        [channelId],
      );
    }),
  );
  // Outside the transaction: the rows are gone, the files follow them.
  for (const file of orphans) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
}

export async function listChannels(scope: string): Promise<PodcastChannel[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM podcast_channels
     ORDER BY COALESCE(last_published_at, 0) DESC, title COLLATE NOCASE ASC`,
  );
  return rows.map((r) => JSON.parse(r.data) as PodcastChannel);
}

export async function getChannel(
  scope: string,
  id: string,
): Promise<PodcastChannel | undefined> {
  const db = await podcastDb(scope);
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM podcast_channels WHERE id = ?',
    [id],
  );
  return row ? (JSON.parse(row.data) as PodcastChannel) : undefined;
}

/** One page of a channel's episodes, newest first: old feeds list thousands,
 *  so a read asks for a page at a time rather than the whole show. */
const MAX_EPISODES = 200;

async function listEpisodes(
  scope: string,
  channelId: string,
  limit: number,
  offset: number,
): Promise<PodcastEpisode[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM podcast_episodes
     WHERE channel_id = ?
     ORDER BY COALESCE(published_at, 0) DESC, id ASC
     LIMIT ? OFFSET ?`,
    [channelId, limit, offset],
  );
  return rows.map((r) => JSON.parse(r.data) as PodcastEpisode);
}

/** Every episode of a channel, pages read to the end: a screen shows the
 *  whole show, and old feeds list thousands. */
export async function listAllEpisodes(scope: string, channelId: string): Promise<PodcastEpisode[]> {
  const all: PodcastEpisode[] = [];
  for (let offset = 0; ; offset += MAX_EPISODES) {
    const page = await listEpisodes(scope, channelId, MAX_EPISODES, offset);
    all.push(...page);
    if (page.length < MAX_EPISODES) return all;
  }
}

/** One episode together with the show it belongs to, for a row that shows both. */
export interface RecentEpisode {
  episode: PodcastEpisode;
  channel: PodcastChannel;
}

/** When a kept item was hearted and last listened to, for the Library's orders. */
export interface FavoriteTimes {
  favoritedAt: number;
  listenedAt: number;
}

/** The newest playable episodes across every channel, each with its channel. */
export async function listRecentEpisodes(scope: string, limit = 20): Promise<RecentEpisode[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ episode: string; channel: string }>(
    `SELECT e.data AS episode, c.data AS channel
     FROM podcast_episodes e
     JOIN podcast_channels c ON c.id = e.channel_id
     WHERE e.url IS NOT NULL AND e.url <> ''
     ORDER BY COALESCE(e.published_at, 0) DESC, e.id ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    episode: JSON.parse(r.episode) as PodcastEpisode,
    channel: JSON.parse(r.channel) as PodcastChannel,
  }));
}

/** Every feed kept on the device, the one least recently read first. The
 * channels are the feeds — a show is only filed once its feed has been read, and
 * a read that failed keeps the address it tried — so a refresh-all has nothing
 * else to ask for. A row written before this change can have no address, and
 * there is nothing to read for it. */
export async function listFeeds(scope: string): Promise<string[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ feed_url: string }>(
    'SELECT feed_url FROM podcast_channels WHERE feed_url IS NOT NULL ORDER BY COALESCE(refreshed_at, 0) ASC',
  );
  return rows.map((r) => r.feed_url);
}

/**
 * Hearts on/off. A favorite is the user's own, so it lives here and not in the
 * server's starring: `kind` says whether the id is a show or one of its episodes,
 * and `channel_id` is the show either way — the id for a channel, its show for an
 * episode — so one row can find the show an episode belongs to. Returns whether
 * the item is favorited now.
 */
export async function toggleFavorite(
  scope: string,
  id: string,
  kind: 'channel' | 'episode',
  channelId: string,
): Promise<boolean> {
  const db = await podcastDb(scope);
  // Read and write as one step: two taps on the same heart must not both see
  // the old state and write the same answer.
  return serialized(async () => {
    const existing = await db.getFirstAsync<{ favorited_at: number }>(
      'SELECT favorited_at FROM podcast_favorites WHERE id = ?',
      [id],
    );
    if (existing) {
      await db.runAsync('DELETE FROM podcast_favorites WHERE id = ?', [id]);
      return false;
    }
    await db.runAsync(
      'INSERT INTO podcast_favorites (id, kind, channel_id, favorited_at) VALUES (?, ?, ?, ?)',
      [id, kind, channelId, Date.now()],
    );
    return true;
  });
}

/** The ids the user has hearted, for a row to show its heart without a query each. */
export async function favoriteIds(scope: string): Promise<Set<string>> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM podcast_favorites',
    [],
  );
  return new Set(rows.map((r) => r.id));
}

/** The favorited shows, most recently hearted first. */
export async function listFavoriteChannels(
  scope: string,
): Promise<(PodcastChannel & FavoriteTimes)[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ data: string; favorited_at: number; listened_at: number | null }>(
    `SELECT c.data, f.favorited_at,
       (SELECT MAX(p.updated_at) FROM podcast_progress p WHERE p.channel_id = c.id) AS listened_at
     FROM podcast_favorites f
     JOIN podcast_channels c ON c.id = f.id
     WHERE f.kind = 'channel'
     ORDER BY f.favorited_at DESC`,
  );
  return rows.map((r) => ({
    ...(JSON.parse(r.data) as PodcastChannel),
    favoritedAt: r.favorited_at,
    listenedAt: r.listened_at ?? 0,
  }));
}

/** The favorited episodes, each with its show, most recently hearted first. */
export async function listFavoriteEpisodes(
  scope: string,
  limit = 100,
): Promise<(RecentEpisode & FavoriteTimes)[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{
    episode: string;
    channel: string;
    favorited_at: number;
    listened_at: number | null;
  }>(
    `SELECT e.data AS episode, c.data AS channel, f.favorited_at, p.updated_at AS listened_at
     FROM podcast_favorites f
     JOIN podcast_episodes e ON e.id = f.id
     JOIN podcast_channels c ON c.id = e.channel_id
     LEFT JOIN podcast_progress p ON p.episode_id = e.id
     WHERE f.kind = 'episode'
     ORDER BY f.favorited_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    episode: JSON.parse(r.episode) as PodcastEpisode,
    channel: JSON.parse(r.channel) as PodcastChannel,
    favoritedAt: r.favorited_at,
    listenedAt: r.listened_at ?? 0,
  }));
}

/** Where an episode was left. Its own table: a feed read replaces the episodes. */
export async function saveEpisodeProgress(
  scope: string,
  episode: { id: string; channelId: string; positionSec: number; durationSec: number },
): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(() =>
    db.runAsync(
      `INSERT OR REPLACE INTO podcast_progress
         (episode_id, channel_id, position_sec, duration_sec, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [episode.id, episode.channelId, episode.positionSec, episode.durationSec, Date.now()],
    ),
  );
}

export async function clearEpisodeProgress(scope: string, id: string): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(() => db.runAsync('DELETE FROM podcast_progress WHERE episode_id = ?', [id]));
}

export async function listEpisodeProgress(
  scope: string,
  channelId: string,
): Promise<{ id: string; positionSec: number; durationSec: number }[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ episode_id: string; position_sec: number; duration_sec: number }>(
    'SELECT episode_id, position_sec, duration_sec FROM podcast_progress WHERE channel_id = ?',
    [channelId],
  );
  return rows.map((r) => ({ id: r.episode_id, positionSec: r.position_sec, durationSec: r.duration_sec }));
}

export async function getEpisodeProgress(
  scope: string,
  id: string,
): Promise<{ positionSec: number; durationSec: number } | undefined> {
  const db = await podcastDb(scope);
  const row = await db.getFirstAsync<{ position_sec: number; duration_sec: number }>(
    'SELECT position_sec, duration_sec FROM podcast_progress WHERE episode_id = ?',
    [id],
  );
  return row ? { positionSec: row.position_sec, durationSec: row.duration_sec } : undefined;
}

/**
 * Takes a show off the device: its row, its episodes, its hearts, its download
 * records and its picture. The downloaded files are unlinked by the caller
 * first, from the same records this clears.
 */
export async function removeChannel(scope: string, id: string): Promise<void> {
  const channel = await getChannel(scope, id);
  const db = await podcastDb(scope);
  await serialized(() =>
    db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM podcast_channels WHERE id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_episodes WHERE channel_id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_favorites WHERE channel_id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_downloads WHERE channel_id = ?', [id]);
      await db.runAsync('DELETE FROM podcast_progress WHERE channel_id = ?', [id]);
    }),
  );
  if (channel?.imageUrl) {
    await FileSystem.deleteAsync(podcastArtFile(scope, id, channel.imageUrl), {
      idempotent: true,
    }).catch(() => {});
  }
}

/**
 * A downloaded episode: its file on disk, remembered so a cold start can hand
 * the same path back to the player. `channel_id` lets a whole show's downloads
 * be counted and cleared together.
 */
export async function saveDownload(
  scope: string,
  episode: { id: string; channelId: string },
  fileUri: string,
  bytes: number | undefined,
): Promise<void> {
  const db = await podcastDb(scope);
  await serialized(() =>
    db.runAsync(
      `INSERT OR REPLACE INTO podcast_downloads
         (episode_id, channel_id, file, bytes, downloaded_at)
       VALUES (?, ?, ?, ?, ?)`,
      [episode.id, episode.channelId, fileUri, bytes ?? null, Date.now()],
    ),
  );
}

/** Drops downloads from the record (the file itself is unlinked by the
 *  caller). Chunked like every other id list: SQLite counts placeholders,
 *  and a whole show's ids would otherwise pass the parameter limit. */
const PARAM_CHUNK = 400;

export async function dropDownloads(scope: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await podcastDb(scope);
  for (let i = 0; i < ids.length; i += PARAM_CHUNK) {
    const part = ids.slice(i, i + PARAM_CHUNK);
    await serialized(() =>
      db.runAsync(
        `DELETE FROM podcast_downloads WHERE episode_id IN (${part.map(() => '?').join(', ')})`,
        part,
      ),
    );
  }
}

/** Every downloaded episode's file, keyed by episode id, for the player's map. */
export async function listDownloads(scope: string): Promise<Record<string, string>> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string; file: string }>(
    `SELECT episode_id AS id, file FROM podcast_downloads
     WHERE EXISTS (SELECT 1 FROM podcast_episodes AS e WHERE e.id = episode_id)`,
    [],
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id] = r.file;
  return out;
}

/**
 * What the downloaded episodes take, added up by the database: the size was
 * written down when each file landed, so this is a sum, not a walk.
 */
export async function downloadedBytes(scope: string): Promise<number> {
  const db = await podcastDb(scope);
  const row = await db.getFirstAsync<{ total: number | null }>(
    // Only what an episode still reaches counts: a row whose episode the
    // publisher pulled is cleaned by the read that pulled it, and this is the
    // belt that keeps such a row from sitting in the number anyway.
    `SELECT SUM(bytes) AS total FROM podcast_downloads
     WHERE EXISTS (SELECT 1 FROM podcast_episodes AS e WHERE e.id = episode_id)`,
  );
  return row?.total ?? 0;
}

/**
 * Forgets every downloaded episode in every profile's database, and closes the
 * handles: the files under `podcast-downloads/` are about to go, and rows
 * pointing at them would hand the player a path that no longer exists. The
 * databases themselves stay — the shows and the hearts are the person's own.
 */
export async function clearDownloadRecords(): Promise<void> {
  const scopes = await FileSystem.readDirectoryAsync(ROOT).catch(() => [] as string[]);
  for (const scope of scopes) {
    try {
      const db = await podcastDb(scope);
      await serialized(() => db.runAsync('DELETE FROM podcast_downloads', []));
    } catch {
      // A database that cannot be opened has no rows anyone can read.
    }
    // Closed right after: touching every profile's database must not leave a
    // handle open for each of them.
    await closePodcastDb(scope);
  }
}

/** How many of a show's episodes are downloaded, and their ids. */
export async function downloadedForChannel(
  scope: string,
  channelId: string,
): Promise<{ ids: string[]; count: number }> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT episode_id AS id FROM podcast_downloads WHERE channel_id = ?',
    [channelId],
  );
  const ids = rows.map((r) => r.id);
  return { ids, count: ids.length };
}
