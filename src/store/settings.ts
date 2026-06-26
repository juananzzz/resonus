/** Ajustes de la app (persistidos): calidad de streaming e idioma. */
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

export type Language = 'es' | 'en';

interface SettingsState {
  maxBitRate: number;
  language: Language;
  setMaxBitRate: (value: number) => void;
  setLanguage: (language: Language) => void;
  hydrate: () => Promise<void>;
}

function persist(state: { maxBitRate: number; language: Language }) {
  void setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useSettings = create<SettingsState>((set, get) => ({
  maxBitRate: 0,
  language: 'es',

  setMaxBitRate: (maxBitRate) => {
    set({ maxBitRate });
    persist({ maxBitRate, language: get().language });
  },

  setLanguage: (language) => {
    set({ language });
    persist({ maxBitRate: get().maxBitRate, language });
  },

  hydrate: async () => {
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          maxBitRate: number;
          language: Language;
        }>;
        if (typeof parsed.maxBitRate === 'number') {
          set({ maxBitRate: parsed.maxBitRate });
        }
        if (parsed.language === 'es' || parsed.language === 'en') {
          set({ language: parsed.language });
        }
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
