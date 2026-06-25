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

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  queue: Song[];
  index: number;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  /** Volumen de 0 a 1. */
  volume: number;
  /** Si está activo, la cola se reproduce en orden aleatorio. */
  shuffle: boolean;
  /** Modo de repetición: ninguno, toda la cola o la canción actual. */
  repeat: RepeatMode;
  /** Orden original guardado mientras shuffle está activo. */
  originalQueue: Song[] | null;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  /** Reproduce una lista de canciones empezando en `startIndex`. */
  playQueue: (songs: Song[], startIndex?: number) => Promise<void>;
  /** Añade una canción al final de la cola (o la reproduce si está vacía). */
  addToQueue: (song: Song) => void;
  /** Inserta una canción justo después de la actual. */
  playNext: (song: Song) => void;
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
  if (status.didJustFinish) {
    const state = usePlayerStore.getState();
    if (state.repeat === 'one') {
      // Repetir la misma canción.
      player?.seekTo(0);
      player?.play();
    } else {
      state.next();
    }
  }
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
  shuffle: false,
  repeat: 'off',
  originalQueue: null,

  playQueue: async (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    // Una cola nueva siempre arranca en orden; el shuffle se desactiva.
    set({
      queue: songs,
      index: startIndex,
      positionSec: 0,
      durationSec: 0,
      shuffle: false,
      originalQueue: null,
    });
    await loadCurrent();
  },

  addToQueue: (song) => {
    const { queue } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    set({ queue: [...queue, song] });
  },

  playNext: (song) => {
    const { queue, index } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    const next = [...queue];
    next.splice(index + 1, 0, song);
    set({ queue: next });
  },

  toggle: () => {
    if (!player) return;
    if (get().isPlaying) player.pause();
    else player.play();
  },

  next: () => {
    const { index, queue, repeat } = get();
    if (queue.length === 0) return;
    let nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      if (repeat === 'all') nextIndex = 0;
      else return; // fin de la cola sin repetición
    }
    set({ index: nextIndex, positionSec: 0 });
    void loadCurrent();
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

  toggleShuffle: () => {
    const { shuffle, queue, index, originalQueue } = get();
    const current = queue[index];

    if (!shuffle) {
      // Activar: guardamos el orden original y barajamos el resto, dejando
      // la canción actual la primera para no cortar la reproducción.
      const rest = queue.filter((_, i) => i !== index);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      set({
        shuffle: true,
        originalQueue: queue,
        queue: current ? [current, ...rest] : rest,
        index: 0,
      });
    } else {
      // Desactivar: restauramos el orden original, manteniendo la actual.
      if (originalQueue && current) {
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
      } else {
        set({ shuffle: false, originalQueue: null });
      }
    }
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const current = order.indexOf(get().repeat);
    set({ repeat: order[(current + 1) % order.length] });
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
