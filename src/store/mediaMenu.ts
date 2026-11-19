/** Context menu state for a card long-pressed: album, playlist, saved queue. */
import type Icon from '@/components/Icon';
import { create } from 'zustand';

import { type Album, type Playlist } from '@/api/subsonic';
import { type SavedQueueEntry } from '@/lib/savedQueues';

/** An entry a screen adds to the album sheet, above the stock ones. */
export type MediaMenuExtraAction = {
  icon: keyof typeof Icon.glyphMap;
  label: string;
  onPress: () => void | Promise<void>;
};

/**
 * What the sheet is opened for. A queue is the one thing here that brings its
 * own songs: it carries them already, so none of the sheet's fetches apply.
 */
export type MediaMenuItem =
  | { kind: 'album'; album: Album; extraActions?: MediaMenuExtraAction[] }
  | { kind: 'playlist'; playlist: Playlist }
  | { kind: 'queue'; entry: SavedQueueEntry };

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
