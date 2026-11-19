/**
 * The rules over the queues that were listened to, kept on the device.
 *
 * The store in `src/store/savedQueues.ts` holds the list and reads and writes
 * the disk; everything that decides what the list may look like — the cap, the
 * order, which entry is the queue on screen right now — is here, pure, so
 * `test/savedQueues.test.ts` can check it without an app.
 *
 * One queue is not a playlist: nobody asked for it, it is what happened to be
 * playing. What makes it worth bringing back is the place the listening stopped,
 * so an entry keeps the songs behind the cursor, the cursor itself, and how far
 * the current song had got into itself.
 */
import type { Song } from '@/api/subsonic';
import type { RepeatMode } from './queue';

/**
 * What one queue holds: the songs behind the cursor, the cursor itself, how far
 * the current song had got, and what the queue was started as. This is also the
 * shape the single queue the player saves on its own is written in, so the two
 * agree about what a queue is.
 */
export interface StoredQueue {
  queue: Song[];
  index: number;
  /** Where the current song had got to, in seconds. */
  positionSec: number;
  /** The queue was a radio: when restoring it must keep extending itself. */
  radioMode?: boolean;
  /** Track the radio was started from, so it keeps extending from the same
   *  place after a restart. Absent in queues saved by older versions: those
   *  fall back to seeding off the tail. */
  radioSeed?: Song | null;
  /** Where the queue came from, for the player's "playing from" header. */
  source?: string | null;
  /** Route of that origin, so tapping the header still navigates there. */
  sourceHref?: string | null;
  /**
   * Shuffle and repeat as they were left (#102). Both are how someone listens
   * rather than something they set up once, and finding them off after every
   * cold start meant turning them on again each morning. `originalQueue` is
   * NOT saved: it would double what a queue weighs, and turning shuffle off
   * without it keeps the order that is playing instead of restoring the
   * album's, which is a fair price for a session that already ended.
   */
  shuffle?: boolean;
  repeat?: RepeatMode;
  /** Speed and varispeed as they were left (#325). */
  speed?: number;
  varispeed?: boolean;
  /** The queue was dealt when it was started (see the player's `queueDealt`). */
  dealt?: boolean;
  /**
   * When this device last wrote it (ms). Only read to compare against the
   * server's copy: what is newer decides which of the two is somebody's last
   * word, and a phone that listened all afternoon with no connection must not
   * be handed yesterday's queue from another player on reconnecting.
   */
  savedAt?: number;
}

/** What the player has on screen, as far as keeping a queue is concerned. */
export interface QueueListening {
  queue: Song[];
  index: number;
  positionSec: number;
  radioMode: boolean;
  radioSeed: Song | null;
  source: string | null;
  sourceHref: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
  speed: number;
  varispeed: boolean;
  queueDealt: boolean;
}

/**
 * What says the queue on screen moved, cheaply enough to be asked on every
 *  change of the player's state: its songs are compared by their array — every
 *  change to a queue makes a new one — so only the rest of what `payloadOf`
 *  keeps comes here, and the position with a step of a second, since a tick of
 *  one is not a difference anybody can see on a card. One list of fields is
 *  what matters: keeping the archive up to date cannot fall behind on a field
 *  `payloadOf` writes down and nobody thought of comparing.
 */
export function listeningStamp(listening: QueueListening): string {
  return [
    listening.index,
    Math.round(listening.positionSec),
    listening.source ?? '',
    listening.sourceHref ?? '',
    listening.radioMode,
    listening.radioSeed?.id ?? '',
    listening.shuffle,
    listening.repeat,
    listening.speed ?? 1,
    listening.varispeed,
    listening.queueDealt,
  ].join('|');
}

/** One queue kept in the archive: what it holds plus what says where it sits. */
export interface SavedQueueEntry extends StoredQueue {
  /** Stable across restarts: a row's key, and what names the live entry. */
  id: string;
  /** Bumped whenever anything in it moved, which is also the shelf's order. */
  updatedAt: number;
  /** Saved by hand: the cap of the automatic ones never sweeps it away. */
  manual?: boolean;
  /** This is the queue on screen right now, not one that ended. */
  live?: boolean;
}

/** How many queues are kept, counted on the automatic ones and their own. */
export const MAX_AUTO = 10;
export const MAX_MANUAL = 10;
/** How many of them Home draws, of up to the two caps together. */
export const SHELF = 10;

