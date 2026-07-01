/**
 * Estado y control de reproducción sobre **expo-audio**.
 *
 * La cola vive en JS (este store). Un único `AudioPlayer` de expo-audio
 * decodifica; al cambiar de pista se hace `replace()` de la fuente. La
 * notificación / pantalla de bloqueo la da el propio expo-audio vía
 * `setActiveForLockScreen`. El avance automático de pista se detecta con el
 * evento `playbackStatusUpdate` (`didJustFinish`).
 *
 * (Se migró desde react-native-track-player para poder tener UNA sola
 * MediaSession y así soportar Android Auto con el módulo `modules/car-auto`.)
 */
import { AppState } from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { create } from 'zustand';

import { coverArtUrl, getPlayQueue, savePlayQueue, scrobble, streamUrl, type Song } from '@/api/subsonic';
import { useAuthStore } from './auth';
import { usePlayCounts } from './playCounts';
import { usePlayHistory } from './playHistory';
import { useSettings } from './settings';
import { useToast } from './toast';
import { tg } from '@/i18n';

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Centinela para orígenes que deben traducirse al vuelo (no son nombres
 * reales de álbum/lista). La cabecera del reproductor los resuelve con i18n.
 */
export const SOURCE_FAVORITES = '@@favorites';
export const SOURCE_HISTORY = '@@history';

let sleepTimeout: ReturnType<typeof setTimeout> | null = null;

// ── Motor de audio (expo-audio) ─────────────────────────────────────────────
let audioPlayer: AudioPlayer | null = null;
let audioModeReady = false;
let lockActive = false;

/** Crea (una vez) el AudioPlayer y engancha el listener de estado. */
function ensurePlayer(): AudioPlayer {
  if (!audioPlayer) {
    audioPlayer = createAudioPlayer(null, { updateInterval: 500 });
    // Los listeners viven durante toda la sesión (el player es un singleton).
    audioPlayer.addListener('playbackStatusUpdate', onStatus);
    // Saltar pista desde la notificación / bloqueo → la cola la gestiona JS.
    audioPlayer.addListener('remotePrevious', () => usePlayerStore.getState().previous());
    audioPlayer.addListener('remoteNext', () => usePlayerStore.getState().next());
  }
  return audioPlayer;
}

/** Configura el modo de audio (foco exclusivo) una sola vez. */
async function ensureAudioMode() {
  if (audioModeReady) return;
  audioModeReady = true;
  try {
    // `shouldPlayInBackground` mantiene el audio al minimizar la app; sin él,
    // expo-audio pausa al ir a segundo plano. `doNotMix` da foco exclusivo
    // (necesario para que los controles de bloqueo se asocien a nuestro player).
    await setAudioModeAsync({ interruptionMode: 'doNotMix', shouldPlayInBackground: true });
    await setIsAudioActiveAsync(true);
  } catch {
    // ignore
  }
}

/** Fuente para expo-audio: radio (url), local (file/content) o stream Subsonic. */
function sourceFor(song: Song): { uri: string } {
  if (song.url) return { uri: song.url };
  if (song.localUri) return { uri: song.localUri };
  const auth = useAuthStore.getState().auth!;
  return { uri: streamUrl(auth, song.id, useSettings.getState().maxBitRate) };
}

/** URL de carátula para la pantalla de bloqueo (solo servidor por ahora). */
function artworkUrlFor(song: Song): string | undefined {
  if (song.url || song.localUri) return undefined; // radio/local: TODO carátula a disco
  const auth = useAuthStore.getState().auth!;
  return coverArtUrl(auth, song.coverArt ?? song.albumId, 500);
}

function metadataFor(song: Song): AudioMetadata {
  return {
    title: song.title,
    artist: song.artist ?? undefined,
    albumTitle: song.album ?? undefined,
    artworkUrl: artworkUrlFor(song),
  };
}

/** Aplica metadatos al bloqueo (registra el control la primera vez). */
function applyLockScreen(song: Song) {
  const p = audioPlayer;
  if (!p) return;
  const meta = metadataFor(song);
  if (!lockActive) {
    lockActive = true;
    p.setActiveForLockScreen(true, meta, {
      showSeekForward: false,
      showSeekBackward: false,
      showSkipPrevious: true,
      showSkipNext: true,
    });
  } else {
    p.updateLockScreenMetadata(meta);
  }
}

