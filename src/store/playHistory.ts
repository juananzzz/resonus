/**
 * Historial de reproducción: lista de canciones escuchadas, la más reciente
 * primero y sin duplicados (si vuelves a poner una, sube arriba). Funciona en
 * los dos modos (servidor y local) y se persiste en disco. Alimenta la pantalla
 * de Actividad / Historial.
 */
import { create } from 'zustand';

import { type Song } from '@/api/subsonic';
import { getItem, setItem } from '@/lib/storage';

const KEY = 'resonus.playHistory';
const MAX = 100;

export interface HistoryEntry {
  song: Song;
  /** Momento de la última reproducción (ms). */
  playedAt: number;
}

interface PlayHistoryState {
  entries: HistoryEntry[];
  hydrated: boolean;
  record: (song: Song) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(entries: HistoryEntry[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(KEY, JSON.stringify(entries));
  }, 1000);
}

export const usePlayHistory = create<PlayHistoryState>((set, get) => ({
  entries: [],
  hydrated: false,

  record: (song) => {
    if (!song?.id) return;
    const rest = get().entries.filter((e) => e.song.id !== song.id);
    const entries = [{ song, playedAt: Date.now() }, ...rest].slice(0, MAX);
    set({ entries });
    scheduleSave(entries);
  },

  clear: () => {
    set({ entries: [] });
    scheduleSave([]);
  },

  hydrate: async () => {
    try {
      const raw = await getItem(KEY);
      set({ entries: raw ? (JSON.parse(raw) as HistoryEntry[]) : [], hydrated: true });
    } catch {
      set({ entries: [], hydrated: true });
    }
  },
}));
