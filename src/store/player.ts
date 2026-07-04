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

import {
  coverArtUrl,
  getPlayQueue,
  getSimilarSongs,
  savePlayQueue,
  scrobble,
  streamUrl,
  type Song,
} from '@/api/subsonic';
import { prefetchLyrics } from '@/hooks/useLyrics';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import { useAuthStore } from './auth';
import {
  castLoad,
  castPause,
  castPlay,
  castSeek,
  castSetVolume,
  castStop,
  initCast,
  isCastConnected,
  type CastEvents,
} from './cast';
import {
  initUpnp,
  isUpnpConnected,
  upnpDisconnect,
  upnpLoad,
  upnpPause,
  upnpPlay,
  upnpSeek,
  upnpSetVolume,
} from './upnp';
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

// ── Salida remota (Chromecast o renderer UPnP/DLNA) ────────────────────────

/** Salida remota activa, si la hay. Solo puede haber una a la vez. */
function remoteKind(): 'cast' | 'upnp' | null {
  if (isCastConnected()) return 'cast';
  if (isUpnpConnected()) return 'upnp';
  return null;
}

function remotePlay() {
  if (remoteKind() === 'upnp') void upnpPlay();
  else void castPlay();
}

function remotePause() {
  if (remoteKind() === 'upnp') void upnpPause();
  else void castPause();
}

function remoteSeek(sec: number) {
  if (remoteKind() === 'upnp') void upnpSeek(sec);
  else void castSeek(sec);
}

function remoteSetVolume(volume: number) {
  if (remoteKind() === 'upnp') upnpSetVolume(volume);
  else castSetVolume(volume);
}

/** Carga la pista en `index` en la salida remota y sincroniza el estado. */
async function remoteLoadIndex(index: number, autoplay: boolean, startSec = 0) {
  const song = usePlayerStore.getState().queue[index];
  if (!song) return;
  const ok =
    remoteKind() === 'upnp'
      ? await upnpLoad(song, autoplay, startSec)
      : await castLoad(song, autoplay, startSec);
  if (!ok) {
    useToast.getState().show(tg("This song can't be cast"));
    usePlayerStore.setState({ index, isPlaying: false, isBuffering: false });
    return;
  }
  usePlayerStore.setState({
    index,
    positionSec: startSec,
    durationSec: song.duration ?? 0,
    isPlaying: autoplay,
    isBuffering: autoplay,
  });
  onTrackChanged(song);
}

/**
 * Mantiene el bloque "en cola" (canciones añadidas a mano, contiguas tras la
 * actual) al cambiar de pista: avanzar a la siguiente consume una; saltar a
 * cualquier otra posición disuelve el bloque (pasa a ser cola normal).
 */
function consumeQueuedOnIndexChange(next: number) {
  const { index, queuedCount } = usePlayerStore.getState();
  if (next === index || queuedCount === 0) return;
  usePlayerStore.setState({
    queuedCount: next === index + 1 ? queuedCount - 1 : 0,
  });
}

/** Carga la pista en `index` y (opcionalmente) la reproduce. */
async function loadIndex(index: number, autoplay: boolean) {
  consumeQueuedOnIndexChange(index);
  if (remoteKind()) return remoteLoadIndex(index, autoplay);
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
  // Calienta la letra ya (y la de la siguiente, para que deslizar en el
  // player también enseñe su tarjeta al instante).
  prefetchLyrics(song);
  const { queue, index } = usePlayerStore.getState();
  if (queue.length > 1) prefetchLyrics(queue[(index + 1) % queue.length]);
  scheduleSync();
  void maybeQueueAutoplay();
}

// ── Autoplay: al acercarse el final de la cola, encolar canciones parecidas ──
// (estilo Spotify). Solo online, con el ajuste activo y sin repetir petición
// para la misma última canción.
let autoplayFetchedFor: string | null = null;

