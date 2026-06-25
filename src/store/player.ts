/**
 * Estado y control de reproducción. Mantiene una cola de canciones y maneja un
 * único AudioPlayer de expo-audio de forma imperativa, sincronizando su estado
 * (posición, duración, play/pausa) hacia este store de Zustand.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { create } from 'zustand';

import { scrobble, streamUrl, type Song } from '@/api/subsonic';
import { useAuthStore } from './auth';

let player: AudioPlayer | null = null;
let configured = false;

interface PlayerState {
  queue: Song[];
  index: number;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  /** Volumen de 0 a 1. */
  volume: number;
  /** Reproduce una lista de canciones empezando en `startIndex`. */
  playQueue: (songs: Song[], startIndex?: number) => Promise<void>;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  /** Salta a una posición concreta de la cola. */
  jumpTo: (index: number) => void;
  /** Elimina una canción de la cola por su índice. */
  removeAt: (index: number) => void;
  /** Reordena la cola moviendo una canción de `from` a `to`. */
  moveTrack: (from: number, to: number) => void;
}

/** Canción que está sonando ahora mismo, o null si la cola está vacía. */
export function currentSong(state: PlayerState): Song | null {
  return state.queue[state.index] ?? null;
}

async function ensurePlayer(): Promise<AudioPlayer> {
  if (!configured) {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });
    configured = true;
  }
  if (!player) {
    player = createAudioPlayer();
    player.addListener('playbackStatusUpdate', onStatus);
  }
  return player;
}

function onStatus(status: AudioStatus) {
  usePlayerStore.setState({
    isPlaying: status.playing,
    positionSec: status.currentTime ?? 0,
    durationSec: status.duration ?? 0,
  });
  if (status.didJustFinish) usePlayerStore.getState().next();
}

/** Carga la canción del índice actual en el reproductor y la arranca. */
async function loadCurrent() {
  const { auth } = useAuthStore.getState();
  const state = usePlayerStore.getState();
  const song = currentSong(state);
  if (!auth || !song) return;

  const p = await ensurePlayer();
  p.replace({ uri: streamUrl(auth, song.id) });
  p.volume = usePlayerStore.getState().volume;
  p.play();
  scrobble(auth, song.id);
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  volume: 1,

  playQueue: async (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    set({ queue: songs, index: startIndex, positionSec: 0, durationSec: 0 });
    await loadCurrent();
  },

  toggle: () => {
    if (!player) return;
    if (get().isPlaying) player.pause();
    else player.play();
  },

  next: () => {
    const { index, queue } = get();
    if (index < queue.length - 1) {
      set({ index: index + 1, positionSec: 0 });
      void loadCurrent();
    }
  },

  previous: () => {
    // Si llevamos más de 3 s, reiniciamos la canción en vez de retroceder.
    const { index, positionSec } = get();
    if (positionSec > 3 || index === 0) {
      player?.seekTo(0);
      return;
    }
    set({ index: index - 1, positionSec: 0 });
    void loadCurrent();
  },

  seekTo: (sec) => {
    player?.seekTo(sec);
    set({ positionSec: sec });
  },

  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    if (player) player.volume = volume;
    set({ volume });
  },

  jumpTo: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set({ index, positionSec: 0 });
    void loadCurrent();
  },

  removeAt: (index) => {
    const { queue, index: current } = get();
    if (index < 0 || index >= queue.length) return;
    const next = queue.filter((_, i) => i !== index);

    if (next.length === 0) {
      player?.pause();
      set({ queue: [], index: 0, isPlaying: false, positionSec: 0, durationSec: 0 });
      return;
    }
    if (index < current) {
      // Se elimina algo anterior: la actual baja un puesto, sigue sonando.
      set({ queue: next, index: current - 1 });
    } else if (index === current) {
      // Se elimina la actual: pasa a sonar la que ocupa ahora ese índice.
      const newIndex = Math.min(current, next.length - 1);
      set({ queue: next, index: newIndex, positionSec: 0 });
      void loadCurrent();
    } else {
      set({ queue: next });
    }
  },

  moveTrack: (from, to) => {
    const { queue, index: current } = get();
    if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) {
      return;
    }
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    // Recalculamos qué índice ocupa ahora la canción que está sonando.
    let index = current;
    if (from === current) index = to;
    else if (from < current && to >= current) index = current - 1;
    else if (from > current && to <= current) index = current + 1;

    set({ queue: next, index });
  },
}));
