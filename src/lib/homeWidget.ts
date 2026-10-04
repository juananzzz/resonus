/**
 * The app outside itself, on Android (native module `HomeWidget`): the "Now
 * playing" widget and the Quick Settings tile, fed from the player's store,
 * and the shortcuts on the launcher icon.
 *
 * On a build without the module, or on iOS, all of this does nothing.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import { tg } from '@/i18n';
import { artworkUrlFor, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';

interface NowPlayingState {
  title: string;
  artist: string;
  artworkUrl?: string;
  playing: boolean;
  active: boolean;
}

const native = requireOptionalNativeModule<{
  update: (state: NowPlayingState) => void;
  setShortcuts: (items: { id: string; label: string; icon: string; url: string }[]) => boolean;
}>('HomeWidget');

/** The launcher shortcuts, as routed by `+native-intent` to `/shortcut`. */
export type ShortcutAction = 'shuffle-favorites' | 'continue' | 'search';

function nowPlaying(): NowPlayingState {
  const st = usePlayerStore.getState();
  const song = st.queue[st.index];
  if (!song) return { title: '', artist: '', playing: false, active: false };
  // A station says what is on, like the notification does.
  const live = song.url ? st.streamInfo : null;
  return {
    title: live?.title ?? song.title,
    artist: live?.artist ?? song.artist ?? '',
    artworkUrl: artworkUrlFor(song),
    playing: st.isPlaying,
    active: true,
  };
}

let last = '';

function push() {
  if (!native) return;
  const state = nowPlaying();
  const key = JSON.stringify(state);
  if (key === last) return;
  last = key;
  try {
    native.update(state);
  } catch {
    // A widget that misses one update catches the next.
  }
}

function installShortcuts() {
  if (!native) return;
  try {
    native.setShortcuts([
      {
        id: 'shuffle-favorites',
        label: tg('Shuffle favorites'),
        icon: 'shuffle',
        url: 'resonus://shortcut/shuffle-favorites',
      },
      {
        id: 'continue',
        label: tg('Continue listening'),
        icon: 'play',
        url: 'resonus://shortcut/continue',
      },
      { id: 'search', label: tg('Search'), icon: 'search', url: 'resonus://shortcut/search' },
    ]);
  } catch {
    // The launcher keeps whatever it had.
  }
}

/** Once, at startup. */
export function initHomeWidget() {
  if (!native) return;
  push();
  usePlayerStore.subscribe((st, prev) => {
    if (
      st.queue !== prev.queue ||
      st.index !== prev.index ||
      st.isPlaying !== prev.isPlaying ||
      st.streamInfo !== prev.streamInfo
    ) {
      push();
    }
  });
  installShortcuts();
  // The labels are in the app's language, not the phone's.
  let lang = useSettings.getState().language;
  useSettings.subscribe((s) => {
    if (s.language === lang) return;
    lang = s.language;
    installShortcuts();
  });
}