/**
 * The file a profile's queues are kept in, name only: the store prefixes it with
 *  the device's own directory, and `@/lib/profileData` removes the same file when
 *  the account that kept it goes away. One place says the name, so the two cannot
 *  disagree about which file is whose.
 */
export function fileName(scope: string): string {
  return `saved-queues-${scope}.json`;
}

/** What the player has on screen, as a queue that can be kept. */
export function payloadOf(state: QueueListening, savedAt: number): StoredQueue {
  return {
    queue: state.queue.slice(0, 500),
    index: Math.min(state.index, 499),
    positionSec: state.positionSec,
    radioMode: state.radioMode,
    radioSeed: state.radioSeed,
    source: state.source,
    sourceHref: state.sourceHref,
    shuffle: state.shuffle,
    dealt: state.queueDealt,
    repeat: state.repeat,
    speed: state.speed,
    varispeed: state.varispeed,
    savedAt,
  };
}

/**
 * The entry for what is on screen: the live slot is not a saved queue yet, and
 * this turns it into one. The mark is what the cap and Home read.
 */
export function entry(id: string, payload: StoredQueue, manual = false): SavedQueueEntry {
  const at = payload.savedAt ?? Date.now();
  return {
    ...payload,
    id,
    updatedAt: at,
    ...(manual ? { manual: true } : {}),
  };
}

/** An entry's own order, for the two questions the update asks about. */
export function order(entry: SavedQueueEntry): string {
  return `${entry.index}/${entry.queue.map((s) => idOf(s)).join(',')}`;
}

/**
 * Everything but the position, cheaply: what says something other than the
 * current song getting further into itself moved. Written over the fields and
 * not over `JSON.stringify` of the entry, because this is asked on a timer and
 * a queue is up to five hundred songs.
 */
export function signature(entry: SavedQueueEntry): string {
  return [
    entry.source ?? '',
    entry.sourceHref ?? '',
    entry.radioMode === true,
    entry.radioSeed?.id ?? '',
    entry.shuffle === true,
    entry.dealt === true,
    entry.repeat ?? 'off',
    entry.speed ?? 1,
    entry.varispeed === true,
    entry.manual === true,
  ].join('|');
}

/**
 * Two queues that are the same listening, position aside. The boot reads the
 * single queue the app saved in the last session and asks whether it is one of
 * the entries already on file: without it, every opening added a copy of the
 * queue that is on screen.
 *
 * The position is left out on purpose: the two copies are written by different
 * code paths and the one that lags is not the one to throw away.
 */
export function sameQueue(
  a: SavedQueueEntry | StoredQueue,
  b: SavedQueueEntry | StoredQueue,
): boolean {
  if (a.index !== b.index || a.queue.length !== b.queue.length) return false;
  for (let i = 0; i < a.queue.length; i++) if (idOf(a.queue[i]) !== idOf(b.queue[i])) return false;
  return true;
}

/** The queue heard from the top again: same songs, nothing heard. */
export function fromBeginning(entry: SavedQueueEntry): SavedQueueEntry {
  return { ...entry, index: 0, positionSec: 0 };
}

/**
 * Puts an entry up as the newest of the list, ahead of the others. A second
 * copy of an id (a queue updated twice, an entry saved by hand over the one on
 * screen) replaces the old copy rather than adding to the list.
 */
export function insert(entries: SavedQueueEntry[], next: SavedQueueEntry): SavedQueueEntry[] {
  const rest = entries.filter((e) => e.id !== next.id);
  return [next, ...rest];
}

/**
 * Drops what no longer earns a place: the cap counts the automatic ones and
 * the hand-saved ones separately, so a mix somebody kept is never the one
 * thrown away because the ten queues after it arrived. A queue that was
 * updated is newer than one that was only saved, so the order in the list
 * decides, and the list is kept newest first.
 */
