/**
 * Selector global de playlist para "Añadir a una playlist". Cualquier sitio
 * (menú de álbum/artista, cola…) abre la hoja con un puñado de canciones sin
 * tener que renderizar su propia instancia. La hoja (`PlaylistPickerSheet`) se
 * monta una vez en el layout raíz y lee de aquí.
 */
import { create } from 'zustand';

import { type Song } from '@/api/subsonic';

interface PlaylistPickerState {
  /** Canciones a añadir; null = hoja cerrada. */
  songs: Song[] | null;
  open: (songs: Song[]) => void;
  close: () => void;
}

export const usePlaylistPicker = create<PlaylistPickerState>((set) => ({
  songs: null,
  open: (songs) => set({ songs }),
  close: () => set({ songs: null }),
}));
