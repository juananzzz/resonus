/** Estado del menú contextual de álbum/playlist (long-press en tarjetas). */
import { create } from 'zustand';

import { type Album, type Playlist } from '@/api/subsonic';

export type MediaMenuItem =
  | { kind: 'album'; album: Album }
  | { kind: 'playlist'; playlist: Playlist };

interface MediaMenuState {
  item: MediaMenuItem | null;
  open: (item: MediaMenuItem) => void;
  close: () => void;
}

export const useMediaMenu = create<MediaMenuState>((set) => ({
  item: null,
  open: (item) => set({ item }),
  close: () => set({ item: null }),
}));
