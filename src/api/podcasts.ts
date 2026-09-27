/**
 * Podcasts, subscribed to on the phone and read from their own feeds.
 *
 * The Subsonic API has a podcast section, and asking Navidrome for it is the
 * first thing this does not do: `getPodcasts` answers `501 Not Implemented`,
 * as the whole section does, and that is still the state upstream. Jellyfin and
 * Ampache never had one. A second client that did implement the native path
 * would be a second code path for a server that does not exist, testable only
 * by mocking it, so there is one path here instead: the feed is fetched, read
 * and stored by the phone, and the same shows would be in the same place if a
 * server did host them.
 *
 * Nothing here needs credentials. A feed is public by nature, and a
 * subscription belongs to the profile that made it rather than to whatever the
 * server happens to think of podcasts, so it is filed by `profileScopeId()` and
 * travels with the profile (`lib/profileData.ts` takes it away again).
 *
 * Playback needed no new code: an episode is handed to the queue as a `Song`
 * whose `url` is the enclosure, which is the same path radio takes.
 */
import { fetch } from 'expo/fetch';

import { profileScopeId } from '@/store/auth';

import { hashKey } from '@/lib/localLibrary';
import * as Db from '@/lib/podcastDb';
import type { RecentEpisode } from '@/lib/podcastDb';
import { parseFeed, sortEpisodes, type ParsedItem } from '@/lib/podcastFeed';
import type { PodcastChannel, PodcastEpisode, Song } from './subsonic';

export type { PodcastChannel, PodcastEpisode } from './subsonic';
export type { RecentEpisode } from '@/lib/podcastDb';

/** A feed that answers, but is not a feed. */
export class NotAFeedError extends Error {}

/** A feed that could not be reached at all. */
export class FeedUnreachableError extends Error {}

/**
 * The iTunes directory, for finding a show to subscribe to.
 *
 * Not the only way in — a pasted feed URL works on its own — but it is the way
 * most people will use, because the alternative is being asked for a URL that
 * only the show's own website knows. It is a public search endpoint, keyed by
 * nothing, and it is the only third-party host this app talks to for podcasts.
 */
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

/**
 * What to ask a feed URL for. Deliberately not narrow: the point of the
 * wildcard is the show's *page*, which is what a pasted address usually is, and
 * which has to be readable to be searched for its feed.
 */
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, text/xml, */*';

/** What a search result is, before it is subscribed to. */
export interface PodcastSearchResult {
  /** The feed URL, which is also the identity of the subscription. */
  feedUrl: string;
  title: string;
  author?: string;
  imageUrl?: string;
  /** The show's own page, for someone who would rather read that first. */
  siteUrl?: string;
}

const TIMEOUT_MS = 20_000;

function scope(): string {
  return hashKey(profileScopeId());
}