async function maybeQueueAutoplay() {
  const { queue, index, repeat } = usePlayerStore.getState();
  // Con repeat la cola nunca "se acaba"; y si aún quedan 2+ canciones, aún no.
  if (repeat !== 'off' || index < queue.length - 2) return;
  const { auth, offline } = useAuthStore.getState();
  if (!auth || offline || !useSettings.getState().autoplaySimilar) return;
  const last = queue[queue.length - 1];
  if (!last || last.url || autoplayFetchedFor === last.id) return;
  autoplayFetchedFor = last.id;
  let similar: Song[];
  try {
    similar = await getSimilarSongs(auth, last.id, 20);
  } catch {
    return; // sin autoplay: la reproducción parará al final, como antes
  }
  const st = usePlayerStore.getState();
  // La cola pudo cambiar mientras respondía el servidor; solo añadimos si la
  // última canción sigue siendo la misma.
  if (st.queue[st.queue.length - 1]?.id !== last.id) return;
  const have = new Set(st.queue.map((s) => s.id));
  const fresh = similar.filter((s) => !have.has(s.id) && !s.url).slice(0, 10);
  if (fresh.length === 0) return;
  usePlayerStore.setState({ queue: [...st.queue, ...fresh] });
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
  // Con salida remota (Chromecast/UPnP) el player local está en pausa y sus
  // estados no deben pisar los que llegan del aparato remoto.
  if (remoteKind()) return;
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
    if (handleSleepAtSongEnd()) return;
    const ni = nextIndex(false);
    if (ni == null) {
      usePlayerStore.setState({ isPlaying: false });
    } else {
      void loadIndex(ni, true);
    }
  }
}

/**
 * Temporizador "al terminar la canción": si está activo, para aquí y deja la
 * siguiente pista cargada en pausa. Devuelve true si consumió el fin de pista.
 */
function handleSleepAtSongEnd(): boolean {
  const { sleepAtSongEnd, repeat } = usePlayerStore.getState();
  if (!sleepAtSongEnd) return false;
  usePlayerStore.setState({ sleepAtSongEnd: false, isPlaying: false });
  audioPlayer?.pause();
  const ni = nextIndex(false);
  if (ni != null && repeat !== 'one') void loadIndex(ni, false);
  return true;
}

// ── Persistencia local de la cola (reanudar al reabrir la app) ─────────────
// Complementa la sincronización con el servidor: funciona también en modo
// local/offline y conserva canciones descargadas y radios, que el servidor
// no admite en savePlayQueue.

