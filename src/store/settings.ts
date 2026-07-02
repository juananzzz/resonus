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

/** Nombre de cada idioma en su propio idioma (para los selectores). */
export const LANGUAGE_NAMES: Record<Language, string> = { es: 'Español', en: 'English' };

export type AudioQualityMode = 'off' | 'player' | 'everywhere';

export const AUDIO_QUALITY_OPTIONS: { label: string; value: AudioQualityMode }[] = [
  { label: 'No', value: 'off' },
  { label: 'Player only', value: 'player' },
  { label: 'Everywhere', value: 'everywhere' },
];

interface SettingsState {
  maxBitRate: number;
  /** Calidad de descarga: 0 = fichero original; resto, bitrate transcodificado. */
  downloadBitRate: number;
  language: Language;
  showAudioQuality: AudioQualityMode;
  /** Mostrar la mini carátula del álbum en las listas (playlists/favoritos). */
  showListArtwork: boolean;
  /** Foto circular del artista junto a su nombre en la pantalla de álbum. */
  showArtistPhoto: boolean;
  /** Visibilidad de botones opcionales, para quien prefiera una UI mínima. */
  showHistoryButton: boolean;
  showProfileButton: boolean;
  showCastButton: boolean;
  showOutputButton: boolean;
  setMaxBitRate: (value: number) => void;
  setDownloadBitRate: (value: number) => void;
  setLanguage: (language: Language) => void;
  setShowAudioQuality: (mode: AudioQualityMode) => void;
  setShowListArtwork: (value: boolean) => void;
  setShowArtistPhoto: (value: boolean) => void;
  setShowHistoryButton: (value: boolean) => void;
  setShowProfileButton: (value: boolean) => void;
  setShowCastButton: (value: boolean) => void;
  setShowOutputButton: (value: boolean) => void;
  hydrate: () => Promise<void>;
}

function persist(state: ReturnType<typeof snapshot>) {
  void setItem(STORAGE_KEY, JSON.stringify(state));
}

function snapshot(get: () => SettingsState) {
  const s = get();
  return {
    maxBitRate: s.maxBitRate,
    downloadBitRate: s.downloadBitRate,
    language: s.language,
    showAudioQuality: s.showAudioQuality,
    showListArtwork: s.showListArtwork,
    showArtistPhoto: s.showArtistPhoto,
    showHistoryButton: s.showHistoryButton,
    showProfileButton: s.showProfileButton,
    showCastButton: s.showCastButton,
    showOutputButton: s.showOutputButton,
  };
}

export const useSettings = create<SettingsState>((set, get) => ({
  maxBitRate: 0,
  downloadBitRate: 0,
  language: 'en',
  showAudioQuality: 'off',
  showListArtwork: true,
  showArtistPhoto: true,
  showHistoryButton: true,
  showProfileButton: true,
  showCastButton: true,
  showOutputButton: true,

  setMaxBitRate: (maxBitRate) => {
    set({ maxBitRate });
    persist(snapshot(get));
  },

  setDownloadBitRate: (downloadBitRate) => {
    set({ downloadBitRate });
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

  setShowArtistPhoto: (showArtistPhoto) => {
    set({ showArtistPhoto });
    persist(snapshot(get));
  },

  setShowHistoryButton: (showHistoryButton) => {
    set({ showHistoryButton });
    persist(snapshot(get));
  },

  setShowProfileButton: (showProfileButton) => {
    set({ showProfileButton });
    persist(snapshot(get));
  },

  setShowCastButton: (showCastButton) => {
    set({ showCastButton });
    persist(snapshot(get));
  },

  setShowOutputButton: (showOutputButton) => {
    set({ showOutputButton });
    persist(snapshot(get));
  },

  hydrate: async () => {
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          maxBitRate: number;
          downloadBitRate: number;
          language: Language;
          showAudioQuality: AudioQualityMode | boolean;
          showListArtwork: boolean;
          showArtistPhoto: boolean;
          showHistoryButton: boolean;
          showProfileButton: boolean;
          showCastButton: boolean;
          showOutputButton: boolean;
        }>;
        if (typeof parsed.maxBitRate === 'number') {
          set({ maxBitRate: parsed.maxBitRate });
        }
        if (typeof parsed.downloadBitRate === 'number') {
          set({ downloadBitRate: parsed.downloadBitRate });
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
        if (typeof parsed.showArtistPhoto === 'boolean') {
          set({ showArtistPhoto: parsed.showArtistPhoto });
        }
        if (typeof parsed.showHistoryButton === 'boolean') {
          set({ showHistoryButton: parsed.showHistoryButton });
        }
        if (typeof parsed.showProfileButton === 'boolean') {
          set({ showProfileButton: parsed.showProfileButton });
        }
        if (typeof parsed.showCastButton === 'boolean') {
          set({ showCastButton: parsed.showCastButton });
        }
        if (typeof parsed.showOutputButton === 'boolean') {
          set({ showOutputButton: parsed.showOutputButton });
        }
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
