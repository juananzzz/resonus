/**
 * Podcasts, kept on the phone and read from their own feeds.
 *
 * Navidrome answers the Subsonic podcast endpoints with 501, and Jellyfin and
 * Ampache have none, so no server is asked. Subscriptions are filed per
 * profile (`profileScopeId()`) and `lib/profileData.ts` deletes them with it.
 * An episode plays as a `Song` whose `url` is the enclosure, like radio.
 */
import { fetch } from 'expo/fetch';

import { assertCanRequest, isManualOffline, OfflineError } from './netGate';
import { profileScopeId } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { episodeMarkedByHand, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';

import { episodePlayed } from '@/lib/episodeResume';
import { hashKey } from '@/lib/localLibrary';
import { invalidatePodcastFavorites, invalidatePodcastLists, queryClient } from '@/lib/query';
import * as Db from '@/lib/podcastDb';
import type { RecentEpisode } from '@/lib/podcastDb';
import { parseFeed, sortEpisodes, type ParsedItem } from '@/lib/podcastFeed';
import type { PodcastChannel, PodcastEpisode, Song } from './subsonic';

export type { PodcastChannel, PodcastEpisode } from './subsonic';
export type { RecentEpisode } from '@/lib/podcastDb';

/**
 * Why a feed read failed, as a stable code rather than a message. It is what
 * gets filed on the channel row, so the reason survives to be read back offline,
 * and so the surfaces that show it can split "you're offline" from "the feed
 * itself was bad" without sniffing at somebody's error text.
 */
type FeedCode = 'offline' | 'notFeed' | 'http';

class FeedError extends Error {
  code: FeedCode;
  constructor(code: FeedCode) {
    super();
    this.code = code;
  }
}

/** The iTunes directory: search returns each show's feed URL. */
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

/** Same store, looked up by id: the charts give ids, this turns them into feeds. */
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';

/** The iTunes Store's own top-podcasts chart; a starting point for discovery. */
// What iTunes is asked for: one screen's worth of search answers, and the
// charts at a full Explore page — nobody scrolls past these either way.
const SEARCH_LIMIT = 25;
const CHART_LIMIT = 100;
const ITUNES_CHARTS = `https://itunes.apple.com/us/rss/toppodcasts/limit=${CHART_LIMIT}/json`;

/** Wide on purpose: a pasted address is often the show's HTML page. */
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, text/xml, */*';

export interface PodcastSearchResult {
  feedUrl: string;
  title: string;
  author?: string;
  imageUrl?: string;
}

const TIMEOUT_MS = 20_000;
const AUTO_DOWNLOAD_EPISODES = 3;
const AUTO_DOWNLOAD_READ_MS = 1000 * 60 * 60 * 6;

function scope(): string {
  return hashKey(profileScopeId());
}

/**
 * A read of one address: the text that landed, the address it landed on (a page
 * hops), and the validators the publisher offered to make the next read cheap.
 * `notModified` says the publisher answered "unchanged" — there is no body, and
 * what is stored is still what it lists.
 */
interface FeedRead {
  url: string;
  body: string;
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
}

/** The validators of the row under this exact address, sent back as they came. */
interface FeedValidators {
  etag?: string;
  lastModified?: string;
}

async function get(url: string, accept: string, since?: FeedValidators): Promise<FeedRead> {
  // Podcast hosts are nobody's server: the publisher's feed and the iTunes
  // directory are as reachable when the app fell offline because the server
  // stopped answering as when it did not. Only a manual "use no network" says
  // no — the same split `netGate` draws for LRCLIB.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    assertCanRequest(!isManualOffline());
    const res = await fetch(url, {
      headers: {
        accept,
        'user-agent': 'Resonus',
        // One validator only: a server handed both would answer 412 to a feed
        // whose etag moved but whose date did not, and that is a lost show.
        ...(since?.etag ? { 'if-none-match': since.etag } : {}),
        ...(since && !since.etag && since.lastModified ? { 'if-modified-since': since.lastModified } : {}),
      },
      signal: ctl.signal,
    });
    // Before `ok`: 304 is not a success code, and it is exactly the cheap
    // answer a conditional read exists to get — no body, nothing to parse.
    if (res.status === 304) return { url, body: '', notModified: true };
    if (!res.ok) throw new FeedError('http');
    const etag = res.headers.get('etag');
    const modified = res.headers.get('last-modified');
    return {
      url,
      body: await res.text(),
      ...(etag ? { etag } : {}),
      ...(modified ? { lastModified: modified } : {}),
    };
  } catch (e) {
    if (e instanceof OfflineError) throw new FeedError('offline');
    if (e instanceof FeedError) throw e;
    throw new FeedError('http');
  } finally {
    clearTimeout(timer);
  }
}

