/**
 * Estado y control de reproducción sobre react-native-track-player (RNTP).
 *
 * RNTP gestiona la cola, la reproducción en segundo plano y los controles de
 * la notificación / pantalla de bloqueo. Este store mantiene una copia de la
 * cola (modelo Song) y sincroniza estado (posición, duración, play/pausa,
 * índice activo) desde los eventos de RNTP hacia Zustand, conservando la misma
 * API que usaban los componentes.
 */
import TrackPlayer, {
  Capability,
  Event,
  RepeatMode as RNTPRepeatMode,
  State,
  type Track,
} from 'react-native-track-player';
import { create } from 'zustand';

import { coverArtUrl, scrobble, streamUrl, type Song } from '@/api/subsonic';
import { useAuthStore } from './auth';
import { usePlayCounts } from './playCounts';
import { useSettings } from './settings';
import { useToast } from './toast';
import { tg } from '@/i18n';

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Centinela para orígenes que deben traducirse al vuelo (no son nombres
 * reales de álbum/lista). La cabecera del reproductor los resuelve con i18n.
 */
export const SOURCE_FAVORITES = '@@favorites';

let setupPromise: Promise<void> | null = null;
let listenersAdded = false;
let sleepTimeout: ReturnType<typeof setTimeout> | null = null;

/** Carátula embebida (data URI) de una canción local, si la tiene. */
export function localArtwork(song: Song): string | undefined {
  if (!song.coverBase64) return undefined;
  return `data:${song.coverMime ?? 'image/jpeg'};base64,${song.coverBase64}`;
}

/** Convierte una canción al formato de pista de RNTP. */
function toTrack(song: Song): Track {
  // URL directa (radio, streams externos): se usa tal cual, sin procesar.
  if (song.url) {
    return {
      id: song.id,
      url: song.url,
      title: song.title,
      artist: song.artist ?? 'Desconocido',
      album: song.album,
      duration: song.duration,
    };
  }
  // Modo sin conexión: el fichero es local. La carátula sale de la imagen
  // embebida (ID3) si existe, no de un servidor.
  if (song.localUri) {
    return {
      id: song.id,
      url: song.localUri,
      title: song.title,
      artist: song.artist ?? 'Desconocido',
      album: song.album,
      artwork: localArtwork(song),
      duration: song.duration,
    };
  }
  const auth = useAuthStore.getState().auth!;
  return {
    id: song.id,
    url: streamUrl(auth, song.id, useSettings.getState().maxBitRate),
    title: song.title,
    artist: song.artist ?? 'Desconocido',
    album: song.album,
    artwork: coverArtUrl(auth, song.coverArt ?? song.albumId, 500),
    duration: song.duration,
  };
}

function addListeners() {
  if (listenersAdded) return;
  listenersAdded = true;

  TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
    usePlayerStore.setState({ isPlaying: e.state === State.Playing });
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e) => {
    usePlayerStore.setState({
      positionSec: e.position,
      durationSec: e.duration,
    });
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => {
    if (e.index != null) {
      usePlayerStore.setState({ index: e.index, positionSec: 0 });
      const { queue } = usePlayerStore.getState();
      const auth = useAuthStore.getState().auth;
      const song = queue[e.index];
      if (song && auth) scrobble(auth, song.id);
      // Sin conexión: llevamos la cuenta localmente (para "Más escuchados").
      else if (song && useAuthStore.getState().offline) usePlayCounts.getState().bump(song.id);
    }
    if (e.track?.duration) {
      usePlayerStore.setState({ durationSec: e.track.duration });
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackError, () => {
    useToast.getState().show(tg('No se pudo reproducir la canción'));
  });
}

/** Inicializa RNTP una sola vez. */
function ensureSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      try {
        await TrackPlayer.setupPlayer();
      } catch {
        // Ya estaba inicializado.
      }
      await TrackPlayer.updateOptions({
        progressUpdateEventInterval: 1,
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
        ],
      });
      addListeners();
    })();
  }
  return setupPromise;
}

/** Reconstruye la cola de RNTP (usado al activar/desactivar shuffle). */
async function rebuildQueue(songs: Song[], startIndex: number) {
  await ensureSetup();
  await TrackPlayer.reset();
  await TrackPlayer.add(songs.map(toTrack));
  if (startIndex > 0) await TrackPlayer.skip(startIndex);
  await TrackPlayer.play();
}

