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

export type AudioQualityMode = 'off' | 'player' | 'everywhere';

export const AUDIO_QUALITY_OPTIONS: { label: string; value: AudioQualityMode }[] = [
  { label: 'No', value: 'off' },
  { label: 'Player only', value: 'player' },
  { label: 'Everywhere', value: 'everywhere' },
];

interface SettingsState {
  maxBitRate: number;
  language: Language;
  showAudioQuality: AudioQualityMode;
  setMaxBitRate: (value: number) => void;
  setLanguage: (language: Language) => void;
  setShowAudioQuality: (mode: AudioQualityMode) => void;
  hydrate: () => Promise<void>;
}

function persist(state: { maxBitRate: number; language: Language; showAudioQuality: AudioQualityMode }) {
  void setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useSettings = create<SettingsState>((set, get) => ({
  maxBitRate: 0,
  language: 'es',
  showAudioQuality: 'off',

  setMaxBitRate: (maxBitRate) => {
    set({ maxBitRate });
    persist({ maxBitRate, language: get().language, showAudioQuality: get().showAudioQuality });
  },

  setLanguage: (language) => {
    set({ language });
    persist({ maxBitRate: get().maxBitRate, language, showAudioQuality: get().showAudioQuality });
  },

  setShowAudioQuality: (showAudioQuality) => {
    set({ showAudioQuality });
    persist({ maxBitRate: get().maxBitRate, language: get().language, showAudioQuality });
  },

  hydrate: async () => {
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          maxBitRate: number;
          language: Language;
          showAudioQuality: AudioQualityMode | boolean;
        }>;
        if (typeof parsed.maxBitRate === 'number') {
          set({ maxBitRate: parsed.maxBitRate });
        }
        if (parsed.language === 'es' || parsed.language === 'en') {
          set({ language: parsed.language });
        }
        if (parsed.showAudioQuality === 'off' || parsed.showAudioQuality === 'player' || parsed.showAudioQuality === 'everywhere') {
          set({ showAudioQuality: parsed.showAudioQuality });
        } else if (parsed.showAudioQuality === true) {
          set({ showAudioQuality: 'everywhere' });
        } else if (parsed.showAudioQuality === false) {
          set({ showAudioQuality: 'off' });
        }
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
