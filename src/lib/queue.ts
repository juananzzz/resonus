/**
 * Queue rules as pure functions, so `test/queue.test.ts` can check them. The
 * "queued" block is what Play next added: `queuedCount` songs right after the
 * current one.
 */
import type { Song, SubsonicAuth } from '@/api/subsonic';

import { primaryUrl } from '@/lib/serverUrls';

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  queue: Song[];
  index: number;
  queuedCount: number;
}

/** A song added by hand: loses the mix mark, gets the queued one. */
export function handAdded(song: Song): Song {
  const { fromMix: _fromMix, ...rest } = song;
  return { ...rest, queued: true };
}

/** Without either mark, for when the blocks they name are gone. */
export function unmarked(song: Song): Song {
  if (!song.fromMix && !song.queued) return song;
  const { fromMix: _fromMix, queued: _queued, ...rest } = song;
  return rest;
}

/** Fisher-Yates on a copy. */
export function dealt<T>(list: T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Add to queue: at the very end (#184). */
export function appendEnd(queue: Song[], songs: Song[]): Song[] {
  return queue.concat(songs.map(handAdded));
}

/** Play next: right after the current song, growing the block (#184). Not
 *  `splice(...songs)`: thousands of arguments in one call. */
export function insertNext(st: QueueState, songs: Song[]): QueueState {
  const at = st.index + 1;
  return {
    queue: st.queue.slice(0, at).concat(songs.map(handAdded), st.queue.slice(at)),
    index: st.index,
    queuedCount: st.queuedCount + songs.length,
  };
}

export interface Removal {
  state: QueueState;
  /** The caller has to load the song now at `state.index`. */
  wasCurrent: boolean;
  inQueuedBlock: boolean;
}

/** Null if `at` is out of range. An empty result means reset the player. */
export function removeFrom(st: QueueState, at: number): Removal | null {
  const { queue, index, queuedCount } = st;
  if (at < 0 || at >= queue.length) return null;
  const next = queue.filter((_, i) => i !== at);
  if (at === index) {
    // The next one plays, which consumes one of the block.
    return {
      state: { queue: next, index: Math.min(index, next.length - 1), queuedCount: Math.max(0, queuedCount - 1) },
      wasCurrent: true,
      inQueuedBlock: false,
    };
  }
  const inQueuedBlock = at > index && at <= index + queuedCount;
  return {
    state: { queue: next, index: at < index ? index - 1 : index, queuedCount: inQueuedBlock ? queuedCount - 1 : queuedCount },
    wasCurrent: false,
    inQueuedBlock,
  };
}

/** Undo for a `removeFrom` that was not the current song. */
export function restoreRemoved(st: QueueState, at: number, song: Song, inQueuedBlock: boolean): QueueState {
  const queue = [...st.queue];
  queue.splice(at, 0, song);
  return {
    queue,
    index: st.index >= at ? st.index + 1 : st.index,
    queuedCount: inQueuedBlock ? st.queuedCount + 1 : st.queuedCount,
  };
}

/**
 * Null for a move that is not one. Within what is coming, dragging into the
 * block joins it and out of it leaves it; touching the current song or what
 * played dissolves it.
 */
export function moveIn(st: QueueState, from: number, to: number): QueueState | null {
  const { queue, index, queuedCount } = st;
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return null;
  const next = [...queue];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  let newIndex = index;
  if (from === index) newIndex = to;
  else if (from < index && to >= index) newIndex = index - 1;
  else if (from > index && to <= index) newIndex = index + 1;
  let newQueuedCount = 0;
  if (from > index && to > index) {
    const fromQueued = from - (index + 1) < queuedCount;
    const toQueued = to - (index + 1) < queuedCount;
    newQueuedCount = Math.max(0, queuedCount + (!fromQueued && toQueued ? 1 : 0) - (fromQueued && !toQueued ? 1 : 0));
  }
  return { queue: next, index: newIndex, queuedCount: newQueuedCount };
}

/**
 * Move a song from `at` to the END of the "queued" block (the last slot that
 * will play before the source picks up again). This is "Prioritize": not
 * "play next" (which inserts at the front of the block), but "insert after all
 * currently prioritized songs". A second Prioritize therefore stacks below the
 * first rather than leapfrogging it.
 *
 * Returns null for the current song, previous songs, out-of-range positions,
 * or a song already at the end of the block (nothing to do).
 */
export function prioritizeInQueue(st: QueueState, at: number): QueueState | null {
  const { queue, index, queuedCount } = st;
  if (at <= index || at >= queue.length) return null;
  const wasInBlock = at <= index + queuedCount;
  if (wasInBlock && at === index + queuedCount) return null; // already last in block
  const markedSong = handAdded(queue[at]);
  const newQueue = queue.filter((_, i) => i !== at);
  if (wasInBlock) {
    // Song moves from somewhere inside the block to its end. Removing it
    // shrinks the block by 1, so the insertion point shifts down by 1 too.
    const insertAt = index + queuedCount - 1 + 1; // = index + queuedCount (adjusted)
    newQueue.splice(insertAt, 0, markedSong);
    return { queue: newQueue, index, queuedCount };
  }
  // Song is in the source section; insert after the last queued song.
  // Removing `at` (which is > index + queuedCount) does not shift the target.
  newQueue.splice(index + queuedCount + 1, 0, markedSong);
  return { queue: newQueue, index, queuedCount: queuedCount + 1 };
}

/** Advancing by one consumes one of the block; any other jump dissolves it. */
export function queuedAfterMove(st: Pick<QueueState, 'index' | 'queuedCount'>, next: number): number {
  if (next === st.index || st.queuedCount === 0) return st.queuedCount;
  return next === st.index + 1 ? st.queuedCount - 1 : 0;
}

/** Null at the end. Repeat all wraps to the current one too, so a lone
 *  playable song repeats. */
export function nextPlayable(
  queue: Song[],
  index: number,
  repeat: RepeatMode,
  ok: (i: number) => boolean = () => true,
): number | null {
  for (let i = index + 1; i < queue.length; i++) if (ok(i)) return i;
  if (repeat === 'all') for (let i = 0; i <= index; i++) if (ok(i)) return i;
  return null;
}

/** The current song goes first, or with `keepHead` (UPnP, whose indices must
 *  not move) only what is coming is dealt. */
export function shuffleOn(
  queue: Song[],
  index: number,
  keepHead: boolean,
  deal: (l: Song[]) => Song[] = dealt,
): { queue: Song[]; index: number } {
  const current = queue[index];
  if (keepHead && current) {
    return { queue: [...queue.slice(0, index + 1), ...deal(queue.slice(index + 1))].map(unmarked), index };
  }
  const rest = deal(queue.filter((_, i) => i !== index));
  return { queue: (current ? [current, ...rest] : rest).map(unmarked), index: 0 };
}

export function indexInOriginal(original: Song[], current: Song): number {
  return Math.max(0, original.findIndex((s) => s.id === current.id));
}

/** SecureStore only accepts keys with [A-Za-z0-9._-]; the URL has `:` and `/`. */
function safeKey(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Which SecureStore bucket a profile's queue lives in, or null when no profile
 * is in use and there is nothing to save.
 *
 * The account first, and the mode not at all: the songs an account plays are
 * its songs whether or not a connection was there when it played them, and
 * they play the same either way. Asking about the mode first filed every
 * account's offline listening under one shared key, so the next write moved
 * the queue under whichever profile the account had been, and switching
 * profiles restored another account's queue. Song ids are only unique within
 * the account that issued them (see the note in `player.ts` where a profile
 * change throws the old queue's failures away), so what came back was at best
 * another account's order and at worst songs this one cannot play. Only a
 * local profile, which has no account, keeps the offline key, and it is the
 * one it always had.
 */
export function queueKeyFor(auth: SubsonicAuth | null, offline: boolean): string | null {
  if (auth) return `resonus.queue.server.${safeKey(primaryUrl(auth))}.${safeKey(auth.username)}`;
  return offline ? 'resonus.queue.offline' : null;
}
