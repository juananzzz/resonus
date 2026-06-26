/**
 * Contador de reproducciones local (modo sin conexión). Como no hay servidor
 * que registre el scrobble, llevamos la cuenta aquí para poder ofrecer una
 * sección de "Más escuchados" en la pantalla de inicio. Se persiste en disco.
 */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';

const KEY = 'resonus.localPlayCounts';

interface PlayCountsState {
  counts: Record<string, number>;
  hydrated: boolean;
  bump: (songId: string) => void;
  hydrate: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(counts: Record<string, number>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(KEY, JSON.stringify(counts));
  }, 1000);
}

export const usePlayCounts = create<PlayCountsState>((set, get) => ({
  counts: {},
  hydrated: false,
  bump: (songId) => {
    const counts = { ...get().counts, [songId]: (get().counts[songId] ?? 0) + 1 };
    set({ counts });
    scheduleSave(counts);
  },
  hydrate: async () => {
    try {
      const raw = await getItem(KEY);
      set({ counts: raw ? (JSON.parse(raw) as Record<string, number>) : {}, hydrated: true });
    } catch {
      set({ counts: {}, hydrated: true });
    }
  },
}));
