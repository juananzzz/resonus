/**
 * Offline action queue (outbox) per server profile.
 *
 * With a server account in offline mode, mutations (favorite, rate, edit
 * playlists…) don't reach the server: they are recorded here, reflected
 * immediately on the library mirror, and flushed to the server when going back
 * online (see auth.goOnline). The local profile (no account) doesn't use this
 * queue.
 *
 * It also carries what isn't a change to the library but still belongs to the
 * server: the songs listened to while there was no way to reach it.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import type { Song, StarType, SubsonicAuth } from '@/api/subsonic';
import { hashKey } from '@/lib/localLibrary';
import type { Remap } from '@/lib/navidromeRemap';
import { remapOutbox } from '@/lib/navidromeRemap';
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore } from './auth';

const DIR = FileSystem.documentDirectory + 'offline-queue/';

/** Desired state of a favorite (last-write-wins by id). */
interface FavOp {
  type: StarType;
  starred: boolean;
}

/**
 * Desired state of a playlist after offline edits. Instead of a log of
 * add/remove/reorder, we store the final result (Subsonic rewrites the entire
 * playlist with `reorderPlaylist`, avoiding the mess of indices on sync). The
 * key can be a server id or a temporary id `tmp_…` (playlist created offline,
 * which gets its real id on sync).
 */
interface QueuePlaylist {
  /** Playlist created offline (key is a temporary id). */
  created?: boolean;
  /** Marked for deletion. */
  deleted?: boolean;
  name?: string;
  comment?: string;
  public?: boolean;
  /** Desired final tracklist (song ids); undefined = no change. */
  songIds?: string[];
}

/**
 * A listen that happened offline. Not last-write-wins like the rest of the
 * outbox: playing the same song twice is two listens, and each carries the
 * moment it happened so the server's history keeps its shape on upload.
 */
interface PlayOp {
  id: string;
  /** ms since epoch. */
  at: number;
}

interface QueueData {
  /** id → desired favorite state. */
  favs?: Record<string, FavOp>;
  /** Song id → desired rating (1-5; 0 = unrated). */
  ratings?: Record<string, number>;
  /** Playlist id (server or `tmp_…`) → desired state after editing it offline. */
  playlists?: Record<string, QueuePlaylist>;
  /** Metadata for songs added offline, to show them in playlists. */
  songMeta?: Record<string, Song>;
  /** Listens to scrobble on reconnect, oldest first. */
  plays?: PlayOp[];
}

export type { PlayOp, QueuePlaylist };

/**
 * Ceiling on queued listens. A day and a half of music without a network is
 * already generous, and the alternative is a file that grows for as long as
 * the trip lasts. Past it the oldest ones go: they are the ones the server's
 * history misses the least.
 */
const PLAYS_MAX = 500;

/** The outbox file of an account; `loadedFile` equal to it means memory is its queue. */
export function outboxFileFor(auth: SubsonicAuth): string {
  return `${DIR}${hashKey(`${primaryUrl(auth)}|${auth.username}`)}.json`;
}

function activeFile(): string | null {
  const auth = useAuthStore.getState().auth;
  return auth ? outboxFileFor(auth) : null;
}

interface QueueState {
  data: QueueData;
  loadedFile: string | null;
  load: () => Promise<void>;
  /** Records the desired state of a favorite (offline). */
  setFav: (id: string, type: StarType, starred: boolean) => void;
  /** Clears the favorites queue (after flushing to server). */
  clearFavs: () => void;
  /** Records the desired rating for a song (offline). */
  setRating: (id: string, rating: number) => void;
  /** Clears the ratings queue (after flushing to server). */
  clearRatings: () => void;
  /** Merges changes into the desired state of a playlist. */
  setPlaylist: (id: string, patch: Partial<QueuePlaylist>) => void;
  /** Removes a playlist's queue entry (created-and-deleted, or after sync). */
  removePlaylistEntry: (id: string) => void;
  /** Stores song metadata to display them when editing playlists offline. */
  rememberSongs: (songs: Song[]) => void;
  /** Clears playlist edits (after flushing to server). */
  clearPlaylists: () => void;
  /** Rewrites every queued id, after the server migrated its own (#5824). */
  remapIds: (f: Remap) => void;
  /** Records a listen that happened offline. */
  addPlay: (id: string, at: number) => void;
  /** Drops the listens already uploaded, leaving the rest (and any that
   *  arrived while uploading) in the queue. */
  removePlays: (done: PlayOp[]) => void;
  /** Is there anything pending to sync? */
  isEmpty: () => boolean;
}

let loadingFile: string | null = null;
let loadPromise: Promise<void> | null = null;
let writeLock: Promise<unknown> = Promise.resolve();

/**
 * What was read off disk, plus anything that happened while it was being read.
 *
 * Reading the file used to replace whatever was in memory, which is right for
 * an empty queue and wrong for a queue somebody had already added to: a listen
 * recorded in those first seconds was overwritten by the file that did not know
 * about it yet. Newer wins for the keyed ones, since memory holds the later
 * intention; listens are a list, so both are kept, oldest first, and a repeat
 * of the very same second is dropped.
 */
