/** Estado del menú contextual de canción (la hoja inferior con acciones). */
import { create } from 'zustand';

import { type Song } from '@/api/subsonic';

interface SongMenuState {
  song: Song | null;
  open: (song: Song) => void;
  close: () => void;
}

export const useSongMenu = create<SongMenuState>((set) => ({
  song: null,
  open: (song) => set({ song }),
  close: () => set({ song: null }),
}));