/** The scheme is left alone: some feeds only work over http. */
function feedId(feedUrl: string): string {
  return hashKey(feedUrl.trim());
}

function normalized(feedUrl: string): string {
  const trimmed = feedUrl.trim();
  if (!trimmed) throw new FeedError('notFeed');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The feed behind a read: the read itself when its text is a feed, otherwise the
 * `rel="alternate"` RSS/Atom link of the page it points at, followed up to two
 * times so pages linking pages end. The text comes back with the address it was
 * read from: the read that found the feed already holds it, and fetching that
 * address again would ask a publisher for its whole feed twice.
 */
const MAX_FEED_HOPS = 2;

async function resolveFeed(read: FeedRead, hops = 0): Promise<FeedRead> {
  if (read.notModified || looksLikeFeed(read.body)) return read;
  if (hops >= MAX_FEED_HOPS) throw new FeedError('notFeed');

  for (const m of read.body.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1];
    const type = attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? '';
    if (!/rss|atom|xml/i.test(type)) continue;
    if (!/(^|\s)rel\s*=\s*["']?alternate/i.test(attrs)) continue;
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const next = new URL(href, read.url).toString();
    return resolveFeed(await get(next, FEED_ACCEPT), hops + 1);
  }

  throw new FeedError('notFeed');
}

function looksLikeFeed(body: string): boolean {
  return /<(rss|feed|channel)\b/i.test(body);
}

function toEpisode(channelId: string, item: ParsedItem): PodcastEpisode {
  const episode: PodcastEpisode = { id: item.id, channelId, title: item.title };
  if (item.description) episode.description = item.description;
  if (item.publishedAt !== undefined) episode.publishedAt = item.publishedAt;
  if (item.episode !== undefined) episode.episode = item.episode;
  if (item.duration !== undefined) episode.duration = item.duration;
  if (item.url) episode.url = item.url;
  if (item.mimeType) episode.mimeType = item.mimeType;
  return episode;
}

/**
 * Reads one feed and stores it, episodes replaced by what it lists now. This is
 * how a show is opened: the first read files it in SQLite, a later read only
 * updates it. There is no subscribe — opening a show lands it.
 *
 * A new show is only kept once its feed has been read. An existing one that
 * fails stays, with the error on its channel row, so it can still be seen and
 * removed.
 *
 * A read carries the validators the last one got back, so a publisher answering
 * "unchanged" costs a header instead of its whole feed — an old feed body is
 * 5 MB for a show like Radiolab, and it is re-read on opening past three days.
 */
export async function refreshChannel(input: string): Promise<PodcastChannel> {
  const url = normalized(input);
  const s = scope();

  // The row under this exact address. Its validators are the only ones safe to
  // send back — a row whose feed moved answers another address — and its title
  // is the fallback when the feed has none.
  const stored = await Db.getChannel(s, feedId(url));
  const since = stored && stored.feedUrl === url
    ? { etag: stored.etag, lastModified: stored.lastModified }
    : undefined;

  let read: FeedRead;
  try {
    read = await resolveFeed(await get(url, FEED_ACCEPT, since));
  } catch (e) {
    // Keyed by the stored feed, or a refresh would file the show twice.
    if (!stored) throw e;
    await Db.saveChannel(s, {
      ...stored,
      feedUrl: url,
      error: e instanceof FeedError ? e.code : 'http',
      refreshedAt: Date.now(),
    });
    // The lists show the error a feed read wrote down, so they ask again —
    // the show's own screen is the query that is running and answers itself.
    invalidatePodcastLists();
    throw e;
  }

  // The publisher answered "unchanged": what is stored is what it lists now, so
  // the episodes, the downloads and the picture stay and only the clock moves.
  // Only reachable when a row under this address was read conditionally.
  if (read.notModified && stored) {
    const kept: PodcastChannel = { ...stored, refreshedAt: Date.now() };
    await Db.saveChannel(s, kept);
    invalidatePodcastLists();
    return kept;
  }

  // The feed found is what gets stored, so the next refresh skips the page.
  const id = feedId(read.url);
  const existing = read.url === url ? stored : await Db.getChannel(s, id);
  const feed = parseFeed(read.body, id);
  // Which of these the device already had: an episode that was there keeps the
  // moment it first came over, one that was not gets this read's. A feed's `pubDate`
  // cannot carry that: a publisher re-dates an old item, back-catalogs a season
  // or ships no date at all, and the row then prints a date that says nothing
  // about when the episode appeared. Read here and once — `replaceEpisodes`
  // below throws the old rows out, and an episode filed before this field
  // existed answers 0, which is as old as the device and never new.
  const had = new Map<string, number>(
    (await Db.listAllEpisodes(s, id)).map((e) => [e.id, e.firstSeenAt ?? 0]),
  );
  const landedAt = Date.now();
  const episodes = sortEpisodes(feed.items).map((item) => {
    const episode = toEpisode(id, item);
    episode.firstSeenAt = had.get(episode.id) ?? landedAt;
    return episode;
  });
  const dates = episodes
    .map((e) => e.publishedAt)
    .filter((d): d is number => d !== undefined);

  const channel: PodcastChannel = {
    id,
    title: feed.title?.trim() || existing?.title || read.url,
    feedUrl: read.url,
    refreshedAt: Date.now(),
    episodeCount: episodes.length,
    lastPublishedAt: dates.length > 0 ? Math.max(...dates) : existing?.lastPublishedAt,
  };
  // The episodes that came over with this read, and only when a read had
  // something to land: the read that files a show for the first time brings its
  // whole feed at once, and a badge under every title of a 66-episode show says
  // nothing — the same for a feed that moved address, which reads as a first
  // time. The mark stays until the next read that lands something.
  const landed = episodes.filter((e) => e.firstSeenAt === landedAt).length;
  if (landed > 0 && had.size > 0) channel.newSinceAt = landedAt;
  else if (existing?.newSinceAt) channel.newSinceAt = existing.newSinceAt;
  if (feed.description) channel.description = feed.description;
  if (feed.author) channel.author = feed.author;
  if (feed.imageUrl) channel.imageUrl = feed.imageUrl;
  if (feed.siteUrl) channel.siteUrl = feed.siteUrl;
  // The next read asks with these, and gets a header back instead of the body.
  if (read.etag) channel.etag = read.etag;
  if (read.lastModified) channel.lastModified = read.lastModified;

  // The picture belongs to the read that just happened: filing it here is what
  // keeps a kept show's art drawable when manual offline says no to fetching and
  // expo-image's cache has evicted the address. An earlier read that already
  // filed this one is not asked for its bytes again.
  if (channel.imageUrl) channel.artFile = await Db.savePodcastArt(s, id, channel.imageUrl, existing?.artFile);

  await Db.saveChannel(s, channel);
  await Db.replaceEpisodes(s, id, episodes);
  if (landed > 0 && had.size > 0 && useSettings.getState().podcastAutoDownload) {
    const newest = episodes.filter((e) => e.firstSeenAt === landedAt && e.url).slice(0, AUTO_DOWNLOAD_EPISODES);
    if ((await favoriteIds()).has(id)) {
      void useDownloads.getState().autoDownloadEpisodes(
        id,
        newest.map((e) => ({ id: e.id, url: e.url!, channelId: id })),
      );
    }
  }
  // A show that was never on the device is in the lists now, and one that was
  // may have a new episode count or a new picture: the browser, Home's shelf
  // and the favorite lists ask again. The show's own screen is the query that
  // called this, and it answers itself.
  invalidatePodcastLists();
  return channel;
}

/** The show's picture: the file the read filed for it, else the feed's address.
 * Synchronous because whoever draws a cover asks while rendering. */
export function podcastCover(channel: PodcastChannel): string | undefined {
  return channel.artFile ?? channel.imageUrl;
}

/** The stored channel by its feed address, before it is opened. */
export async function getStoredChannel(feedUrl: string): Promise<PodcastChannel | undefined> {
  return Db.getChannel(scope(), feedId(feedUrl));
}

export async function getChannel(id: string): Promise<PodcastChannel | undefined> {
  return Db.getChannel(scope(), id);
}

/** Takes a show off the device, with its episodes and hearts. */
export async function removeChannel(id: string): Promise<void> {
  await Db.removeChannel(scope(), id);
}

/** Every channel kept on the device, most recently published first. */
export async function listChannels(): Promise<PodcastChannel[]> {
  return Db.listChannels(scope());
}

/** The route id is either a stored channel id or a percent-encoded feed URL. */
export function isFeedUrl(id: string): boolean {
  return /^https?:\/\//i.test(decodeURIComponent(id));
}

/** Every episode of a channel, pages read to the end. */
export async function listAllEpisodes(channelId: string): Promise<PodcastEpisode[]> {
  return Db.listAllEpisodes(scope(), channelId);
}

/** How many of a show's episodes are downloaded, and their ids. */
export async function downloadedForChannel(
  channelId: string,
): Promise<{ ids: string[]; count: number }> {
  return Db.downloadedForChannel(scope(), channelId);
}

/** The newest playable episodes across every show you keep, for Home. */
export async function listRecentEpisodes(limit = 20): Promise<RecentEpisode[]> {
  return Db.listRecentEpisodes(scope(), limit);
}

/** Hearts. The user's own, kept on the device like the shows themselves: one
 *  entry point that files the SQLite row and invalidates the hearted lists
 *  together, so no surface can forget the pairing. */
export async function togglePodcastHeart(
  id: string,
  kind: 'channel' | 'episode',
  channelId: string,
): Promise<boolean> {
  const added = await Db.toggleFavorite(scope(), id, kind, channelId);
  invalidatePodcastFavorites();
  return added;
}

/** The one answer to a feed that would not load: offline says so,
 *  otherwise it is the publisher's side. One message, one locale key. */
export function feedErrorMessage(translate: (key: string) => string, e: unknown): string {
  return e instanceof FeedError && e.code === 'offline'
    ? translate("You're offline")
    : translate("Couldn't read this feed");
}

/** The hearted ids, so a row can light its heart without asking per row. */
export async function favoriteIds(): Promise<Set<string>> {
  return Db.favoriteIds(scope());
}

/** Stand-in for a heart set that hasn't loaded yet. One instance, so a row's
 * `favSet` prop keeps its identity across renders instead of churning. */
export const NO_FAVORITES: Set<string> = new Set();

export async function listFavoriteChannels(): Promise<(PodcastChannel & Db.FavoriteTimes)[]> {
  return Db.listFavoriteChannels(scope());
}

export async function listFavoriteEpisodes(limit = 100): Promise<(RecentEpisode & Db.FavoriteTimes)[]> {
  return Db.listFavoriteEpisodes(scope(), limit);
}

/**
 * Reads every show you keep again, one at a time so no host sees a burst.
 * Failures are counted, not thrown: one dead feed must not stall the rest.
 * `shouldCancel` is checked before each feed, so a Stop part way through
 * leaves the feeds already read in place and returns without touching the rest.
 */
export async function refreshAll(
  shouldCancel?: () => boolean,
): Promise<{ failed: number; total: number; stopped: boolean }> {
  const s = scope();
  const feeds = await Db.listFeeds(s);
  let failed = 0;
  for (const feed of feeds) {
    if (shouldCancel?.()) return { failed, total: feeds.length, stopped: true };
    try {
      await refreshChannel(feed);
    } catch {
      failed++;
    }
  }
  return { failed, total: feeds.length, stopped: false };
}

/** Re-reads favorite shows gone stale, which is how auto-download sees new
 *  episodes: nothing else reads a feed until its show is opened. */
export async function refreshFavoritesForAutoDownload(): Promise<void> {
  if (!useSettings.getState().podcastAutoDownload || isManualOffline()) return;
  for (const channel of await listFavoriteChannels()) {
    if (Date.now() - (channel.refreshedAt ?? 0) < AUTO_DOWNLOAD_READ_MS) continue;
    await refreshChannel(channel.feedUrl).catch(() => {});
  }
}

/** The ids of a show's episodes that count as played. */
export async function playedEpisodeIds(channelId: string): Promise<Set<string>> {
  const rows = await Db.listEpisodeProgress(scope(), channelId);
  return new Set(rows.filter((r) => episodePlayed(r.positionSec, r.durationSec)).map((r) => r.id));
}

/** Played is progress at the end, so unplayed is no progress: it starts over. */
export async function setEpisodePlayed(song: Song, played: boolean): Promise<void> {
  if (!song.podcastChannelId) return;
  episodeMarkedByHand(song.id, played);
  if (played) {
    const end = song.duration || 1;
    await Db.saveEpisodeProgress(scope(), {
      id: song.id,
      channelId: song.podcastChannelId,
      positionSec: end,
      durationSec: end,
    });
  } else {
    await Db.clearEpisodeProgress(scope(), song.id);
  }
  queryClient.invalidateQueries({ queryKey: ['podcastPlayed'] });
}

const SUFFIXES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** An episode as a queue entry; `coverArtUrl` passes the artwork URL through. */
export function episodeToSong(episode: PodcastEpisode, channel: PodcastChannel): Song {
  const song: Song = {
    id: episode.id,
    title: episode.title,
    // The show stands in for both, so an episode reads like a track off a record
    // named after the show. Nothing navigates these as a real artist/album: every
    // consumer (rows, player, the song menu) gates on `podcastChannelId` first, and
    // the album/artist nav and "More from artist" are unreachable from an episode.
    artist: channel.title,
    album: channel.title,
    url: episode.url,
    // A file, not a station: it can play at another speed.
    vod: true,
    // The show it belongs to: the episode's menu offers "Go to Podcast".
    podcastChannelId: channel.id,
  };
  // The picture the read filed, when it filed one: the player draws this
  // address, and offline only the file is still there.
  const cover = podcastCover(channel);
  if (cover) song.coverArt = cover;
  if (episode.duration !== undefined) song.duration = episode.duration;
  if (episode.publishedAt !== undefined) song.addedAt = episode.publishedAt;
  // The feed's own episode number, kept for the song's info sheet: the show's
  // screen leaves its rows unnumbered, since a place in the list is not something
  // a feed promises, but a number the publisher did give is still worth having.
  if (episode.episode !== undefined) song.track = episode.episode;
  const suffix = episode.mimeType ? SUFFIXES[episode.mimeType.toLowerCase()] : undefined;
  if (suffix) song.suffix = suffix;
  return song;
}

/** Plays one episode as its show's, from wherever it was reached: the queue
 *  gets the song, the show's name as its source, and the show's own address
 *  as where it came from — that address is what makes "Go to Podcast" from
 *  the now-playing header land on this show instead of a search. One call,
 *  so a card, a list row and the Library's two tabs queue it the same way. */
export function queueEpisode(episode: PodcastEpisode, channel: PodcastChannel): void {
  void usePlayerStore.getState().playQueue(
    [episodeToSong(episode, channel)],
    0,
    channel.title,
    `/podcast/${channel.id}`,
  );
}

/** The heart a FavoriteButton writes for an episode: the device's own SQLite
 *  favorite, filed under the show it belongs to. */
export function episodeHeart(song: Song): { kind: 'episode'; channelId: string } | undefined {
  return song.podcastChannelId ? { kind: 'episode', channelId: song.podcastChannelId } : undefined;
}

/** Which heart is lit: an episode's is the device's own SQLite set, a server
 *  song's is the server's list, and what the song carries is the fallback
 *  while that list is still loading. One rule, so the rows, the mini player
 *  and the now-playing header cannot drift apart. */
export function heartedSong(
  song: Song,
  podcastFavIds: Set<string>,
  favIds: Set<string> | undefined,
): boolean {
  return song.podcastChannelId
    ? podcastFavIds.has(song.id)
    : favIds ? favIds.has(song.id) : !!song.starred;
}

/** Searches the iTunes directory, which returns each show's feed URL. */
export async function search(term: string): Promise<PodcastSearchResult[]> {
  const q = term.trim();
  if (!q) return [];
  const url = `${ITUNES_SEARCH}?media=podcast&entity=podcast&limit=${SEARCH_LIMIT}&term=${encodeURIComponent(q)}`;
  const { body } = await get(url, 'application/json');
  let parsed: { results?: iTunesRow[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('iTunes search returned no JSON');
  }
  const out = iTunesResults(parsed.results ?? []);
  return out;
}

/**
 * iTunes search/lookup rows as search results. Both endpoints answer with the
 * same fields; a show with no `feedUrl` cannot be added, so it is left
 * out, and the same feed twice (search lists a show more than once) is kept once.
 */
interface iTunesRow {
  feedUrl?: string;
  collectionName?: string;
  artistName?: string;
  artworkUrl100?: string;
}

function iTunesResults(results: iTunesRow[]): PodcastSearchResult[] {
  const out: PodcastSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!r.feedUrl || seen.has(r.feedUrl)) continue;
    seen.add(r.feedUrl);
    const result: PodcastSearchResult = {
      feedUrl: r.feedUrl,
      title: r.collectionName?.trim() || r.feedUrl,
    };
    if (r.artistName) result.author = r.artistName;
    if (r.artworkUrl100) result.imageUrl = r.artworkUrl100;
    out.push(result);
  }
  return out;
}

/**
 * Discovery: the iTunes Store's top-podcasts chart, as addable shows.
 *
 * The chart lists each show's store id, not its feed, so the ids go to the
 * lookup endpoint to get the feed back.
 */
export async function charts(): Promise<PodcastSearchResult[]> {
  const { body } = await get(ITUNES_CHARTS, 'application/json');
  let parsed: {
    feed?: {
      entry?: {
        id?: { attributes?: { 'im:id'?: string } };
      }[];
    };
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('iTunes charts returned no JSON');
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const e of parsed.feed?.entry ?? []) {
    const id = e.id?.attributes?.['im:id'];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= CHART_LIMIT) break;
  }
  if (ids.length === 0) return [];
  const { body: lookupBody } = await get(
    `${ITUNES_LOOKUP}?id=${ids.join(',')}&entity=podcast`,
    'application/json',
  );
  let lk: { results?: iTunesRow[] };
  try {
    lk = JSON.parse(lookupBody);
  } catch {
    throw new Error('iTunes lookup returned no JSON');
  }
  return iTunesResults(lk.results ?? []);
}
