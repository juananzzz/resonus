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
  /** Mostrar la mini carátula del álbum en las listas (playlists/favoritos). */
  showListArtwork: boolean;
  setMaxBitRate: (value: number) => void;
  setLanguage: (language: Language) => void;
  setShowAudioQuality: (mode: AudioQualityMode) => void;
  setShowListArtwork: (value: boolean) => void;
  hydrate: () => Promise<void>;
}

function persist(state: {
  maxBitRate: number;
  language: Language;
  showAudioQuality: AudioQualityMode;
  showListArtwork: boolean;
}) {
  void setItem(STORAGE_KEY, JSON.stringify(state));
}

function snapshot(get: () => SettingsState) {
  const s = get();
  return {
    maxBitRate: s.maxBitRate,
    language: s.language,
    showAudioQuality: s.showAudioQuality,
    showListArtwork: s.showListArtwork,
  };
}

export const useSettings = create<SettingsState>((set, get) => ({
  maxBitRate: 0,
  language: 'es',
  showAudioQuality: 'off',
  showListArtwork: true,

  setMaxBitRate: (maxBitRate) => {
    set({ maxBitRate });
    persist(snapshot(get));
  },

  setLanguage: (language) => {
    set({ language });
    persist(snapshot(get));
  },

  setShowAudioQuality: (showAudioQuality) => {
    set({ showAudioQuality });
    persist(snapshot(get));
  },

  setShowListArtwork: (showListArtwork) => {
    set({ showListArtwork });
    persist(snapshot(get));
  },

  hydrate: async () => {
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          maxBitRate: number;
          language: Language;
          showAudioQuality: AudioQualityMode | boolean;
          showListArtwork: boolean;
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
        if (typeof parsed.showListArtwork === 'boolean') {
          set({ showListArtwork: parsed.showListArtwork });
        }
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
