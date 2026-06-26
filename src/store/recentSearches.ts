/** Búsquedas recientes (persistidas) para la pantalla de Buscar. */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';

const STORAGE_KEY = 'resonus.recentSearches';
const MAX = 10;

interface RecentSearchesState {
  terms: string[];
  add: (term: string) => void;
  remove: (term: string) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

function persist(terms: string[]) {
  void setItem(STORAGE_KEY, JSON.stringify(terms));
}

export const useRecentSearches = create<RecentSearchesState>((set, get) => ({
  terms: [],

  add: (term) => {
    const t = term.trim();
    if (t.length < 2) return;
    // Sin duplicados (sin distinguir mayúsculas), lo más reciente primero.
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
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) set({ terms: parsed.filter((x) => typeof x === 'string') });
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