/** Carga la pista en `index` y (opcionalmente) la reproduce. */
async function loadIndex(index: number, autoplay: boolean) {
  const { queue, repeat } = usePlayerStore.getState();
  const song = queue[index];
  if (!song) return;
  await ensureAudioMode();
  const p = ensurePlayer();
  try {
    p.replace(sourceFor(song));
    p.loop = repeat === 'one';
    usePlayerStore.setState({
      index,
      positionSec: 0,
      durationSec: song.duration ?? 0,
      isPlaying: autoplay,
      isBuffering: autoplay,
    });
    if (autoplay) p.play();
    applyLockScreen(song);
    onTrackChanged(song);
  } catch {
    useToast.getState().show(tg("Couldn't play the song"));
  }
}

/** Scrobble / contador local + sincroniza la cola al cambiar de pista. */
function onTrackChanged(song: Song) {
  const auth = useAuthStore.getState().auth;
  if (auth) scrobble(auth, song.id);
  else if (useAuthStore.getState().offline) usePlayCounts.getState().bump(song.id);
  usePlayHistory.getState().record(song);
  scheduleSync();
}

/** Siguiente índice al terminar/saltar; null si la reproducción debe parar. */
function nextIndex(manual: boolean): number | null {
  const { queue, index, repeat } = usePlayerStore.getState();
  if (index < queue.length - 1) return index + 1;
  if (repeat === 'all') return 0;
  return manual ? null : null;
}

/** Listener de estado de expo-audio: progreso, play/pausa y fin de pista. */
function onStatus(status: AudioStatus) {
  const prev = usePlayerStore.getState();
  // Bufferea si queremos reproducir pero el audio aún no fluye (carga inicial,
  // rebuffer en streaming, seek…). Si está en pausa, no es buffering.
  const intendPlay = status.playing || prev.isPlaying;
  const buffering =
    intendPlay && !status.didJustFinish && (status.isBuffering || !status.isLoaded);
  usePlayerStore.setState({
    positionSec: status.currentTime ?? 0,
    durationSec: status.duration || prev.durationSec,
    isPlaying: status.playing,
    isBuffering: buffering,
  });
  // Sincronización de la cola con el servidor.
  if (status.playing) startPeriodicSync();
  else {
    stopPeriodicSync();
    if (prev.isPlaying) scheduleSync(); // acaba de pausar
  }
  if (status.didJustFinish) {
    const ni = nextIndex(false);
    if (ni == null) {
      usePlayerStore.setState({ isPlaying: false });
    } else {
      void loadIndex(ni, true);
    }
  }
}

// ── Sincronización de la cola con el servidor (savePlayQueue/getPlayQueue) ──
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let appStateAttached = false;

/** Guarda la cola actual en el servidor (si hay sesión y no es radio/local). */
function syncQueueNow() {
  const auth = useAuthStore.getState().auth;
  if (!auth) return;
  const { queue, index, positionSec } = usePlayerStore.getState();
  const current = queue[index];
  if (!current || current.url || current.localUri) return;
  const ids = queue.filter((s) => !s.url && !s.localUri).map((s) => s.id);
  if (ids.length === 0) return;
  void savePlayQueue(auth, ids, current.id, Math.floor(positionSec * 1000));
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncQueueNow, 2500);
}

function startPeriodicSync() {
  if (!syncInterval) syncInterval = setInterval(syncQueueNow, 20000);
}

function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function attachAppState() {
  if (appStateAttached) return;
  appStateAttached = true;
  AppState.addEventListener('change', (st) => {
    if (st !== 'active') syncQueueNow();
  });
}

