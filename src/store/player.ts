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
  /** Reproduce una lista de canciones empezando en `startIndex`. */
  playQueue: (songs: Song[], startIndex?: number) => Promise<void>;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (sec: number) => void;
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
  p.play();
  scrobble(auth, song.id);
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,

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
}));
