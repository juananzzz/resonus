/**
 * Elementos anclados de la Biblioteca (estilo Spotify): hasta 4, siempre
 * arriba del todo ignorando el orden elegido. Clave = 'playlist:<id>' o
 * 'album:<id>'; el valor es cuándo se fijó (los pins conservan ese orden).
 */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';

const KEY = 'resonus.pins';
export const MAX_PINS = 4;

interface PinsState {
  pins: Record<string, number>;
  /** Fija/desfija. Devuelve false si no cabe (ya hay MAX_PINS). */
  toggle: (key: string) => boolean;
  hydrate: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(pins: Record<string, number>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(KEY, JSON.stringify(pins));
  }, 1000);
}

export const usePins = create<PinsState>((set, get) => ({
  pins: {},

  toggle: (key) => {
    const pins = { ...get().pins };
    if (pins[key]) {
      delete pins[key];
    } else {
      if (Object.keys(pins).length >= MAX_PINS) return false;
      pins[key] = Date.now();
    }
    set({ pins });
    scheduleSave(pins);
    return true;
  },

  hydrate: async () => {
    try {
      const raw = await getItem(KEY);
      if (raw) set({ pins: JSON.parse(raw) as Record<string, number> });
    } catch {
      // sin datos previos
    }
  },
}));
