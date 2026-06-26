/** Estado del menú contextual de canción (la hoja inferior con acciones). */
import { create } from 'zustand';

import { type Song } from '@/api/subsonic';

/** Contexto opcional: si la canción se abre desde una playlist editable. */
export interface SongMenuContext {
  playlistId: string;
  /** Posición de la canción dentro de la playlist (para quitarla). */
  index: number;
}

interface SongMenuState {
  song: Song | null;
  context: SongMenuContext | null;
  open: (song: Song, context?: SongMenuContext) => void;
  close: () => void;
}

export const useSongMenu = create<SongMenuState>((set) => ({
  song: null,
  context: null,
  open: (song, context) => set({ song, context: context ?? null }),
  close: () => set({ song: null, context: null }),
}));
