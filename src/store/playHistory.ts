/**
 * Historial de reproducción: lista de canciones escuchadas, la más reciente
 * primero y sin duplicados (si vuelves a poner una, sube arriba). Se persiste
 * por perfil (cada servidor y el modo local tienen su propio historial) para
 * no mezclar canciones que el otro perfil no puede reproducir. Alimenta la
 * pantalla de Actividad / Historial.
 */
import { create } from 'zustand';

import { type Song } from '@/api/subsonic';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import { useAuthStore } from './auth';

/** Clave del historial antiguo, compartido entre perfiles (se migra). */
const LEGACY_KEY = 'resonus.playHistory';
const MAX = 100;

// SecureStore solo admite claves con [A-Za-z0-9._-]; saneamos serverUrl/username
// (la URL trae ':' y '/') para no pasar una clave inválida.
function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

function storageKey(): string {
  const { auth, offline } = useAuthStore.getState();
  if (offline) return 'resonus.playHistory.offline';
  if (auth) return `resonus.playHistory.server.${safe(auth.serverUrl)}.${safe(auth.username)}`;
  return LEGACY_KEY;
}

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

let currentKey = '';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(key: string, entries: HistoryEntry[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(key, JSON.stringify(entries));
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
    scheduleSave(storageKey(), entries);
  },

  clear: () => {
    set({ entries: [] });
    scheduleSave(storageKey(), []);
  },

  hydrate: async () => {
    try {
      // Limpiar el historial en memoria si venimos de otro perfil.
      const key = storageKey();
      if (currentKey && currentKey !== key) set({ entries: [] });
      currentKey = key;
      let raw = await getItem(key);
      // Migración: el historial antiguo era global; lo hereda el perfil activo
      // en el primer arranque y la clave compartida se elimina.
      if (!raw && key !== LEGACY_KEY) {
        raw = await getItem(LEGACY_KEY);
        if (raw) {
          await setItem(key, raw);
          await deleteItem(LEGACY_KEY);
        }
      }
      set({ entries: raw ? (JSON.parse(raw) as HistoryEntry[]) : [], hydrated: true });
    } catch {
      set({ entries: [], hydrated: true });
    }
  },
}));
