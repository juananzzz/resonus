/**
 * The listen log behind the monthly/yearly recap (#119).
 *
 * The play history keeps one entry per song (the last time it played), which
 * cannot answer "how many times" or "how long". This is the other record: one
 * entry per listen that COUNTED, with the song's metadata and the time it
 * counted, so a recap can add a month or a year up.
 *
 * What counts is the same rule as everywhere else: the scrobbling threshold
 * (see `maybeScrobbleThreshold` in the player). A skip does not inflate the
 * recap, and the numbers agree with the play counts.
 *
 * PER PROFILE, like the history and the counters: a song id only means
 * something to the account that issued it. It is bounded — the oldest listens
 * fall off — because the whole log is written again on every save.
 */
import { create } from 'zustand';

import type { Song } from '@/api/subsonic';
import { hashKey } from '@/lib/localLibrary';
import { profileScopeGuard } from '@/lib/profileScope';
import type { RecapListen } from '@/lib/recap';
import { getItem, setItem } from '@/lib/storage';
import { profileScopeId } from '@/store/auth';

const KEY = 'resonus.listenLog';
/**
 * How many listens are kept. A year of monthly recaps needs the whole year;
 * at an hour of music a day this is more than a year, and past this the log
 * would only make the save bigger, not the screen more accurate.
 */
const MAX = 6000;

/** Where this profile's log lives. */
function storageKey(): string {
  return `${KEY}.${hashKey(profileScopeId())}`;
}

interface ListenLogState {
  /** Oldest first; the recap does not depend on order. */
  listens: RecapListen[];
  hydrated: boolean;
  record: (song: Song, seconds: number, playedAt?: number) => void;
  hydrate: () => Promise<void>;
}

const scope = profileScopeGuard();

/** The song's main genre, if there is one. */
function mainGenre(song: Song): string | undefined {
  return song.genre ?? song.genres?.[0]?.name;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(listens: RecapListen[]) {
  // Resolved now, not when the timer fires: a profile switch inside the
  // debounced second would otherwise write these listens under the new
  // profile's key. And if what is in memory is not this key's, nothing is
  // written (see `profileScopeGuard`).
  const key = storageKey();
  if (!scope.owns(key)) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(key, JSON.stringify(listens));
  }, 1000);
}

export const useListenLog = create<ListenLogState>((set, get) => ({
  listens: [],
  hydrated: false,

  record: (song, seconds, playedAt = Date.now()) => {
    if (!song?.id) return;
    const entry: RecapListen = {
      songId: song.id,
      title: song.title,
      artist: song.artist,
      artistId: song.artistId,
      album: song.album,
      albumId: song.albumId,
      genre: mainGenre(song),
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
      playedAt,
    };
    // Bounded from the old end: a recap asks about the recent past, and a
    // month that fell off the log is already a month nobody can reach.
    const listens = [...get().listens, entry].slice(-MAX);
    set({ listens });
    scheduleSave(listens);
  },

  hydrate: async () => {
    const key = storageKey();
    const token = scope.start();
    try {
      const raw = await getItem(key);
      const listens = raw ? (JSON.parse(raw) as RecapListen[]) : [];
      // Overtaken by a newer hydration: that one owns the log now.
      if (!scope.accept(token, key)) return;
      set({ listens: Array.isArray(listens) ? listens.slice(-MAX) : [], hydrated: true });
    } catch {
      if (scope.accept(token, key)) set({ listens: [], hydrated: true });
    }
  },
}));