interface PlayerState {
  queue: Song[];
  index: number;
  isPlaying: boolean;
  /** El audio está cargando/bufferando y aún no suena. */
  isBuffering: boolean;
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
  /** Restaura la cola guardada en el servidor (sin reproducir). */
  restoreFromServer: () => Promise<void>;
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
  isBuffering: false,
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
    attachAppState();
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
    await loadIndex(startIndex, true);
  },

  addToQueue: (song) => {
    const { queue } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    set({ queue: [...queue, song] });
    scheduleSync();
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
    scheduleSync();
  },

  toggle: () => {
    const p = audioPlayer;
    if (!p) return;
    if (get().isPlaying) {
      p.pause();
      set({ isPlaying: false });
    } else {
      p.play();
      set({ isPlaying: true });
    }
  },

  next: () => {
    const ni = nextIndex(true);
    if (ni != null) void loadIndex(ni, true);
  },

  previous: () => {
    const { index, positionSec } = get();
    if (positionSec > 3) {
      get().seekTo(0);
      return;
    }
    if (index > 0) void loadIndex(index - 1, true);
    else get().seekTo(0);
  },

  seekTo: (sec) => {
    audioPlayer?.seekTo(sec);
    set({ positionSec: sec });
  },

  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    if (audioPlayer) audioPlayer.volume = volume;
    set({ volume });
  },

  jumpTo: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    void loadIndex(index, true);
  },

  removeAt: async (index) => {
    const { queue, index: cur } = get();
    if (index < 0 || index >= queue.length) return;
    const next = queue.filter((_, i) => i !== index);
    if (next.length === 0) {
      await get().reset();
      return;
    }
    if (index === cur) {
      // Quitamos la actual: cargamos la que ocupa ahora esa posición.
      const newIndex = Math.min(cur, next.length - 1);
      set({ queue: next, index: newIndex });
      await loadIndex(newIndex, get().isPlaying);
    } else {
      set({ queue: next, index: index < cur ? cur - 1 : cur });
    }
  },

  moveTrack: async (from, to) => {
    const { queue, index } = get();
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
    // Recolocamos el índice actual para que siga apuntando a la misma canción.
    let newIndex = index;
    if (from === index) newIndex = to;
    else if (from < index && to >= index) newIndex = index - 1;
    else if (from > index && to <= index) newIndex = index + 1;
    set({ queue: next, index: newIndex });
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
      // La actual sigue sonando; solo reordenamos y la dejamos en el índice 0.
      set({ shuffle: true, originalQueue: queue, queue: newQueue, index: 0 });
    } else if (originalQueue && current) {
      const newIndex = Math.max(0, originalQueue.findIndex((s) => s.id === current.id));
      set({ shuffle: false, queue: originalQueue, index: newIndex, originalQueue: null });
    } else {
      set({ shuffle: false, originalQueue: null });
    }
    scheduleSync();
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat });
    if (audioPlayer) audioPlayer.loop = repeat === 'one';
  },

  setSleepTimer: (minutes) => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = setTimeout(() => {
      audioPlayer?.pause();
      sleepTimeout = null;
      set({ isPlaying: false, sleepTimerMinutes: null });
    }, minutes * 60_000);
    set({ sleepTimerMinutes: minutes });
  },

  cancelSleepTimer: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    set({ sleepTimerMinutes: null });
  },

  restoreFromServer: async () => {
    const auth = useAuthStore.getState().auth;
    if (!auth || get().queue.length > 0) return;
    let saved;
    try {
      saved = await getPlayQueue(auth);
    } catch {
      return;
    }
    if (!saved || saved.entries.length === 0) return;
    const songs = saved.entries;
    const index = saved.current
      ? Math.max(0, songs.findIndex((s) => s.id === saved.current))
      : 0;
    const positionSec = (saved.position ?? 0) / 1000;
    // Si entre tanto ya se empezó a reproducir algo, no pisamos la cola.
    if (get().queue.length > 0) return;
    attachAppState();
    set({
      queue: songs,
      index,
      positionSec,
      durationSec: songs[index]?.duration ?? 0,
      isPlaying: false,
      source: null,
      sourceHref: null,
    });
    // Cargamos la pista (sin reproducir) y dejamos la posición lista.
    await loadIndex(index, false);
    if (positionSec > 0) audioPlayer?.seekTo(positionSec);
    usePlayerStore.setState({ positionSec, isPlaying: false });
  },

  reset: async () => {
    get().cancelSleepTimer();
    stopPeriodicSync();
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    try {
      audioPlayer?.pause();
      if (lockActive) {
        audioPlayer?.clearLockScreenControls();
        lockActive = false;
      }
    } catch {
      // ignore
    }
    set({
      queue: [],
      index: 0,
      isPlaying: false,
      isBuffering: false,
      positionSec: 0,
      durationSec: 0,
      shuffle: false,
      originalQueue: null,
      source: null,
      sourceHref: null,
    });
  },
}));
