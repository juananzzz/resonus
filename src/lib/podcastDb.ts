/**
 * The podcasts subscribed to on this phone, in SQLite, one database per
 * profile next to that profile's other mirrors.
 *
 * Its own database, and not a table in the download catalog, for the reason
 * `songCacheDb.ts` keeps its own: what is in here is a subscription, which
 * outlives any file and belongs to the user, and the catalog holds what
 * somebody chose to keep and can be emptied for space at any moment. A podcast
 * database is also per profile so that two accounts, or a server and the
 * phone's own library, can follow different shows without seeing each other's.
 *
 * The feed URLs are kept apart from the channels they were read into. A feed
 * that has stopped resolving has to stay subscribed — the user subscribed to
 * the show, not to the current health of its URL — and the channel row holds
 * the error to say so.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import type { PodcastChannel, PodcastEpisode } from '@/api/subsonic';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA journal_size_limit = 524288;
CREATE TABLE IF NOT EXISTS podcast_channels (
  id TEXT PRIMARY KEY NOT NULL,
  feed_url TEXT,
  title TEXT NOT NULL,
  image_url TEXT,
  episode_count INTEGER NOT NULL DEFAULT 0,
  last_published_at INTEGER,
  refreshed_at INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_channels_order
  ON podcast_channels(last_published_at DESC, title);
CREATE TABLE IF NOT EXISTS podcast_episodes (
  id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  published_at INTEGER,
  duration INTEGER,
  url TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS podcast_episodes_channel
  ON podcast_episodes(channel_id, published_at DESC);
CREATE TABLE IF NOT EXISTS podcast_feeds (
  feed_url TEXT PRIMARY KEY NOT NULL,
  added_at INTEGER NOT NULL
);
`;

const ROOT = `${FileSystem.documentDirectory}podcasts/`;

const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/** Where one profile's podcasts are kept. */
export function podcastDbDir(scope: string): string {
  return `${ROOT}${scope}/`;
}

async function openDb(dir: string): Promise<SQLite.SQLiteDatabase> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const db = await SQLite.openDatabaseAsync('podcasts.db', {}, dir.replace(/^file:\/\//, ''));
  await db.execAsync(SCHEMA);
  return db;
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
  await db.runAsync(
    `INSERT OR REPLACE INTO podcast_channels
       (id, feed_url, title, image_url, episode_count, last_published_at, refreshed_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      channel.id,
      channel.feedUrl ?? null,
      channel.title,
      channel.imageUrl ?? null,
      channel.episodeCount ?? 0,
      channel.lastPublishedAt ?? null,
      channel.refreshedAt ?? null,
      JSON.stringify(channel),
    ],
  );
}

/**
 * Stores the episodes of a feed, and re-measures their channel.
 *
 * A refresh replaces rather than merges: the feed is the truth about what it
 * publishes, and a publisher who pulls an episode has pulled it. Rows the feed
 * no longer lists are dropped by `pruneEpisodes` below, which the caller
 * decides whether to do.
 */
export async function saveEpisodes(scope: string, episodes: PodcastEpisode[]): Promise<void> {
  if (episodes.length === 0) return;
  const db = await podcastDb(scope);
  await db.withTransactionAsync(async () => {
    for (const e of episodes) {
      await db.runAsync(
        `INSERT OR REPLACE INTO podcast_episodes
           (id, channel_id, published_at, duration, url, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.channelId,
          e.publishedAt ?? null,
          e.duration ?? null,
          e.url ?? null,
          JSON.stringify(e),
        ],
      );
    }
  });
}

/** Drops the episodes of a channel that its latest read no longer lists. */
export async function pruneEpisodes(
  scope: string,
  channelId: string,
  keep: string[],
): Promise<void> {
  const db = await podcastDb(scope);
  if (keep.length === 0) {
    await db.runAsync('DELETE FROM podcast_episodes WHERE channel_id = ?', [channelId]);
  } else {
    // SQLite caps the parameters per statement, so the list goes in batches.
    for (let i = 0; i < keep.length; i += 500) {
      const batch = keep.slice(i, i + 500);
      const marks = batch.map(() => '?').join(',');
      await db.runAsync(
        `DELETE FROM podcast_episodes WHERE channel_id = ? AND id NOT IN (${marks})`,
        [channelId, ...batch],
      );
    }
  }
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

/**
 * The episodes of a channel, newest first, capped.
 *
 * A feed that has been running for a decade lists thousands and the phone has
 * no use for all of them, so only what fits on the screen is read.
 */
export async function listEpisodes(
  scope: string,
  channelId: string,
  limit = 200,
): Promise<PodcastEpisode[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM podcast_episodes
     WHERE channel_id = ?
     ORDER BY COALESCE(published_at, 0) DESC, id ASC
     LIMIT ?`,
    [channelId, limit],
  );
  return rows.map((r) => JSON.parse(r.data) as PodcastEpisode);
}

/** One episode together with the show it belongs to, for a row that shows both. */
export interface RecentEpisode {
  episode: PodcastEpisode;
  channel: PodcastChannel;
}

/**
 * The newest episodes of every subscription at once, for a shelf.
 *
 * Across channels rather than per channel, so this is one query: a shelf wants
 * the newest of everything, and reading each subscription to find that out is a
 * query per show for a list of twenty. The channel is joined in because every
 * row has to say which show it came from and draw the show's cover — an episode
 * rarely has artwork of its own — and because playing one needs the channel to
 * turn it into a `Song`.
 *
 * Only what can actually be played: an episode stored without its enclosure is
 * a row the feed listed and this could not fetch, and the podcast screen leaves
 * those out of the queue for the same reason.
 */
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

export async function getEpisode(
  scope: string,
  id: string,
): Promise<PodcastEpisode | undefined> {
  const db = await podcastDb(scope);
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM podcast_episodes WHERE id = ?',
    [id],
  );
  return row ? (JSON.parse(row.data) as PodcastEpisode) : undefined;
}

/**
 * Unsubscribes: the channel, its episodes, and the feed it was read from.
 *
 * All three, because a subscription that stayed on in the feed table would be
 * read again on the next refresh and the channel would come back on its own.
 * The feed URL is read before the row goes, for that reason.
 */
export async function removeChannel(scope: string, id: string): Promise<void> {
  const channel = await getChannel(scope, id);
  const db = await podcastDb(scope);
  await db.runAsync('DELETE FROM podcast_channels WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM podcast_episodes WHERE channel_id = ?', [id]);
  if (channel?.feedUrl) {
    await db.runAsync('DELETE FROM podcast_feeds WHERE feed_url = ?', [channel.feedUrl]);
  }
}

/**
 * Remembers a feed, keeping it where it was in the order.
 *
 * Ignored when it is already there, not replaced: a refresh must not move a
 * subscription to the end of the list, and the order feeds are read in is the
 * order they were subscribed in.
 */
export async function addFeed(scope: string, feedUrl: string): Promise<void> {
  const db = await podcastDb(scope);
  await db.runAsync('INSERT OR IGNORE INTO podcast_feeds (feed_url, added_at) VALUES (?, ?)', [
    feedUrl,
    Date.now(),
  ]);
}

/** Every feed subscribed to, oldest first, so a refresh reads them in order. */
export async function listFeeds(scope: string): Promise<string[]> {
  const db = await podcastDb(scope);
  const rows = await db.getAllAsync<{ feed_url: string }>(
    'SELECT feed_url FROM podcast_feeds ORDER BY added_at ASC',
  );
  return rows.map((r) => r.feed_url);
}
