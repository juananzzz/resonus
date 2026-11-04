/**
 * The app outside itself (native module `HomeWidget`): the home screen widget
 * and, on Android, the Quick Settings tile, fed from the player's store, and
 * the shortcuts on the launcher icon.
 *
 * On iOS the widget is the small "now playing" one: it shows the track the app
 * last wrote, opens the album for it, and its play button presses through an
 * intent - a toggle with the app left exactly where it was. On Android this
 * also drives the launcher shortcuts. On a build without the module, all of it
 * does nothing.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { CACHED_COVER } from '@/api/data';
import type { Song } from '@/api/subsonic';
import { dominantColorOf } from '@/hooks/useDominantColor';
import { tg } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { artworkUrlFor, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

interface NowPlayingState {
  title: string;
  artist: string;
  /** The album the widget opens on tap; empty when the track has none. */
  albumId: string;
  artworkUrl?: string;
  playing: boolean;
  active: boolean;
  /** Seconds into the track, and its length: the widget walks on from here. */
  position: number;
  duration: number;
  /** The cover's colour as the app reads it, for the widget's background. */
  accent?: string;
  /** The widget's own background when there is no cover to take one from. */
  fallback: string;
}

const native = requireOptionalNativeModule<{
  update: (state: NowPlayingState) => void;
  /** What the app can see of its own handover, for Settings › Diagnostics. */
  status?: () => string;
  setShortcuts?: (items: { id: string; label: string; icon: string; url: string }[]) => boolean;
  /**
   * The widget's play button, taken back out of the group: true once per
   * press, for as long after it as the native side allows.
   */
  takePendingPlaybackToggle?: () => boolean;
  /** The same press, announced by name when the intent ran in this process. */
  addListener?: (event: string, listener: () => void) => { remove: () => void };
}>('HomeWidget');

/** The launcher shortcuts, as routed by `+native-intent` to `/shortcut`. */
export type ShortcutAction = 'shuffle-favorites' | 'continue' | 'search' | 'playback-toggle';

/** How long a cold start gets to bring the saved queue back. */
export const RESTORE_WAIT_MS = 8000;

/** Whether `check` turned true within `ms`, polled short enough to feel it. */
export function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (check()) return resolve(true);
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        resolve(false);
      }
    }, 150);
  });
}

/**
 * The widget's play button, wherever the press came from: the queue gets its
 * usual chance to come back, the player toggles, and that is all of it - no
 * navigation, no screen, the app stays where it is, which is the entire
 * point of the button. True when there was a queue to press into.
 */
export async function runPlaybackToggle(): Promise<boolean> {
  const ready = await waitFor(() => {
    const s = useAuthStore.getState();
    return !s.hydrating && (!!s.auth || s.offline);
  }, RESTORE_WAIT_MS);
  if (!ready) return false;
  const player = usePlayerStore.getState;
  if (!(await waitFor(() => player().queue.length > 0, RESTORE_WAIT_MS))) return false;
  player().toggle();
  return true;
}

/**
 * How far the playhead can be from where the widget's own bar has got to
 * before the widget is told again. Measured against what the widget was last
 * sent, not against the store's previous beat: in the background the position
 * only lands every 5 s, and a plain jump of 4 read every one of those beats as
 * a seek and rewrote the widget all night.
 */
const SEEK_JUMP_SEC = 4;

/**
 * The widget's timeline walks the bar twenty minutes past each write; a long
 * track playing straight through gets a fresh one before that runs out.
 */
const REWRITE_MS = 15 * 60 * 1000;

/** What the widget was last told, and when: where its bar starts walking from. */
let sent: { position: number; at: number; playing: boolean } | null = null;
/** A write that threw: the next change tries again rather than waiting for a seek. */
let unsent = false;

/**
 * Whether the widget's bar has drifted off the playhead. It walks at 1× from
 * its last write whatever the speed (WidgetData.progress), so a track at 2×
 * or a stalled stream drift, and a seek lands somewhere it never walked to.
 */
function drifted(positionSec: number): boolean {
  // Android's widget and tile show no position: a seek there is nothing to redraw.
  if (!sent || Platform.OS !== 'ios') return false;
  const now = Date.now();
  const shown = sent.position + (sent.playing ? (now - sent.at) / 1000 : 0);
  if (Math.abs(positionSec - shown) >= SEEK_JUMP_SEC) return true;
  return sent.playing && now - sent.at >= REWRITE_MS;
}

/**
 * The cover's colour for the widget's background, resolved out here because
 * the handover runs from the store, outside React. The dark band, whichever
 * theme the app is in: the widget's text is always white, and the band is
 * what keeps white readable on a cover's colour. Empty while a new cover is
 * being read - the widget falls back to the page's own colour for that one
 * write, and the colour's own write follows.
 */
