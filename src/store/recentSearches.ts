/** Búsquedas recientes (persistidas por perfil) para la pantalla de Buscar. */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';
import { useAuthStore } from './auth';

const MAX = 12;

export type RecentKind = 'artist' | 'album' | 'song';

/** Un resultado que el usuario tocó: se guarda con su carátula para mostrarlo. */
export interface RecentItem {
  kind: RecentKind;
  id: string;
  title: string;
  /** Artista (para álbumes/canciones); ausente en artistas. */
  artist?: string;
  /** Id de carátula para `coverArtUrl`. */
  coverArt?: string;
  /** Destino de navegación al tocarlo. */
  href: string;
}

function itemKey(i: RecentItem): string {
  return `${i.kind}:${i.id}`;
}

// SecureStore solo admite claves con [A-Za-z0-9._-]; saneamos serverUrl/username
// (la URL trae ':' y '/') para no pasar una clave inválida.
function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

function storageKey(): string {
  const { auth, offline } = useAuthStore.getState();
  if (offline) return 'resonus.recentSearches.offline';
  if (auth) return `resonus.recentSearches.server.${safe(auth.serverUrl)}.${safe(auth.username)}`;
  return 'resonus.recentSearches';
}

interface RecentSearchesState {
  items: RecentItem[];
  add: (item: RecentItem) => void;
  remove: (item: RecentItem) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

let currentKey = '';

function persist(items: RecentItem[]) {
  const key = storageKey();
  if (key) void setItem(key, JSON.stringify(items));
}

function isRecentItem(x: unknown): x is RecentItem {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as RecentItem).kind === 'string' &&
    typeof (x as RecentItem).id === 'string' &&
    typeof (x as RecentItem).title === 'string' &&
    typeof (x as RecentItem).href === 'string'
  );
}

export const useRecentSearches = create<RecentSearchesState>((set, get) => ({
  items: [],

  add: (item) => {
    const rest = get().items.filter((x) => itemKey(x) !== itemKey(item));
    const items = [item, ...rest].slice(0, MAX);
    set({ items });
    persist(items);
  },

  remove: (item) => {
    const items = get().items.filter((x) => itemKey(x) !== itemKey(item));
    set({ items });
    persist(items);
  },

  clear: () => {
    set({ items: [] });
    persist([]);
  },

  hydrate: async () => {
    try {
      // Limpiar elementos de una clave anterior distinta (otro perfil)
      const key = storageKey();
      if (currentKey && currentKey !== key) {
        set({ items: [] });
      }
      currentKey = key;
      const raw = await getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Descarta el formato antiguo (lista de strings).
        if (Array.isArray(parsed)) set({ items: parsed.filter(isRecentItem) });
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