// SecureStore solo admite claves con [A-Za-z0-9._-] (mismo criterio que
// playHistory); saneamos serverUrl/username.
function safeKey(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Clave por perfil, o null si no hay perfil activo. */
function queueStorageKey(): string | null {
  const { auth, offline } = useAuthStore.getState();
  if (offline) return 'resonus.queue.offline';
  if (auth) return `resonus.queue.server.${safeKey(auth.serverUrl)}.${safeKey(auth.username)}`;
  return null;
}

interface StoredQueue {
  queue: Song[];
  index: number;
  positionSec: number;
}

function saveQueueLocal() {
  const key = queueStorageKey();
  if (!key) return;
  const { queue, index, positionSec } = usePlayerStore.getState();
  if (queue.length === 0) return;
  // Tope de tamaño por prudencia con SecureStore; 500 canciones dan de sobra.
  const payload: StoredQueue = {
    queue: queue.slice(0, 500),
    index: Math.min(index, 499),
    positionSec,
  };
  void setItem(key, JSON.stringify(payload));
}

/** Olvida la cola guardada del perfil activo (el usuario la vació adrede). */
function clearQueueLocal() {
  const key = queueStorageKey();
  if (key) void deleteItem(key);
}

// ── Sincronización de la cola con el servidor (savePlayQueue/getPlayQueue) ──
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let appStateAttached = false;

/** Guarda la cola en este dispositivo y, si hay sesión, en el servidor. */
function syncQueueNow() {
  saveQueueLocal();
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

/**
 * Engancha los eventos de las salidas remotas (Chromecast y UPnP) a la cola.
 * Ambas comparten los mismos handlers; ver src/store/cast.ts y upnp.ts.
 * Llamar una vez al arrancar.
 */
export function initRemoteIntegration() {
  const events: CastEvents = {
    onConnected: () => {
      // Transfiere la pista actual al aparato y silencia el player local.
      const { queue, index, positionSec, isPlaying } = usePlayerStore.getState();
      try {
        audioPlayer?.pause();
        if (lockActive) {
          audioPlayer?.clearLockScreenControls();
          lockActive = false;
        }
      } catch {
        // ignore
      }
      if (queue[index]) void remoteLoadIndex(index, isPlaying, positionSec);
    },
    onDisconnected: (lastPositionSec) => {
      // Vuelve al player local, en pausa, donde se quedó el cast.
      const { queue, index } = usePlayerStore.getState();
      if (!queue[index]) return;
      void (async () => {
        await loadIndex(index, false);
        if (lastPositionSec > 0) audioPlayer?.seekTo(lastPositionSec);
        usePlayerStore.setState({ positionSec: lastPositionSec, isPlaying: false });
      })();
    },
    onProgress: (positionSec, durationSec) => {
      usePlayerStore.setState({
        positionSec,
        durationSec: durationSec || usePlayerStore.getState().durationSec,
      });
    },
    onPlayingChanged: (isPlaying, isBuffering) => {
      usePlayerStore.setState({ isPlaying, isBuffering });
      if (isPlaying) startPeriodicSync();
      else {
        stopPeriodicSync();
        scheduleSync();
      }
    },
    onFinished: () => {
      if (handleSleepAtSongEnd()) return;
      const { repeat, index } = usePlayerStore.getState();
      if (repeat === 'one') {
        void remoteLoadIndex(index, true);
        return;
      }
      const ni = nextIndex(false);
      if (ni == null) usePlayerStore.setState({ isPlaying: false });
      else void loadIndex(ni, true);
    },
  };
  initCast({
    ...events,
    onConnected: () => {
      // Exclusión mutua: si había un renderer UPnP activo, se suelta en
      // silencio (la reproducción sigue en el Chromecast recién conectado).
      if (isUpnpConnected()) void upnpDisconnect(true);
      events.onConnected();
    },
  });
  initUpnp(events);
}

interface PlayerState {
  queue: Song[];
  index: number;
  /**
   * Canciones añadidas a mano con "añadir a la cola" aún pendientes; ocupan
   * las posiciones index+1..index+queuedCount (estilo "Next in queue" de
   * Spotify: suenan justo después de la actual, antes de que siga la lista).
   */
  queuedCount: number;
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
  /** Pausar al terminar la pista actual (temporizador "fin de la canción"). */
  sleepAtSongEnd: boolean;
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
  /** Vacía la cola dejando solo la canción actual (sigue sonando). */
  clearQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setSleepTimer: (minutes: number) => void;
  setSleepAtSongEnd: () => void;
  cancelSleepTimer: () => void;
  /** Restaura la cola guardada en el servidor (sin reproducir). */
  restoreFromServer: () => Promise<void>;
  /** Restaura la cola guardada en este dispositivo (sin reproducir). */
  restoreFromStorage: () => Promise<void>;
  /** Retoma la última cola: primero la copia local; si no hay, la del servidor. */
  restoreQueue: () => Promise<void>;
  reset: () => Promise<void>;
}

/** Canción que está sonando ahora mismo, o null si la cola está vacía. */
export function currentSong(state: PlayerState): Song | null {
  return state.queue[state.index] ?? null;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  queuedCount: 0,
  isPlaying: false,
  isBuffering: false,
  positionSec: 0,
  durationSec: 0,
  volume: 1,
  shuffle: false,
  repeat: 'off',
  originalQueue: null,
  sleepTimerMinutes: null,
  sleepAtSongEnd: false,
  source: null,
  sourceHref: null,

  playQueue: async (songs, startIndex = 0, source, sourceHref) => {
    if (songs.length === 0) return;
    attachAppState();
    autoplayFetchedFor = null;
    set({
      queue: songs,
      index: startIndex,
      queuedCount: 0,
      positionSec: 0,
      durationSec: 0,
      shuffle: false,
      originalQueue: null,
      source: source ?? null,
      sourceHref: sourceHref ?? null,
    });
    await loadIndex(startIndex, true);
  },

  // Estilo Spotify: lo añadido a mano suena justo después de la actual (y de
  // lo ya añadido antes), no al final de la lista en reproducción.
  addToQueue: (song) => {
    const { queue, index, queuedCount } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    const next = [...queue];
    next.splice(Math.min(index + queuedCount + 1, next.length), 0, song);
    set({ queue: next, queuedCount: queuedCount + 1 });
    scheduleSync();
  },

  playNext: (song) => {
    const { queue, index, queuedCount } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    const next = [...queue];
    next.splice(index + 1, 0, song);
    // Se cuela al principio del bloque "en cola"; el bloque crece con ella.
    set({ queue: next, queuedCount: queuedCount + 1 });
    scheduleSync();
  },

  toggle: () => {
    if (remoteKind()) {
      if (get().isPlaying) {
        remotePause();
        set({ isPlaying: false });
      } else {
        remotePlay();
        set({ isPlaying: true });
      }
      return;
    }
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
    if (remoteKind()) remoteSeek(sec);
    else audioPlayer?.seekTo(sec);
    set({ positionSec: sec });
  },

  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    if (remoteKind()) remoteSetVolume(volume);
    else if (audioPlayer) audioPlayer.volume = volume;
    set({ volume });
  },

  jumpTo: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    void loadIndex(index, true);
  },

  removeAt: async (index) => {
    const { queue, index: cur, queuedCount } = get();
    if (index < 0 || index >= queue.length) return;
    const next = queue.filter((_, i) => i !== index);
    if (next.length === 0) {
      clearQueueLocal();
      await get().reset();
      return;
    }
    if (index === cur) {
      // Quitamos la actual: cargamos la que ocupa ahora esa posición. Si era
      // la primera del bloque "en cola", pasa a sonar y queda consumida.
      const newIndex = Math.min(cur, next.length - 1);
      set({ queue: next, index: newIndex, queuedCount: Math.max(0, queuedCount - 1) });
      await loadIndex(newIndex, get().isPlaying);
    } else {
      const inQueuedBlock = index > cur && index <= cur + queuedCount;
      set({
        queue: next,
        index: index < cur ? cur - 1 : cur,
        queuedCount: inQueuedBlock ? queuedCount - 1 : queuedCount,
      });
    }
    scheduleSync();
  },

  clearQueue: () => {
    const { queue, index } = get();
    const current = queue[index];
    if (!current) return;
    set({ queue: [current], index: 0, queuedCount: 0, originalQueue: null });
    scheduleSync();
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
    // Reordenar a mano disuelve el bloque "en cola" (el usuario toma el control).
    set({ queue: next, index: newIndex, queuedCount: 0 });
    scheduleSync();
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
      // Barajar disuelve el bloque "en cola" (las posiciones ya no existen).
      set({ shuffle: true, originalQueue: queue, queue: newQueue, index: 0, queuedCount: 0 });
    } else if (originalQueue && current) {
      const newIndex = Math.max(0, originalQueue.findIndex((s) => s.id === current.id));
      set({
        shuffle: false,
        queue: originalQueue,
        index: newIndex,
        originalQueue: null,
        queuedCount: 0,
      });
    } else {
      set({ shuffle: false, originalQueue: null, queuedCount: 0 });
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
      if (remoteKind()) remotePause();
      else audioPlayer?.pause();
      sleepTimeout = null;
      set({ isPlaying: false, sleepTimerMinutes: null });
    }, minutes * 60_000);
    set({ sleepTimerMinutes: minutes, sleepAtSongEnd: false });
  },

  setSleepAtSongEnd: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    set({ sleepTimerMinutes: null, sleepAtSongEnd: true });
  },

  cancelSleepTimer: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    set({ sleepTimerMinutes: null, sleepAtSongEnd: false });
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

  restoreFromStorage: async () => {
    const key = queueStorageKey();
    if (!key || get().queue.length > 0) return;
    let saved: StoredQueue | null = null;
    try {
      const raw = await getItem(key);
      saved = raw ? (JSON.parse(raw) as StoredQueue) : null;
    } catch {
      return;
    }
    if (!saved || !Array.isArray(saved.queue) || saved.queue.length === 0) return;
    // Si entre tanto ya se empezó a reproducir algo, no pisamos la cola.
    if (get().queue.length > 0) return;
    const index = Math.min(Math.max(0, saved.index ?? 0), saved.queue.length - 1);
    const positionSec =
      typeof saved.positionSec === 'number' && Number.isFinite(saved.positionSec)
        ? Math.max(0, saved.positionSec)
        : 0;
    attachAppState();
    set({
      queue: saved.queue,
      index,
      positionSec,
      durationSec: saved.queue[index]?.duration ?? 0,
      isPlaying: false,
      source: null,
      sourceHref: null,
    });
    await loadIndex(index, false);
    if (positionSec > 0) audioPlayer?.seekTo(positionSec);
    usePlayerStore.setState({ positionSec, isPlaying: false });
  },

  restoreQueue: async () => {
    // La copia local es la más fiel (incluye descargas, radios y el modo
    // offline); la del servidor queda de respaldo para sesiones nuevas.
    await get().restoreFromStorage();
    if (get().queue.length === 0) await get().restoreFromServer();
  },

  reset: async () => {
    get().cancelSleepTimer();
    autoplayFetchedFor = null;
    stopPeriodicSync();
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    // Al resetear (cambio de perfil/salir) se corta la salida remota sin
    // reanudar en local: la cola va a desaparecer igualmente.
    if (remoteKind() === 'cast') void castStop();
    else if (remoteKind() === 'upnp') void upnpDisconnect(true);
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
      queuedCount: 0,
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