function mergePending(fromDisk: QueueData, pending: QueueData): QueueData {
  const seen = new Set<string>();
  const plays = [...(fromDisk.plays ?? []), ...(pending.plays ?? [])]
    .sort((a, b) => a.at - b.at)
    .filter((p) => {
      const key = `${p.at}|${p.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-PLAYS_MAX);
  return {
    favs: { ...fromDisk.favs, ...pending.favs },
    ratings: { ...fromDisk.ratings, ...pending.ratings },
    playlists: { ...fromDisk.playlists, ...pending.playlists },
    songMeta: { ...fromDisk.songMeta, ...pending.songMeta },
    plays,
  };
}

export const useOfflineQueue = create<QueueState>((set, get) => {
  function persist() {
    // `activeFile()` and not only what has been loaded: a listen can cross its
    // threshold before the queue has been read off disk — the file is read a
    // few seconds after launch, and a queue restored mid-song can pass the
    // halfway mark straight away — and this used to answer that by writing
    // nothing at all, silently (#126).
    const file = get().loadedFile ?? activeFile();
    if (!file) return;
    let data = get().data;
    writeLock = writeLock.then(async () => {
      // Not read yet: writing now would replace what the file holds with only
      // what this session added. `load` merges the two.
      if (get().loadedFile === null) {
        await get().load();
        if (get().loadedFile !== file) return;
        data = get().data;
      }
      try {
        await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
        await FileSystem.writeAsStringAsync(file, JSON.stringify(data));
      } catch {
        // If it can't be persisted, this session's queue is lost on exit.
      }
    });
  }

  return {
    data: {},
    loadedFile: null,

    load: async () => {
      const file = activeFile();
      if (!file) {
        if (get().loadedFile !== null) set({ data: {}, loadedFile: null });
        return;
      }
      if (get().loadedFile === file) return;
      if (loadPromise && loadingFile === file) return loadPromise;
      loadingFile = file;
      loadPromise = (async () => {
        let data: QueueData = {};
        try {
          const info = await FileSystem.getInfoAsync(file);
          if (info.exists) data = JSON.parse(await FileSystem.readAsStringAsync(file)) as QueueData;
        } catch {
          // Corrupt or missing file: empty queue.
        }
        // Memory holds another profile's queue once one was loaded (it is
        // already in that file); only before the first load is it this one's.
        const pending = get().loadedFile === null ? get().data : {};
        set({ data: mergePending(data, pending), loadedFile: file });
      })().finally(() => {
        loadPromise = null;
        loadingFile = null;
      });
      return loadPromise;
    },

    setFav: (id, type, starred) => {
      set({ data: { ...get().data, favs: { ...get().data.favs, [id]: { type, starred } } } });
      persist();
    },

    clearFavs: () => {
      const { favs, ...rest } = get().data;
      void favs;
      set({ data: rest });
      persist();
    },

    setRating: (id, rating) => {
      set({ data: { ...get().data, ratings: { ...get().data.ratings, [id]: rating } } });
      persist();
    },

    clearRatings: () => {
      const { ratings, ...rest } = get().data;
      void ratings;
      set({ data: rest });
      persist();
    },

    setPlaylist: (id, patch) => {
      const cur = get().data.playlists?.[id] ?? {};
      set({ data: { ...get().data, playlists: { ...get().data.playlists, [id]: { ...cur, ...patch } } } });
      persist();
    },

    removePlaylistEntry: (id) => {
      const playlists = { ...get().data.playlists };
      delete playlists[id];
      set({ data: { ...get().data, playlists } });
      persist();
    },

    rememberSongs: (songs) => {
      const songMeta = { ...get().data.songMeta };
      for (const s of songs) songMeta[s.id] = s;
      set({ data: { ...get().data, songMeta } });
      persist();
    },

    clearPlaylists: () => {
      const { playlists, songMeta, ...rest } = get().data;
      void playlists;
      void songMeta;
      set({ data: rest });
      persist();
    },

    addPlay: (id, at) => {
      const plays = [...(get().data.plays ?? []), { id, at }];
      set({ data: { ...get().data, plays: plays.slice(-PLAYS_MAX) } });
      persist();
    },

    // By value and not by clearing the list: the music doesn't stop while the
    // queue is being uploaded, so a listen can be recorded mid-flush and
    // clearing would swallow it.
    removePlays: (done) => {
      const sent = new Set(done.map((p) => `${p.at}|${p.id}`));
      const plays = (get().data.plays ?? []).filter((p) => !sent.has(`${p.at}|${p.id}`));
      set({ data: { ...get().data, plays } });
      persist();
    },

    /**
     * Rewrites every id after the server has renamed them all.
     *
     * Done in memory and persisted, rather than over the file: a listen can be
     * recorded before the file has been read (#126), so the file is not always
     * the whole of what is queued.
     *
     * This is the one part of a repair whose absence loses data instead of
     * breaking a screen. A favourite or a listen sent against an id the server
     * has forgotten is not an error anybody sees: the request is accepted,
     * nothing matches, and nothing is said.
     */
    remapIds: (f) => {
      const before = get().data;
      const after = remapOutbox(before, f);
      set({ data: after });
      persist();
    },

    isEmpty: () => {
      const d = get().data;
      return (
        (!d.favs || Object.keys(d.favs).length === 0) &&
        (!d.ratings || Object.keys(d.ratings).length === 0) &&
        (!d.playlists || Object.keys(d.playlists).length === 0) &&
        (!d.plays || d.plays.length === 0)
      );
    },
  };
});
