/**
 * Listening recap: what a month or a year of counted listens adds up to.
 *
 * The source is this device's own listen log (`store/listenLog`), not the
 * server: Subsonic has no "everything played between two dates" endpoint, and
 * asking ListenBrainz or Maloja would add a dependency the app does not have.
 * The log records a listen when it crosses the scrobbling threshold, which is
 * already the rule for "this counted as played" everywhere else, so the recap
 * agrees with the play counts.
 *
 * Everything here is pure: given listens and a range, the arithmetic is either
 * right or wrong, and the screen only draws it.
 */

/** One counted listen, as the recap needs it. */
export interface RecapListen {
  songId: string;
  title: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  /** The song's main genre, if the server or the file tagged one. */
  genre?: string;
  /** Seconds credited to this listen. */
  seconds: number;
  /** When the listen counted (ms). */
  playedAt: number;
}

export interface RecapRange {
  /** Inclusive, ms. */
  start: number;
  /** Exclusive, ms. */
  end: number;
}

export type RecapPeriod = 'month' | 'year';

export interface RecapEntry {
  /** Stable identity: two spellings of one artist do not split it. */
  key: string;
  name: string;
  /** Only the songs carry one: the artist, for the second line. */
  subtitle?: string;
  plays: number;
  seconds: number;
}

export interface Recap {
  plays: number;
  seconds: number;
  topArtists: RecapEntry[];
  topSongs: RecapEntry[];
  topGenres: RecapEntry[];
}

/** Shown when a listen has no artist tag. */
export const UNKNOWN_ARTIST = 'Unknown artist';
/** Shown when a listen has no genre tag. */
export const UNKNOWN_GENRE = 'Unknown genre';

/**
 * The calendar month or year that contains `now`, in the device's own time.
 * Local midnight rather than UTC because "this year" is what the person's
 * clock says it is, and a play at 00:30 on 1 January belongs to the new year.
 */
export function recapRange(period: RecapPeriod, now: Date = new Date()): RecapRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  if (period === 'year') {
    return {
      start: new Date(year, 0, 1).getTime(),
      end: new Date(year + 1, 0, 1).getTime(),
    };
  }
  return {
    start: new Date(year, month, 1).getTime(),
    end: new Date(year, month + 1, 1).getTime(),
  };
}

interface Bucket {
  key: string;
  name: string;
  subtitle?: string;
  plays: number;
  seconds: number;
}

function add(
  buckets: Map<string, Bucket>,
  key: string,
  name: string,
  seconds: number,
  subtitle?: string,
): void {
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.plays += 1;
    bucket.seconds += seconds;
    return;
  }
  buckets.set(key, { key, name, subtitle, plays: 1, seconds });
}

function ranked(buckets: Map<string, Bucket>, limit: number): RecapEntry[] {
  return [...buckets.values()]
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        b.seconds - a.seconds ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map(({ key, name, subtitle, plays, seconds }) =>
      subtitle === undefined
        ? { key, name, plays, seconds }
        : { key, name, subtitle, plays, seconds },
    );
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/** A non-negative finite number of seconds, so one bad record cannot poison a total. */
function safeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Adds up the listens inside `range`, newest-agnostic: order in the log does
 * not matter. `limit` bounds each top list (5 by default, which is what the
 * screen shows for a month and for a year).
 */
export function computeRecap(
  listens: readonly RecapListen[],
  range: RecapRange,
  limit = 5,
): Recap {
  const topArtists = new Map<string, Bucket>();
  const topSongs = new Map<string, Bucket>();
  const topGenres = new Map<string, Bucket>();
  let plays = 0;
  let seconds = 0;

  for (const listen of listens) {
    if (!Number.isFinite(listen.playedAt)) continue;
    if (listen.playedAt < range.start || listen.playedAt >= range.end) continue;
    plays += 1;
    const heard = safeSeconds(listen.seconds);
    seconds += heard;

    const artist = trimmed(listen.artist) ?? UNKNOWN_ARTIST;
    const artistKey = listen.artistId
      ? `id:${listen.artistId}`
      : `name:${artist.toLocaleLowerCase()}`;
    add(topArtists, artistKey, artist, heard);

    const genre = trimmed(listen.genre) ?? UNKNOWN_GENRE;
    add(topGenres, `genre:${genre.toLocaleLowerCase()}`, genre, heard);

    add(topSongs, `song:${listen.songId}`, listen.title || listen.songId, heard, artist);
  }

  const take = Math.max(0, Math.floor(limit));
  return {
    plays,
    seconds,
    topArtists: ranked(topArtists, take),
    topSongs: ranked(topSongs, take),
    topGenres: ranked(topGenres, take),
  };
}