interface PlayerState {
  queue: Song[];
  index: number;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  originalQueue: Song[] | null;
  sleepTimerMinutes: number | null;
  /** De dónde salió la cola actual (álbum, lista, artista…), si se conoce. */
  source: string | null;
  /** Ruta del origen para poder navegar a él desde el reproductor. */
  sourceHref: string | null;
  playQueue: (
    songs: Song[],
    startIndex?: number,
    source?: string,
    sourceHref?: string,
  ) => Promise<void>;
  addToQueue: (song: Song) => void;
  playNext: (song: Song) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  jumpTo: (index: number) => void;
  removeAt: (index: number) => void;
  moveTrack: (from: number, to: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
  reset: () => Promise<void>;
}

/** Canción que está sonando ahora mismo, o null si la cola está vacía. */
export function currentSong(state: PlayerState): Song | null {
  return state.queue[state.index] ?? null;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  volume: 1,
  shuffle: false,
  repeat: 'off',
  originalQueue: null,
  sleepTimerMinutes: null,
  source: null,
  sourceHref: null,

  playQueue: async (songs, startIndex = 0, source, sourceHref) => {
    if (songs.length === 0) return;
    set({
      queue: songs,
      index: startIndex,
      positionSec: 0,
      durationSec: 0,
      shuffle: false,
      originalQueue: null,
      source: source ?? null,
      sourceHref: sourceHref ?? null,
    });
    try {
      await rebuildQueue(songs, startIndex);
    } catch {
      useToast.getState().show(tg('No se pudo reproducir'));
    }
  },

  addToQueue: (song) => {
    const { queue } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    set({ queue: [...queue, song] });
    ensureSetup().then(() => TrackPlayer.add(toTrack(song))).catch(() => {});
  },

  playNext: (song) => {
    const { queue, index } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    const insertAt = index + 1;
    const next = [...queue];
    next.splice(insertAt, 0, song);
    set({ queue: next });
    ensureSetup()
      .then(() => TrackPlayer.add(toTrack(song), insertAt))
      .catch(() => {});
  },

  toggle: () => {
    if (get().isPlaying) TrackPlayer.pause();
    else TrackPlayer.play();
  },

  next: () => {
    TrackPlayer.skipToNext().catch(() => {});
  },

  previous: () => {
    if (get().positionSec > 3) {
      TrackPlayer.seekTo(0);
      return;
    }
    TrackPlayer.skipToPrevious().catch(() => {});
  },

  seekTo: (sec) => {
    TrackPlayer.seekTo(sec);
    set({ positionSec: sec });
  },

  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    TrackPlayer.setVolume(volume);
    set({ volume });
  },

  jumpTo: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    TrackPlayer.skip(index)
      .then(() => TrackPlayer.play())
      .catch(() => {});
  },

  removeAt: async (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    const next = queue.filter((_, i) => i !== index);
    set({ queue: next });
    try {
      await TrackPlayer.remove([index]);
      if (next.length === 0) {
        await TrackPlayer.reset();
        set({ index: 0, isPlaying: false, positionSec: 0, durationSec: 0 });
      }
    } catch {
      // ignore
    }
  },

  moveTrack: async (from, to) => {
    const { queue } = get();
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= queue.length ||
      to >= queue.length
    ) {
      return;
    }
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set({ queue: next });
    try {
      await TrackPlayer.move(from, to);
    } catch {
      // ignore
    }
  },

  toggleShuffle: () => {
    const { shuffle, queue, index, originalQueue } = get();
    const current = queue[index];

    if (!shuffle) {
      const rest = queue.filter((_, i) => i !== index);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const newQueue = current ? [current, ...rest] : rest;
      set({ shuffle: true, originalQueue: queue, queue: newQueue, index: 0 });
      void rebuildQueue(newQueue, 0);
    } else if (originalQueue && current) {
      const newIndex = Math.max(
        0,
        originalQueue.findIndex((s) => s.id === current.id),
      );
      set({
        shuffle: false,
        queue: originalQueue,
        index: newIndex,
        originalQueue: null,
      });
      void rebuildQueue(originalQueue, newIndex);
    } else {
      set({ shuffle: false, originalQueue: null });
    }
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat });
    TrackPlayer.setRepeatMode(
      repeat === 'one'
        ? RNTPRepeatMode.Track
        : repeat === 'all'
          ? RNTPRepeatMode.Queue
          : RNTPRepeatMode.Off,
    );
  },

  setSleepTimer: (minutes) => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = setTimeout(() => {
      TrackPlayer.pause();
      sleepTimeout = null;
    set({ sleepTimerMinutes: null });
    }, minutes * 60_000);
    set({ sleepTimerMinutes: minutes });
  },

  cancelSleepTimer: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    set({ isPlaying: false, sleepTimerMinutes: null });
  },

  reset: async () => {
    get().cancelSleepTimer();
    try {
      await TrackPlayer.reset();
    } catch {
      // ignore
    }
    set({
      queue: [],
      index: 0,
      isPlaying: false,
      positionSec: 0,
      durationSec: 0,
      shuffle: false,
      originalQueue: null,
      source: null,
      sourceHref: null,
    });
  },
}));
