/**
 * The queues that were listened to, kept on the device.
 *
 * The list of them lives here; the rules over it — the cap, which entry is the
 * queue on screen right now, what one queue holds — are in `@/lib/savedQueues`
 * and checked by `test/savedQueues.test.ts`.
 *
 * Kept per profile: a queue is a list of song ids, and an id only means
 * something on the account that issued it, so another profile's queues would
 * come back as songs it cannot play. One file per profile rather than a
 * SecureStore bucket, because ten queues of up to five hundred songs are far
 * more than the encrypted store wants to hand over at once, and a queue is not
 * secret. What a profile leaves on the device is listed in `@/lib/profileData`,
 * and the file goes with the profile from there.
 */
import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';

import { hashKey } from '@/lib/localLibrary';
import { profileScopeId, useAuthStore } from './auth';
import {
  adopt,
  closedLive,
  entry as makeEntry,
  evict,
  fileName,
  insert,
  isSavedQueueEntry,
  order as queueOrder,
  sameQueue,
  signature,
  type SavedQueueEntry,
  type StoredQueue,
} from '@/lib/savedQueues';

/** How often the queue that is playing is written while only its position moves. */
const WRITE_MS = 20_000;

/** The file of the profile in use, or null when there is no profile to keep one for. */
function filePath(): string | null {
  const { auth, offline } = useAuthStore.getState();
  // No session at all: nothing was played and nothing can be played, so there
  // is no queue of anyone to keep.
  if (!auth && !offline) return null;
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}${fileName(hashKey(profileScopeId()))}` : null;
}

/** A queue's own id: a row's key, and what names the entry being played. */
let seq = 0;
function nextId(): string {
  return `${Date.now().toString(36)}.${(seq++).toString(36)}`;
}

/**
 * An entry out of the player's or the resume's hands. `live` is the mark that
 * says this entry is the queue on screen, rather than one that ended.
 */
function asEntry(payload: StoredQueue, id: string, manual = false, live = false): SavedQueueEntry {
  return {
    ...makeEntry(id, payload, manual),
    ...(live ? { live: true } : {}),
  };
}

/**
 * What the file and the memory hold the last time they were looked at, so the
 *  update can ask what moved since. The queue that is playing is written while
 *  it plays, and there only the current song gets further into itself: a queue
 *  is up to five hundred songs, and rewriting the file for every tick is the
 *  work that shows up as a dropped tap — the same reason the single queue save
 *  has its own gate. `live` says the same for what the store was told last:
 *  between one look and the next often nothing moved at all, and rewriting the
 *  state again asks every screen that looks at it to redraw.
 */
interface WriteMemory {
  /** Order of the queue that was written last. */
  order: string;
  /** Everything but its position. */
  shape: string;
  /** When that write happened. */
  at: number;
  /** The live entry as the store last saw it. */
  seen: string;
}

/** A fresh one: what was remembered belongs to the queue that was in use. */
const nothingWritten: WriteMemory = { order: '', shape: '', at: 0, seen: '' };
let written: WriteMemory = nothingWritten;

/**
 * A queue that was forgotten while it was still on screen. `Delete queue`
 *  says of this listening, not of the second it happens to be at: as long as
 *  the very same queue plays on, no card is put back under it. Session-only —
 *  the moment anything else takes the player over, this is history.
 */
let forgotten: StoredQueue | null = null;

/** Whether the entry is worth a write now, and remembers that it was one. */
function earnsAWrite(entry: SavedQueueEntry, at: number): boolean {
  const moved = queueOrder(entry) !== written.order || signature(entry) !== written.shape;
  if (moved) {
    written = { order: queueOrder(entry), shape: signature(entry), at, seen: written.seen };
    return true;
  }
  if (at - written.at < WRITE_MS) return false;
  written = { ...written, at };
  return true;
}

/** Whether the live entry looks different than the store last saw it. */
function sawLive(stamp: string): boolean {
  if (stamp === written.seen) return false;
  written = { ...written, seen: stamp };
  return true;
}

/** Where the file of the profile that was last read lives, to notice a change. */
let readPath = '';

/** Writes the file, from whatever the store holds now. Not awaited by callers. */
function persist() {
  const path = filePath();
  if (!path) return;
  // Not before the file was read: the boot restores the queue on screen while
  //  this archive is still reading its file, and what the restore put up would
  //  otherwise overwrite a list nobody looked at — a quarter of the shelf
  //  written over the whole of it. Nor into the file of a profile that was
  //  switched to without this one being read; that file gets its own read.
  const { entries, liveId, hydrated } = useSavedQueues.getState();
  if (!hydrated || path !== readPath) return;
  void FileSystem.writeAsStringAsync(path, JSON.stringify({ liveId, entries })).catch(() => {
    if (__DEV__) console.warn('[savedQueues] could not save');
  });
}

interface SavedQueuesState {
  entries: SavedQueueEntry[];
  /**
   * False until the file was read. Nothing is written before then (see
   * `persist`): the boot restores the queue on screen while this archive is
   * still reading its file, and the list the restore has would otherwise be
   * all the file ever had.
   */
  hydrated: boolean;
  /**
   * Which entry is the queue on screen, read off the mark on it (see `sealed`).
   *  Written out for the file, and what the queue screen asks for to know that
   *  there is something to forget.
   */
  liveId: string | null;
  /**
   * A queue the player took over: what was live before becomes a finished
   * entry, and this one is the live one from now on.
   */
  startNew: (payload: StoredQueue) => void;
  /**
   * A queue that came back from disk at the opening. It is one of the entries
   * on file, so it is adopted rather than put up as a second copy.
   */
  adoptLive: (payload: StoredQueue) => void;
  /** The queue on screen moved: its entry follows it. */
  updateLive: (payload: StoredQueue) => void;
  /** A queue that was kept is being played: it becomes the live entry. */
  markLive: (id: string) => void;
  /**
   * Saved from the queue screen by hand, which keeps it out of the cap's way.
   */
  saveManually: (payload: StoredQueue) => void;
  /** Forgets one queue. Returns what puts it back, for the «Undo» toast. */
  remove: (id: string) => (() => void) | undefined;
  hydrate: () => Promise<void>;
}

export const useSavedQueues = create<SavedQueuesState>((set, get) => {
  /**
   * Which entry says it is the queue on screen: the mark on it is the one thing
   *  that says it. The id below is read off the same mark, which is how the two
   *  cannot come to disagree — the mark is what the rules and an Undo look for,
   *  the id is only wanted by the file and by the queue screen.
   */
  const onScreen = (entries: SavedQueueEntry[]) => entries.find((e) => e.live === true);

  /** The state out of a list: the kept one, and the live id read off its mark. */
  const sealed = (entries: SavedQueueEntry[]) => {
    const kept = evict(entries);
    return { entries: kept, liveId: onScreen(kept)?.id ?? null };
  };

  /** A new list, kept in the shape the rules ask for, and written down. */
  const keep = (entries: SavedQueueEntry[]) => {
    set(sealed(entries));
    persist();
  };

  /**
   * Puts back what `remove` swept away, for the tap of an Undo. The removal
   *  went to disk straight away, so this goes to disk as well: leaving the list
   *  only in memory would lose the queue again for anyone who closes the app
   *  before the next write. A queue that took over in the meantime is still the
   *  one on screen, so it stays beside what comes back rather than being
   *  replaced by an older copy of itself.
   */
  const undoTo = (before: SavedQueueEntry[]) => () => {
    // Back on the shelf, so the queue that was hidden away is wanted again.
    forgotten = null;
    const playing = onScreen(get().entries);
    if (!playing || before.some((e) => e.id === playing.id)) {
      keep(before);
      return;
    }
    keep([playing, ...before]);
  };

  return {
    entries: [],
    hydrated: false,
    liveId: null,

    startNew: (payload) => {
      // A queue of its own takes the player over: nothing is being hidden any
      //  more, and this one earns its entry.
      forgotten = null;
      const fresh = asEntry(payload, nextId(), false, true);
      keep(insert(closedLive(get().entries), fresh));
    },

    adoptLive: (payload) => {
      // The queue is being put on the shelf on its own, so the mark that kept
      //  an identical one away is over.
      forgotten = null;
      const out = adopt(get().entries, get().liveId, payload, nextId());
      keep(out.entries);
    },

    updateLive: (payload) => {
      // The queue that was forgotten while it played is the one on screen: the
      //  listening stays gone, and no card slides back under it while it goes
      //  on. A queue that changed shape since is a listening of its own again.
      if (forgotten && sameQueue(forgotten, payload)) return;
      const live = onScreen(get().entries);
      // Nothing is live: this is the first queue of the session.
      if (!live) {
        get().startNew(payload);
        return;
      }
      const at = Date.now();
      const updated = { ...live, ...payload, id: live.id, updatedAt: at, live: true };
      // The entry asked about is the live one, so its id is in the stamp: a
      //  queue that took the player over is a different entry and earns its
      //  first write whatever the old one had already said.
      const moved = `${live.id}|${queueOrder(updated)}|${signature(updated)}|${Math.round(updated.positionSec)}`;
      if (!sawLive(moved)) return;
      const rest = get().entries.filter((e) => e.id !== live.id);
      if (!earnsAWrite(updated, at)) {
        // Only the current song's position moved and the file was written not
        // long ago. The entry in memory follows the queue all the same, so what
        // Home draws is already right and the file catches up later.
        set(sealed(insert(rest, updated)));
        return;
      }
      keep(insert(rest, updated));
    },

    markLive: (id) => {
      // Chosen from the shelf by hand: whatever was hidden away is not what is
      //  being heard now.
      forgotten = null;
      const closed = closedLive(get().entries);
      const target = closed.find((e) => e.id === id);
      if (!target) return;
      keep(insert(closed.filter((e) => e.id !== id), { ...target, live: true }));
    },

    /**
     * Saved by hand. The queue that is on screen is marked rather than copied:
     * two cards for the same listening, one of them already keeping itself up
     * to date, reads as a queue that was saved twice.
     */
    saveManually: (payload) => {
      // Kept by hand: a queue of the same songs the player refused to keep is
      //  wanted again on purpose.
      forgotten = null;
      const live = onScreen(get().entries);
      if (live && sameQueue(live, payload)) {
        const marked = { ...live, manual: true, updatedAt: Date.now() };
        keep(insert(get().entries.filter((e) => e.id !== live.id), marked));
        return;
      }
      keep(insert(get().entries, asEntry(payload, nextId(), true)));
    },

    remove: (id) => {
      const before = get().entries;
      const removed = before.find((e) => e.id === id);
      if (!removed) return undefined;
      // Of the queue on screen this is a forgetting that lasts: the songs carry
      //  on playing, and the archive must not write a card back under them at
      //  the next second they moved (see `updateLive`).
      const playing = onScreen(before);
      if (playing && playing.id === id) forgotten = removed;
      keep(before.filter((e) => e.id !== id));
      return undoTo(before);
    },

    hydrate: async () => {
      try {
        const path = filePath();
        if (!path) {
          set({ hydrated: true });
          return;
        }
        // Another profile took over: what is in memory belongs to the other one.
        if (readPath && readPath !== path) {
          set({ entries: [], liveId: null });
          // What was remembered about the last write belongs to the account
          //  whose file that was: whether the queue of a new one moved has to
          //  be asked again, or its first card would be told Home about and
          //  never reach this profile's file.
          written = nothingWritten;
          forgotten = null;
        }
        readPath = path;
        const raw = await FileSystem.readAsStringAsync(path);
        // What this session already put up, oldest first: the boot restores the
        //  queue on screen while this file is still reading, and what the
        //  restore wrote down is the archive at a later moment than the file's
        //  copy. Adopted oldest first, so the newest ends up at the shelf's
        //  front, where the rules keep it.
        const remembered = [...get().entries].reverse();
        if (!raw) {
          set({ hydrated: true });
          // The file never had any of it: it goes down now, or a queue that
          //  does not move again is on the shelf only as long as this session
          //  lasts.
          if (remembered.length > 0) persist();
          return;
        }
        const parsed = JSON.parse(raw) as unknown;
        // An array is the shape an older version would have saved; the object
        // says which of these entries is the queue that is on screen — which of
        //  them the mark says, so the id beside it is only what an older file
        //  had to say and is not trusted.
        const boxed = Array.isArray(parsed) ? null : parsed as { entries?: unknown[]; liveId?: unknown };
        const list: unknown[] = boxed ? boxed.entries ?? [] : (parsed as unknown[]) ?? [];
        const entries = list.filter(isSavedQueueEntry);
        // The file's list and what is in memory are the same archive seen at
        //  two moments. What is in memory is adopted over the file by the rules
        //  an opening uses: an entry that is already on file keeps its id and
        //  whichever copy got further into the song, one the file never had
        //  comes in beside the others, and the queue that is on screen keeps
        //  its mark rather than be dropped — taking the file alone would show
        //  nothing on Home for the queue that is playing.
        const merged = remembered.reduce(
          (seen, m) => adopt(seen.entries, seen.liveId, m, m.id, m.live === true),
          sealed(entries),
        );
        set({ ...sealed(merged.entries), hydrated: true });
        if (remembered.length > 0) persist();
      } catch {
        // A read that failed says nothing about what was kept, and answering
        // "there is nothing" here would let the next write overwrite the queues
        // that are on the shelf. The entries stay as far as they came.
        set({ hydrated: true });
      }
    },
  };
});