async function get(url: string, accept: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept, 'user-agent': 'Resonus' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new FeedUnreachableError(String(res.status));
    return await res.text();
  } catch (e) {
    // Everything that is not a body is the same thing to a subscriber: the
    // feed could not be read. Kept distinct from "answered and this is not a
    // feed", which is worth saying, because one is worth retrying later.
    if (e instanceof NotAFeedError || e instanceof FeedUnreachableError) throw e;
    throw new FeedUnreachableError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A feed URL as an id.
 *
 * Hashed, because it is an id and it is long, and normalized first so that the
 * same feed pasted with and without a trailing slash is one subscription. The
 * scheme is left alone: a feed served over http is a real thing, and rewriting
 * it to https is how you break a feed that never worked over TLS.
 */
export function feedId(feedUrl: string): string {
  return hashKey(feedUrl.trim());
}

function normalized(feedUrl: string): string {
  const trimmed = feedUrl.trim();
  if (!trimmed) throw new NotAFeedError('empty');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The feed at a URL, which is not always the URL itself.
 *
 * Someone pastes the show's page — the one a web search gave them — and the
 * feed is a link inside it, declared as `application/rss+xml`. Following that
 * one hop is the difference between "paste the address" and "find the address".
 * The body already fetched is passed in, because the caller has it and
 * re-reading the same URL to find out what it said is a second request for no
 * new information. The hop count is its own: a page pointing at a page
 * pointing at a page is a loop, and without it the timeout is the only thing
 * that would notice.
 */
async function resolveFeed(url: string, body: string, hops = 0): Promise<string> {
  if (looksLikeFeed(body)) return url;
  if (hops >= 2) throw new NotAFeedError(url);

  for (const m of body.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1];
    const type = attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? '';
    if (!/rss|atom|xml/i.test(type)) continue;
    if (!/(^|\s)rel\s*=\s*["']?alternate/i.test(attrs)) continue;
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const next = new URL(href, url).toString();
    return resolveFeed(next, await get(next, FEED_ACCEPT), hops + 1);
  }

  throw new NotAFeedError(url);
}

/** Whether a body is a feed, used to tell a subscription apart from a page. */
function looksLikeFeed(body: string): boolean {
  return /<(rss|feed|channel)\b/i.test(body);
}

/** The stored shape of a parsed item, which is a `ParsedItem` plus its home. */
function toEpisode(channelId: string, item: ParsedItem): PodcastEpisode {
  const episode: PodcastEpisode = { id: item.id, channelId, title: item.title };
  if (item.description) episode.description = item.description;
  if (item.publishedAt !== undefined) episode.publishedAt = item.publishedAt;
  if (item.duration !== undefined) episode.duration = item.duration;
  if (item.url) episode.url = item.url;
  if (item.mimeType) episode.mimeType = item.mimeType;
  if (item.size !== undefined) episode.size = item.size;
  if (item.imageUrl) episode.imageUrl = item.imageUrl;
  return episode;
}

/**
 * Reads one feed and stores what it has.
 *
 * The channel row is written even when the read fails, and that is the point:
 * a feed that has stopped resolving is still subscribed, and the channel list
 * is the only place that can say so. The alternative — leaving a subscription
 * with nothing to show for it — is a subscription the user cannot cancel.
 *
 * Episodes the latest read no longer lists are dropped, because the feed is
 * the truth about what a show publishes and a publisher who pulls an episode
 * has pulled it.
 */
export async function refreshChannel(input: string): Promise<PodcastChannel> {
  const url = normalized(input);
  const id = feedId(url);
  const s = scope();
  const existing = await Db.getChannel(s, id);

  let body: string;
  let resolved = url;
  try {
    body = await get(url, FEED_ACCEPT);
    resolved = await resolveFeed(url, body);
    // The address found is the one to read, and to keep: refreshing the show's
    // page to rediscover the feed every time would be one extra request per
    // subscription per refresh, for an answer already written down.
    if (resolved !== url) body = await get(resolved, FEED_ACCEPT);
  } catch (e) {
    const channel: PodcastChannel = {
      id,
      // A title already read is worth more than the URL, which is not a name.
      title: existing?.title ?? url,
      feedUrl: resolved,
      error: e instanceof Error ? e.message : String(e),
      refreshedAt: Date.now(),
    };
    if (existing) {
      channel.imageUrl = existing.imageUrl;
      channel.episodeCount = existing.episodeCount;
      channel.lastPublishedAt = existing.lastPublishedAt;
    }
    await Db.addFeed(s, resolved);
    await Db.saveChannel(s, channel);
    throw e;
  }

  const feed = parseFeed(body, id);
  const episodes = sortEpisodes(feed.items).map((item) => toEpisode(id, item));
  const dates = episodes
    .map((e) => e.publishedAt)
    .filter((d): d is number => d !== undefined);

  const channel: PodcastChannel = {
    id,
    title: feed.title?.trim() || existing?.title || url,
    feedUrl: resolved,
    refreshedAt: Date.now(),
    episodeCount: episodes.length,
    // A feed that dates nothing is sorted by what was there before, rather than
    // falling to the bottom of the list for lacking something optional.
    lastPublishedAt: dates.length > 0 ? Math.max(...dates) : existing?.lastPublishedAt,
  };
  if (feed.description) channel.description = feed.description;
  if (feed.author) channel.author = feed.author;
  if (feed.imageUrl) channel.imageUrl = feed.imageUrl;
  if (feed.siteUrl) channel.siteUrl = feed.siteUrl;

  await Db.saveChannel(s, channel);
  await Db.saveEpisodes(s, episodes);
  await Db.pruneEpisodes(s, id, episodes.map((e) => e.id));
  // Recorded here as well as on failure, because subscribing *is* this call:
  // without it the channel would be listed with nothing to refresh it from,
  // and pull-to-refresh would read an empty list of feeds.
  await Db.addFeed(s, resolved);
  return channel;
}

/**
 * Subscribes to a feed, which is its address or the show's page.
 *
 * Nothing is written until the feed has answered, so a URL that is not a feed
 * is refused with no subscription left behind — except a feed that failed to
 * answer, which stays subscribed on purpose (`refreshChannel` says why).
 */
export async function subscribe(input: string): Promise<PodcastChannel> {
  return refreshChannel(input);
}

/** Unsubscribes: the channel, its episodes and its feed. */
export async function unsubscribe(id: string): Promise<void> {
  await Db.removeChannel(scope(), id);
}

/** Every subscribed channel, most recently published first. */
export async function listChannels(): Promise<PodcastChannel[]> {
  return Db.listChannels(scope());
}

export async function getChannel(id: string): Promise<PodcastChannel | undefined> {
  return Db.getChannel(scope(), id);
}

export async function listEpisodes(channelId: string): Promise<PodcastEpisode[]> {
  return Db.listEpisodes(scope(), channelId);
}

/**
 * The newest episodes of every subscription together, for Home's shelf.
 *
 * One query for the lot, and the channel comes back with each of them, so a row
 * can name its show and play it without asking again.
 */
export async function listRecentEpisodes(limit = 20): Promise<RecentEpisode[]> {
  return Db.listRecentEpisodes(scope(), limit);
}

export async function getEpisode(id: string): Promise<PodcastEpisode | undefined> {
  return Db.getEpisode(scope(), id);
}

/**
 * Reads every subscription again, and reports the ones that failed.
 *
 * A failure is collected rather than thrown: one feed that is down is the
 * normal state of the podcast internet, and a refresh that stopped at the
 * first one would leave everything after it stale. Nothing is retried here —
 * the next refresh tries again.
 */
export async function refreshAll(): Promise<{ failed: number; total: number }> {
  const s = scope();
  const feeds = await Db.listFeeds(s);
  let failed = 0;
  for (const feed of feeds) {
    try {
      await refreshChannel(feed);
    } catch {
      failed++;
    }
  }
  return { failed, total: feeds.length };
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

/**
 * An episode, as something the queue can hold.
 *
 * The shape the player already knows, which is the whole reason podcasts
 * needed no changes anywhere in the transport: `url` is the enclosure, exactly
 * as it is for a radio stream, and `coverArt` is the show's artwork address,
 * which `coverArtUrl` passes through untouched (see there).
 */
export function episodeToSong(episode: PodcastEpisode, channel: PodcastChannel): Song {
  const song: Song = {
    id: episode.id,
    title: episode.title,
    artist: channel.title,
    album: channel.title,
    url: episode.url,
    // A file behind that URL, not a station: this is what lets an episode play
    // at the speed the user picked, which is most of why anybody listens to a
    // talk at 1.5× (`speedFor` in the player is the other half).
    vod: true,
  };
  if (channel.imageUrl) song.coverArt = channel.imageUrl;
  if (episode.duration !== undefined) song.duration = episode.duration;
  if (episode.publishedAt !== undefined) song.addedAt = episode.publishedAt;
  const suffix = episode.mimeType ? SUFFIXES[episode.mimeType.toLowerCase()] : undefined;
  if (suffix) song.suffix = suffix;
  return song;
}

/**
 * Looks for a show.
 *
 * iTunes answers with the feed address of every match, so subscribing from a
 * result needs no second lookup. Debounced and cached by the caller, not here:
 * this is one request per keystroke otherwise, and the search box is the only
 * thing that calls it.
 */
export async function search(term: string): Promise<PodcastSearchResult[]> {
  const q = term.trim();
  if (!q) return [];
  const url = `${ITUNES_SEARCH}?media=podcast&entity=podcast&limit=25&term=${encodeURIComponent(q)}`;
  const body = await get(url, 'application/json');
  let parsed: {
    results?: {
      feedUrl?: string;
      collectionName?: string;
      artistName?: string;
      artworkUrl100?: string;
      artworkUrl600?: string;
      collectionViewUrl?: string;
    }[];
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not a feed and not a feed that could not be reached: the directory
    // answered with something else, which the sheet reports as a failed search
    // and offers to retry.
    throw new Error('search');
  }
  const out: PodcastSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of parsed.results ?? []) {
    if (!r.feedUrl) continue;
    if (seen.has(r.feedUrl)) continue;
    seen.add(r.feedUrl);
    const result: PodcastSearchResult = {
      feedUrl: r.feedUrl,
      title: r.collectionName?.trim() || r.feedUrl,
    };
    if (r.artistName) result.author = r.artistName;
    // The small picture: these lists are thumbnails, and the 600px one costs
    // the same request to ask for.
    if (r.artworkUrl100) result.imageUrl = r.artworkUrl100;
    if (r.collectionViewUrl) result.siteUrl = r.collectionViewUrl;
    out.push(result);
  }
  return out;
}