let accent = '';
let accentOf = '';

async function refreshAccent(uri?: string) {
  const want = uri ?? '';
  if (want === accentOf) return;
  accentOf = want;
  accent = '';
  if (!want) return;
  // A failed read comes back as the plain tint: no colour to send, and the
  // fallback the widget already holds is the better of the two.
  const c = await dominantColorOf(want, 'dark');
  if (accentOf !== want || c === colors.surfaceHighlight) return;
  accent = c;
  push();
}

function nowPlaying(): NowPlayingState {
  const st = usePlayerStore.getState();
  const song = st.queue[st.index];
  if (!song) {
    return {
      title: '',
      artist: '',
      albumId: '',
      playing: false,
      active: false,
      position: 0,
      duration: 0,
      fallback: colors.background,
    };
  }
  // A station says what is on, like the notification does.
  const live = song.url ? st.streamInfo : null;
  const artwork = artworkUrlFor(song);
  const state: NowPlayingState = {
    title: live?.title ?? song.title,
    artist: live?.artist ?? song.artist ?? '',
    albumId: song.albumId ?? '',
    playing: st.isPlaying,
    active: true,
    position: st.positionSec,
    duration: st.durationSec || song.duration || 0,
    fallback: colors.background,
  };
  // Offline, a cover the app only has in its image cache is no address at
  // all. Left out of the object rather than put in as `undefined`: the key
  // would still be there, with nothing for the native side to read.
  if (artwork && !artwork.startsWith(CACHED_COVER)) state.artworkUrl = artwork;
  // Only the colour of *this* cover: between covers, or while the read is
  // still out, the key stays away rather than carrying the last one over.
  if (state.artworkUrl && accent && accentOf === state.artworkUrl) state.accent = accent;
  return state;
}

let last = '';

/**
 * The handover, read back from the shared group: whether the group is there
 * to write into, and what was written and when. English in every language,
 * like the diagnostics screen it is shown in.
 */
export function widgetStatus(): string {
  if (!native) {
    // How many native modules the registry holds, to tell "nothing
    // registered" from "this one missing" in a bug report's screenshot.
    const loaded = Object.keys(globalThis.expo?.modules ?? {}).length;
    return `module missing · ${loaded} loaded`;
  }
  try {
    return native.status?.() ?? 'no status';
  } catch {
    return 'status failed';
  }
}

/** A radio station: what `nowPlaying` also reads its title from the stream for. */
function isStation(song: Song | undefined): boolean {
  return !!song?.url && !song.vod;
}

/** `force` for a drifted bar: the same state again still restarts its walk. */
function push(force = false) {
  if (!native) return;
  const state = nowPlaying();
  // Kicks the read for a new cover; when it lands, this runs again with the
  // colour in the state.
  refreshAccent(state.artworkUrl);
  const key = JSON.stringify(state);
  if (key === last && !force) return;
  try {
    native.update(state);
    last = key;
    sent = state.active ? { position: state.position, at: Date.now(), playing: state.playing } : null;
    unsent = false;
  } catch {
    // A widget that misses one update catches the next - and this one is
    // not marked as sent, so the next write sends it again.
    unsent = true;
  }
}

function installShortcuts() {
  // Android only: the iOS module is the widget, and has no shortcuts to set.
  if (!native?.setShortcuts) return;
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
      st.streamInfo !== prev.streamInfo ||
      // The length the player reports once it has the file: the widget's bar
      // is empty until it knows it. Not a station's: a live window grows with
      // every beat, and the widget has no bar to show for one anyway.
      (st.durationSec !== prev.durationSec && !isStation(st.queue[st.index]))
    ) {
      push();
    } else if (unsent || (st.positionSec !== prev.positionSec && drifted(st.positionSec))) {
      push(true);
    }
  });
  // The widget's play button: an intent writes the press into the group and
  // posts the notification, and this reads it back - instantly from the
  // notification when the intent ran in this process, within the second from
  // the poll when it did not (different processes; the flag is the only road
  // between them), and on this very call for a press made while the app was
  // not up to hear either. Reading clears it, so one press toggles once.
  const takeToggle = () => {
    try {
      if (native?.takePendingPlaybackToggle?.()) void runPlaybackToggle();
    } catch {
      // A build without it: there is no press to take.
    }
  };
  try {
    native.addListener?.('playbackToggle', takeToggle);
  } catch {
    // Android declares no events: there the press is a shortcut, not an
    // intent, and the module below has nothing to take either.
  }
  takeToggle();
  setInterval(takeToggle, 1000);
  installShortcuts();
  // The labels are in the app's language, not the phone's.
  let lang = useSettings.getState().language;
  useSettings.subscribe((s) => {
    if (s.language === lang) return;
    lang = s.language;
    installShortcuts();
  });
}
