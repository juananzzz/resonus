/** Ajustes de la app (persistidos). De momento: calidad de streaming. */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';

const STORAGE_KEY = 'resonus.settings';

/** 0 = calidad original (sin transcodificar); el resto es el bitrate en kbps. */
export const BITRATE_OPTIONS = [
  { label: 'Original', value: 0 },
  { label: '320 kbps', value: 320 },
  { label: '192 kbps', value: 192 },
  { label: '128 kbps', value: 128 },
] as const;

interface SettingsState {
  maxBitRate: number;
  setMaxBitRate: (value: number) => void;
  hydrate: () => Promise<void>;
}

export const useSettings = create<SettingsState>((set) => ({
  maxBitRate: 0,

  setMaxBitRate: (maxBitRate) => {
    set({ maxBitRate });
    void setItem(STORAGE_KEY, JSON.stringify({ maxBitRate }));
  },

  hydrate: async () => {
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { maxBitRate?: number };
        if (typeof parsed.maxBitRate === 'number') {
          set({ maxBitRate: parsed.maxBitRate });
        }
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
