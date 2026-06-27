/** Búsquedas recientes (persistidas por perfil) para la pantalla de Buscar. */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';
import { useAuthStore } from './auth';

const MAX = 10;

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
  terms: string[];
  add: (term: string) => void;
  remove: (term: string) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

let currentKey = '';

function persist(terms: string[]) {
  const key = storageKey();
  if (key) void setItem(key, JSON.stringify(terms));
}

export const useRecentSearches = create<RecentSearchesState>((set, get) => ({
  terms: [],

  add: (term) => {
    const t = term.trim();
    if (t.length < 2) return;
    const rest = get().terms.filter((x) => x.toLowerCase() !== t.toLowerCase());
    const terms = [t, ...rest].slice(0, MAX);
    set({ terms });
    persist(terms);
  },

  remove: (term) => {
    const terms = get().terms.filter((x) => x !== term);
    set({ terms });
    persist(terms);
  },

  clear: () => {
    set({ terms: [] });
    persist([]);
  },

  hydrate: async () => {
    try {
      // Limpiar términos de una clave anterior distinta
      const key = storageKey();
      if (currentKey && currentKey !== key) {
        set({ terms: [] });
      }
      currentKey = key;
      const raw = await getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) set({ terms: parsed.filter((x) => typeof x === 'string') });
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