export function evict(entries: SavedQueueEntry[]): SavedQueueEntry[] {
  let auto = 0;
  let manual = 0;
  const out: SavedQueueEntry[] = [];
  for (const e of entries) {
    if (e.manual) {
      manual++;
      if (manual > MAX_MANUAL) continue;
    } else {
      auto++;
      if (auto > MAX_AUTO) continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * The shelf Home draws: `n` of what is kept, newest first.
 *
 * The queues kept by hand always come along, and only the newest of them when
 *  the shelf cannot hold all of them: `Save queue` says of one that it is
 *  worth keeping, and this row is the only way back to a queue — an entry that
 *  stayed on file but left the row could never be resumed again. What is taken
 *  instead are the automatic ones that sit furthest back. The order stays the
 *  list's, so the row reads as the listening of yesterday followed by the
 *  queue somebody kept, and not as the kept one moved to the front.
 */
export function shelf(entries: SavedQueueEntry[], n = SHELF): SavedQueueEntry[] {
  const picked = new Set(entries.filter((e) => e.manual).slice(0, n).map((e) => e.id));
  for (const e of entries) {
    if (picked.size >= n) break;
    if (!picked.has(e.id)) picked.add(e.id);
  }
  return entries.filter((e) => picked.has(e.id));
}

/**
 * What says the shelf has to be drawn again: which queues sit on it, what each
 *  is called, whose picture it wears and how many songs it holds — everything a
 *  card shows. A second of the current song is left out on purpose: Home would
 *  redraw ten cards a second for a difference no eye can see, while the entry
 *  itself still follows the queue, so resuming keeps the exact second.
 */
export function shelfStamp(entries: SavedQueueEntry[]): string {
  return entries
    .map((e) => `${e.id}:${e.manual ? 'm' : ''}:${queueName(e)}:${heardAt(e)?.id ?? ''}:${e.queue.length}`)
    .join('|');
}

/**
 * The song the listening stopped at, or the first one when nothing was heard.
 */
export function heardAt(entry: SavedQueueEntry): Song | null {
  return entry.queue[entry.index] ?? entry.queue[0] ?? null;
}

/**
 * What a saved queue is called on the shelf: the album, playlist or mix it was
 * started as. The player marks favorites and history with a sentinel rather
 * than a name (see `SOURCE_FAVORITES`), and a sentinel is not a word anybody
 * would read on a card, so a queue that has no name of its own gets the song
 * that was playing when the listening stopped — which still tells the cards
 * apart.
 */
export function queueName(entry: SavedQueueEntry): string {
  const source = entry.source;
  if (source && !source.startsWith('@@')) return source;
  return heardAt(entry)?.title ?? '';
}

/**
 * Adopts a queue that came back as the live one. An entry that is already there
 * keeps its id, so the rows that were drawn under it do not rebuild, and it
 * keeps whichever position is further on: the two copies are written apart, and
 * the one that is behind would otherwise rewind the song.
 *
 * `live` says whether the queue that comes back is the one on screen. One that
 * comes back already ended — an archive read that came late, after the session
 * had put its queues up — keeps its place without taking over the live mark.
 */
export function adopt(
  entries: SavedQueueEntry[],
  liveId: string | null,
  payload: StoredQueue,
  freshId: string,
  live = true,
): { entries: SavedQueueEntry[]; liveId: string | null } {
  const match = entries.find((e) => sameQueue(e, payload));
  if (!match) {
    const fresh = { ...entry(freshId, payload), ...(live ? { live: true } : {}) };
    return { entries: evict(insert(entries, fresh)), liveId: live ? fresh.id : liveId };
  }
  const adopted = {
    ...match,
    ...(live ? { live: true } : { live: undefined }),
    updatedAt: payload.savedAt ?? match.updatedAt,
    positionSec: Math.max(match.positionSec, payload.positionSec ?? 0),
  };
  // The live entry goes to the front, so the shelf's newest is what is playing.
  const rest = entries.filter((e) => e.id !== match.id);
  return {
    entries: evict([adopted, ...rest]),
    liveId: live ? match.id : liveId === match.id ? null : liveId,
  };
}

/** What the live entry becomes when a new queue takes the player over. */
/**
 * Takes the live mark away: the queue that was on screen is over, and what
 *  happened to it is written down rather than followed. At most one entry
 *  carries the mark, so there is nothing else to pick.
 */
export function closedLive(entries: SavedQueueEntry[]): SavedQueueEntry[] {
  return entries.map((e) => (e.live ? { ...e, live: undefined } : e));
}

/** Guards what comes back from the file: ours, but an older version's shape. */
export function isSavedQueueEntry(x: unknown): x is SavedQueueEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as SavedQueueEntry;
  return (
    typeof e.id === 'string' &&
    typeof e.updatedAt === 'number' &&
    Array.isArray(e.queue) &&
    e.queue.every((s: unknown) => !!s && typeof (s as Song).id === 'string')
  );
}

/**
 * The song of a queue, whatever its shape. A queue is kept as songs the account
 * named, and an id is all that says which song a row means; `idOf` is asked
 * where a song may still be the bare thing a test wrote down.
 */
function idOf(song: Song | { id: string } | undefined): string {
  return song?.id ?? '';
}
