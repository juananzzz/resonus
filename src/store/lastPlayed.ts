/**
 * Última vez que se reprodujo cada origen (álbum/playlist/artista), clave =
 * su `sourceHref` ('/album/x', '/playlist/y'…). Alimenta el orden "Recientes"
 * de la Biblioteca, estilo Spotify: lo último que escuchaste, arriba.
 */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';

const KEY = 'resonus.lastPlayed';
const MAX = 300;

interface LastPlayedState {
  /** sourceHref → timestamp (ms) de la última reproducción. */
  times: Record<string, number>;
  touch: (href: string) => void;
  hydrate: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(times: Record<string, number>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(KEY, JSON.stringify(times));
  }, 1000);
}

export const useLastPlayed = create<LastPlayedState>((set, get) => ({
  times: {},

  touch: (href) => {
    let entries = Object.entries({ ...get().times, [href]: Date.now() });
    // Acotado: si crece de más, fuera los más antiguos.
    if (entries.length > MAX) {
      entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX);
    }
    const times = Object.fromEntries(entries);
    set({ times });
    scheduleSave(times);
  },

  hydrate: async () => {
    try {
      const raw = await getItem(KEY);
      if (raw) set({ times: JSON.parse(raw) as Record<string, number> });
    } catch {
      // sin datos previos
    }
  },
}));
