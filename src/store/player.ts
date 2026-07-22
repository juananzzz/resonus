/**
 * Estado y control de reproducción sobre **expo-audio**.
 *
 * La cola vive en JS (este store). Decodifican dos `AudioPlayer` alternos: el
 * "activo" suena y posee la notificación / pantalla de bloqueo
 * (`setActiveForLockScreen`); el otro queda de reserva para el crossfade (la
 * pista entrante arranca en él a volumen 0 y pasa a ser el activo). Sin
 * crossfade solo trabaja uno, con `replace()` de la fuente al cambiar de
 * pista. El avance automático se detecta con `playbackStatusUpdate`
 * (`didJustFinish`); si hay crossfade en marcha, el cambio ya ocurrió antes.
 *
 * (Se migró desde react-native-track-player para poder tener UNA sola
 * MediaSession y así soportar Android Auto con el módulo `modules/car-auto`.
 * Android Auto no se ve afectado por el crossfade: usa su propia sesión con
 * `JsProxyPlayer`, no la del player de expo-audio.)
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
  getOpenSubsonicExtensions,
  getPlayQueue,
  getRandomSongs,
  getSimilarSongs,
  getTopSongs,
  savePlayQueue,
  scrobble,
  streamUrl,
  type Song,
  type SubsonicAuth,
} from '@/api/backend';
import { prefetchLyrics } from '@/hooks/useLyrics';
import { queryClient } from '@/lib/query';
import { getItem, setItem } from '@/lib/storage';
import { useAuthStore } from './auth';
import { checkAutoUrlNow } from './autoUrl';
import { useEqualizer } from './equalizer';
import { useLastPlayed } from './lastPlayed';
import {
  initUpnp,
  isUpnpConnected,
  upnpDisconnect,
  upnpLoad,
  upnpPause,
  upnpPlay,
  upnpSeek,
  upnpSetVolume,
  type RemoteEvents,
} from './upnp';
import {
  initJukebox,
  isJukeboxActive,
  jukeboxDisconnect,
  jukeboxLoad,
  jukeboxPause,
  jukeboxPlay,
  jukeboxSeek,
  jukeboxSetVolume,
} from './jukebox';
import { castSetState, castUpdate, initCastMedia } from './castMedia';
import { useDownloads } from './downloads';
import { useNetworkType } from './networkType';
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

/**
 * Vencimiento del temporizador de sueño (`sleepEndsAt` del store), o null.
 *
 * Vive en el store y no aquí porque la interfaz también lo necesita: es lo que
 * deja decir cuánto QUEDA en vez de repetir los minutos que se eligieron, que
 * es un número que envejece mal. Y sirve de respaldo del setTimeout: Android
 * congela/retrasa los timers JS en segundo plano con la pantalla apagada (el
 * caso típico del sleep timer), así que onStatus —que sigue latiendo mientras
 * suena el player nativo— también comprueba la hora.
 */
function sleepDeadline(): number | null {
  return usePlayerStore.getState().sleepEndsAt;
}

// ── Fundido final del temporizador de sueño ─────────────────────────────────
// El único momento en que este temporizador existe es mientras te estás
// durmiendo, y cortar la música en seco justo ahí puede despertarte — lo
// contrario de lo que se le pidió. Así que los últimos segundos se van
// bajando. El fundido ACABA en el vencimiento, no empieza ahí: "para en 30
// minutos" significa que a los 30 minutos hay silencio.

const SLEEP_FADE_MS = 30_000;

let sleepFadeTimeout: ReturnType<typeof setTimeout> | null = null;
let sleepFadeTimer: ReturnType<typeof setInterval> | null = null;

/** Corta el fundido de sueño en curso, si lo hay. El volumen lo restaura quien
 *  llama (`cutCrossfade`, que es por donde pasa toda intervención). */
function clearSleepFade() {
  if (sleepFadeTimeout) clearTimeout(sleepFadeTimeout);
  sleepFadeTimeout = null;
  if (sleepFadeTimer) clearInterval(sleepFadeTimer);
  sleepFadeTimer = null;
}

/**
 * Baja el volumen a cero en `ms`. No captura el player ni su volumen: los lee
 * en cada tic y aplica el fundido como un factor sobre `effectiveVolume`. Así
 * sigue valiendo si la pista cambia a mitad (el ReplayGain es por canción) y
 * la nueva no arranca a todo volumen.
 */
function startSleepFade(ms: number) {
  if (remoteKind()) return; // el volumen del aparato remoto no es nuestro
  clearSleepFade();
  const t0 = Date.now();
  sleepFadeTimer = setInterval(() => {
    const x = Math.min(1, (Date.now() - t0) / ms);
    const p = activePlayer();
    if (p) {
      try {
        p.volume = effectiveVolume(currentSong(usePlayerStore.getState())) * (1 - x);
      } catch {
        // ignore
      }
    }
    if (x >= 1) clearSleepFade();
  }, 100);
}

/** Programa el fundido para que termine justo en el vencimiento. */
function armSleepFade(msLeft: number) {
  clearSleepFade();
  const fadeMs = Math.min(SLEEP_FADE_MS, msLeft);
  const wait = msLeft - fadeMs;
  if (wait <= 0) startSleepFade(fadeMs);
  else sleepFadeTimeout = setTimeout(() => startSleepFade(fadeMs), wait);
}

/** Suelta el fundido y devuelve el volumen a su sitio: para cuando se cancela
 *  el temporizador con la música ya a media bajada. */
function abortSleepFade() {
  if (!sleepFadeTimer && !sleepFadeTimeout) return;
  clearSleepFade();
  const p = activePlayer();
  if (p) {
    try {
      p.volume = effectiveVolume(currentSong(usePlayerStore.getState()));
    } catch {
      // ignore
    }
  }
}

/** Pausa por temporizador de sueño cumplido (desde el timeout o onStatus). */
function fireSleepTimer() {
  if (sleepTimeout) clearTimeout(sleepTimeout);
  sleepTimeout = null;
  // Pausar ANTES de restaurar el volumen: al revés, el fundido acaba de dejarlo
  // a cero y `cutCrossfade` lo devolvería a tope unos milisegundos antes de la
  // pausa — un golpe de sonido justo al dormirse, que es lo que evitamos.
  clearSleepFade();
  if (remoteKind()) remotePause();
  else activePlayer()?.pause();
  cutCrossfade();
  usePlayerStore.setState({ isPlaying: false, sleepEndsAt: null });
}

// ── Motor de audio (expo-audio) ─────────────────────────────────────────────
const players: (AudioPlayer | null)[] = [null, null];
let activeIdx = 0;
let audioModeReady = false;
/** Player que registró los controles de bloqueo (dueño de la MediaSession). */
let lockOwner: AudioPlayer | null = null;

/** Player activo (el que suena y manda en el estado), si ya existe. */
function activePlayer(): AudioPlayer | null {
  return players[activeIdx];
}

/** Crea (una vez) el AudioPlayer `idx` y engancha sus listeners. */
function ensurePlayer(idx: number): AudioPlayer {
  const existing = players[idx];
  if (existing) return existing;
  const p = createAudioPlayer(null, { updateInterval: 500 });
  // Los listeners viven durante toda la sesión (los players son singletons).
  // Solo el player activo alimenta el estado: los eventos del que se apaga
  // durante un crossfade (incluido su didJustFinish) se ignoran.
  p.addListener('playbackStatusUpdate', (status) => {
    if (activePlayer() === p) onStatus(status);
  });
  // Saltar pista desde la notificación / bloqueo → la cola la gestiona JS.
  // Solo el dueño de la sesión emite estos eventos; no hay dobles saltos.
  p.addListener('remotePrevious', () => usePlayerStore.getState().previous());
  p.addListener('remoteNext', () => usePlayerStore.getState().next());
  // Ecualizador: el efecto nativo se engancha a la sesión de audio de ESTE
  // player. Como son singletons (dos alternos para el crossfade), basta con
  // hacerlo al crearlos; el estado guardado se aplica solo.
  useEqualizer.getState().attach(p.audioSessionId);
  players[idx] = p;
  return p;
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

/**
 * Fichero de una canción descargada, aunque la canción venga del servidor
 * (en modo servidor los `Song` de la API no traen `localUri`; las descargas
 * viven en el mapa de `useDownloads`).
 */
function downloadedUri(song: Song): string | undefined {
  return useDownloads.getState().files[song.id];
}

/**
 * ¿Se puede reproducir esta pista sin conexión? Radio (url propia), pista de la
 * biblioteca local (localUri) o descarga en disco. En offline, las que solo
 * existen como stream del servidor no se pueden sonar y hay que saltarlas.
 */
function playableOffline(song: Song | null | undefined): boolean {
  return !!song && (!!song.url || !!song.localUri || !!downloadedUri(song));
}

/** Bitrate máximo de streaming según la red actual (Wi-Fi o datos móviles). */
export function effectiveMaxBitRate(): number {
  const s = useSettings.getState();
  return useNetworkType.getState().cellular ? s.maxBitRateCellular : s.maxBitRate;
}

/** Fuente para expo-audio: radio (url), local (file/content) o stream Subsonic. */
function sourceFor(song: Song, timeOffsetSec = 0): { uri: string } {
  if (song.url) return { uri: song.url };
  if (song.localUri) return { uri: song.localUri };
  // Descargada → suena desde disco también en modo servidor: funciona sin
  // conexión y con conexión no gasta datos.
  const dl = downloadedUri(song);
  if (dl) return { uri: dl };
  const auth = useAuthStore.getState().auth!;
  const format = useSettings.getState().streamFormat;
  return { uri: streamUrl(auth, song.id, effectiveMaxBitRate(), timeOffsetSec, format) };
}

// ── Seek en streams transcodificados ────────────────────────────────────────
// Un stream que el servidor genera al vuelo no tiene acceso aleatorio: el
// seek nativo rebota o reinicia. Si el servidor anuncia la extensión
// OpenSubsonic `transcodeOffset`, se re-pide el stream con `timeOffset` y se
// compensa la posición mostrada (offset + tiempo del player nativo).

/** Segundo real del stream en el que empieza la fuente actual del player. */
let streamOffsetSec = 0;
/** Soporte de `transcodeOffset` del servidor activo (null = sin comprobar). */
let transcodeOffsetSupported: boolean | null = null;

/** ¿Esta canción se está transcodificando (el servidor la genera al vuelo)? */
function isTranscoded(song: Song): boolean {
  // Las descargadas suenan desde disco: seek nativo normal, sin timeOffset.
  if (song.url || song.localUri || downloadedUri(song)) return false;
  const max = effectiveMaxBitRate();
  // Sin límite el servidor sirve el fichero original (directo, seek nativo). El
  // códec forzado solo se envía con `maxBitRate > 0` (ver streamUrl), así que
  // fuera de ahí no hay transcode.
  if (max <= 0) return false;
  // Transcodifica si el original supera el bitrate O si se fuerza un códec de
  // salida (el servidor reconvierte aunque el bitrate ya cupiera). En ambos
  // casos el stream pierde el acceso aleatorio y el seek nativo reiniciaría.
  return useSettings.getState().streamFormat !== '' || (song.bitRate != null && song.bitRate > max);
}

/** Consulta (una vez por perfil) si el servidor soporta `transcodeOffset`. */
async function ensureTranscodeOffsetSupport(): Promise<boolean> {
  if (transcodeOffsetSupported != null) return transcodeOffsetSupported;
  const auth = useAuthStore.getState().auth;
  if (!auth) return false; // sin sesión aún: no cachear, se re-comprueba
  try {
    const exts = await getOpenSubsonicExtensions(auth);
    transcodeOffsetSupported = exts.includes('transcodeOffset');
    return transcodeOffsetSupported;
  } catch {
    // Fallo transitorio de red: NO cachear como "no soportado", o un solo hipo
    // dejaría todos los seeks en modo nativo (reinician) el resto de la sesión.
    // Se reintenta en el siguiente seek.
    return false;
  }
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

/**
 * Aplica metadatos al bloqueo. Si `p` no es aún el dueño de la sesión, la
 * registra a su nombre (primera vez, o traspaso al otro player en crossfade:
 * el servicio nativo mueve la notificación y la MediaSession al nuevo player).
 */
function applyLockScreen(p: AudioPlayer, song: Song) {
  const meta = metadataFor(song);
  if (lockOwner === p) {
    p.updateLockScreenMetadata(meta);
    return;
  }
  lockOwner = p;
  p.setActiveForLockScreen(true, meta, {
    showSeekForward: false,
    showSeekBackward: false,
    showSkipPrevious: true,
    showSkipNext: true,
  });
}

/** Retira los controles de bloqueo (cambio de perfil o salida remota). */
function clearLockScreen() {
  if (!lockOwner) return;
  try {
    lockOwner.clearLockScreenControls();
  } catch {
    // ignore
  }
  lockOwner = null;
}

// ── Salida remota (renderer UPnP/DLNA) ─────────────────────────────────────

/** Salida remota activa, si la hay. */
function remoteKind(): 'upnp' | 'jukebox' | null {
  if (isUpnpConnected()) return 'upnp';
  if (isJukeboxActive()) return 'jukebox';
  return null;
}

function remotePlay() {
  if (isJukeboxActive()) void jukeboxPlay();
  else void upnpPlay();
}

function remotePause() {
  if (isJukeboxActive()) void jukeboxPause();
  else void upnpPause();
}

function remoteSeek(sec: number) {
  if (isJukeboxActive()) void jukeboxSeek(sec);
  else void upnpSeek(sec);
}

function remoteSetVolume(volume: number) {
  if (isJukeboxActive()) jukeboxSetVolume(volume);
  else upnpSetVolume(volume);
}

/**
 * Sincroniza la sesión de medios del casting (notificación de bloqueo + botones
 * de volumen) con la pista/estado actual. Solo para UPnP: el Jukebox suena en el
 * propio servidor y no necesita una sesión local en el teléfono.
 */
function syncCastMedia(): void {
  if (!isUpnpConnected()) return;
  const st = usePlayerStore.getState();
  const song = currentSong(st);
  if (!song) return;
  castUpdate({
    title: song.title,
    artist: song.artist ?? undefined,
    album: song.album ?? undefined,
    artworkUrl: artworkUrlFor(song),
    durationMs: (song.duration ?? st.durationSec) * 1000,
    positionMs: st.positionSec * 1000,
    isPlaying: st.isPlaying,
  });
}

/** Carga la pista en `index` en la salida remota y sincroniza el estado. */
async function remoteLoadIndex(index: number, autoplay: boolean, startSec = 0) {
  const song = usePlayerStore.getState().queue[index];
  if (!song) return;
  scrobbledThisTrack = false;
  const ok = isJukeboxActive()
    ? await jukeboxLoad(song, autoplay, startSec)
    : await upnpLoad(song, autoplay, startSec);
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
  // Sin conexión, una pista que solo existe como stream del servidor no se
  // puede reproducir: saltamos hacia delante a la siguiente descargada en vez
  // de atascarnos (cubre "anterior", toques manuales y restaurar cola). Si no
  // queda ninguna reproducible, paramos. `nextIndex` ya evita llegar aquí en el
  // avance normal, así que esto es la red de seguridad para el resto de vías.
  if (useAuthStore.getState().offline) {
    const q = usePlayerStore.getState().queue;
    if (q[index] && !playableOffline(q[index])) {
      let target = -1;
      for (let i = index + 1; i < q.length; i++) {
        if (playableOffline(q[i])) {
          target = i;
          break;
        }
      }
      if (target === -1) {
        usePlayerStore.setState({ isPlaying: false });
        useToast.getState().show(tg('Nothing here is downloaded'));
        return;
      }
      index = target;
    }
  }
  cutCrossfade();
  pendingSeek = null;
  streamOffsetSec = 0;
  scrobbledThisTrack = false;
  consumeQueuedOnIndexChange(index);
  if (remoteKind()) return remoteLoadIndex(index, autoplay);
  const { queue, repeat } = usePlayerStore.getState();
  const song = queue[index];
  if (!song) return;
  await ensureAudioMode();
  const p = ensurePlayer(activeIdx);
  // Reintento de enganche del ecualizador: al crear el player la sesión de
  // audio puede no estar asignada todavía. Es idempotente (el nativo ignora
  // sesiones repetidas y el id 0), así que sale barato asegurarlo aquí.
  useEqualizer.getState().attach(p.audioSessionId);
  try {
    p.replace(sourceFor(song));
    p.loop = repeat === 'one';
    // Volumen efectivo de ESTA canción (usuario × ReplayGain).
    p.volume = effectiveVolume(song);
    usePlayerStore.setState({
      index,
      positionSec: 0,
      durationSec: song.duration ?? 0,
      isPlaying: autoplay,
      isBuffering: autoplay,
    });
    if (autoplay) p.play();
    applyLockScreen(p, song);
    onTrackChanged(song);
    // Calienta la respuesta de "¿soporta timeOffset?" para que el primer seek
    // en un stream transcodificado ya tenga la respuesta cacheada.
    if (isTranscoded(song)) void ensureTranscodeOffsetSupport();
  } catch {
    useToast.getState().show(tg("Couldn't play the song"));
  }
}

// ── Historial "atrás" estilo Spotify ────────────────────────────────────────
// Pila de contextos ya reproducidos para que el botón/gesto anterior vuelva a
// la canción previa aunque venga de otra lista o álbum (no a la pista anterior
// del contexto actual). Se apila en cada avance/salto hacia delante y se
// desapila en previous(). Las entradas comparten la referencia de `queue`
// dentro de un mismo contexto, así que solo pesan lo que cambia entre saltos.
type HistoryEntry = {
  queue: Song[];
  index: number;
  source: string | null;
  sourceHref: string | null;
  originalQueue: Song[] | null;
  shuffle: boolean;
};
const HISTORY_MAX = 100;
let playedHistory: HistoryEntry[] = [];

/** Apila el contexto actual antes de avanzar o saltar a otra pista. */
function pushHistory() {
  const { queue, index, source, sourceHref, originalQueue, shuffle } =
    usePlayerStore.getState();
  if (!queue[index]) return;
  playedHistory.push({ queue, index, source, sourceHref, originalQueue, shuffle });
  if (playedHistory.length > HISTORY_MAX) playedHistory.shift();
}

// ── Scrobble honesto ────────────────────────────────────────────────────────
// Al empezar una pista solo se anuncia "reproduciendo ahora" (submission
// false); la escucha real se envía al cruzar el umbral clásico de Last.fm:
// 50 % de la duración o 4 minutos, lo que llegue antes. Así saltar canciones
// no infla contadores ni el historial de Last.fm/ListenBrainz. El contador
// local del modo offline sigue la misma regla.
let scrobbledThisTrack = false;

/** Envía el scrobble real una sola vez por pista al cruzar el umbral. */
function maybeScrobbleThreshold(positionSec: number) {
  if (scrobbledThisTrack) return;
  const st = usePlayerStore.getState();
  const song = st.queue[st.index];
  if (!song || song.url) return; // las radios no se scrobblean
  const duration = st.durationSec || song.duration || 0;
  const threshold = duration > 0 ? Math.min(duration * 0.5, 240) : 240;
  if (positionSec < threshold) return;
  scrobbledThisTrack = true;
  const { auth, offline } = useAuthStore.getState();
  // Offline (incluida una cuenta de servidor sin conexión): cuenta local, no
  // scrobble al servidor — al que no llegaríamos igualmente.
  if (offline) usePlayCounts.getState().bump(song.id);
  else if (auth) scrobble(auth, song.id, true);
}

/** Now playing / historial + sincroniza la cola al cambiar de pista. */
function onTrackChanged(song: Song) {
  const { auth, offline } = useAuthStore.getState();
  // Solo "estoy escuchando esto"; la reproducción cuenta al cruzar el umbral.
  // Offline no se manda (cuenta de servidor sin conexión: no hay a quién).
  if (auth && !offline) scrobble(auth, song.id, false);
  usePlayHistory.getState().record(song);
  // Calienta la letra ya (y la de la siguiente, para que deslizar en el
  // player también enseñe su tarjeta al instante).
  prefetchLyrics(song);
  const { queue, index } = usePlayerStore.getState();
  if (queue.length > 1) prefetchLyrics(queue[(index + 1) % queue.length]);
  scheduleSync();
  warmUpcoming();
  void maybeQueueAutoplay();
  // Casting: refleja la nueva pista en la sesión de medios (bloqueo/volumen).
  syncCastMedia();
}

// ── Precarga de próximas pistas (calienta el stream por adelantado) ──────────
// Para proxys tipo Octo Fiesta u orígenes lentos que bajan la pista al vuelo:
// al cambiar de pista se pide con antelación la URL de stream de las próximas,
// para que el servidor ya la tenga cacheada al llegar (o al saltar varias). Solo
// hace falta que la petición ALCANCE al servidor —él arranca su fetch del origen
// aunque nosotros no leamos la respuesta—, así que es best-effort y sobrevive al
// segundo plano: se dispara desde onTrackChanged, que late por el evento nativo.
// Apagado por defecto (ver ajuste preloadUpcoming); en un servidor normal no
// aporta y solo daría transcodes/estadísticas de más.
const PRELOAD_AHEAD = 5;
/** Ids ya calentados: al deslizarse la ventana solo se calienta la que entra
 *  nueva (~1 petición por avance), no las cinco cada vez. Se limpia al cambiar
 *  de cola (playQueue). */
const warmedIds = new Set<string>();

function resetWarmed() {
  warmedIds.clear();
}

function warmUpcoming() {
  if (!useSettings.getState().preloadUpcoming) return;
  const auth = useAuthStore.getState().auth;
  if (!auth || useAuthStore.getState().offline) return;
  const { queue, index, repeat } = usePlayerStore.getState();
  if (queue.length <= 1) return;
  for (let i = 1; i <= PRELOAD_AHEAD; i++) {
    // 'one' no cambia de pista; con 'all' la cola da la vuelta, si no se corta.
    const ni = repeat === 'all' ? (index + i) % queue.length : index + i;
    if (repeat !== 'all' && ni >= queue.length) break;
    const song = queue[ni];
    // Descargadas/locales/radio no pasan por el servidor: nada que calentar.
    if (!song || song.url || song.localUri || downloadedUri(song)) continue;
    if (warmedIds.has(song.id)) continue;
    warmedIds.add(song.id);
    // Sin `maxBitRate`: se calienta el ORIGEN, no la transcodificación. En un
    // proxy tipo Octo Fiesta esto dispara igual la bajada del proveedor (que es
    // lo lento), pero NO deja fijada la sesión transcodificada que luego usa la
    // reproducción, que así conserva el seek (con la URL de stream idéntica, esa
    // primera petición la volvía no-buscable y el arrastre reiniciaba la pista).
    // En un servidor normal, además, evita transcodes de más.
    void warmStream(streamUrl(auth, song.id));
  }
}

/**
 * Punto único del calentado. Pide solo el primer byte (`Range`) para no gastar
 * datos del móvil: al proxy le basta esa petición para bajar y cachear la pista
 * entera en su lado. El AbortController acota el peor caso —un servidor que
 * ignore `Range` y mande el archivo completo— a unos segundos, de sobra para
 * haber disparado el fetch del origen. Si en pruebas contra un Octo Fiesta real
 * no bastara, aquí se sube el Range o se pasa a leer/descartar toda la respuesta.
 */
async function warmStream(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    await fetch(url, { headers: { Range: 'bytes=0-1' }, signal: ctrl.signal });
  } catch {
    // Best-effort: sin conexión, abortado o error del servidor dan igual.
  } finally {
    clearTimeout(timer);
  }
}

// ── Autoplay: al acercarse el final de la cola, encolar canciones parecidas ──
// (estilo Spotify). Solo online, con el ajuste activo (o en modo radio) y sin
// repetir petición para la misma última canción.
let autoplayFetchedFor: string | null = null;

/**
 * Canciones con las que alargar una radio a partir de `seed`, por orden de
 * afinidad: parecidas → lo más escuchado del artista → al azar de su género.
 *
 * Se baja de nivel cuando el anterior no da NINGUNA que no esté ya en la cola,
 * no cuando da pocas. La diferencia importa: `getSimilarSongs` necesita Last.fm
 * en el servidor, y sin él la radio caía al artista, agotaba sus ~20 temas y
 * entonces todos los candidatos ya estaban en la cola → cero nuevas → la radio
 * se moría en silencio a la vuelta de un rato. El género sale de las etiquetas
 * y no depende de nada externo, así que siempre queda de dónde tirar.
 */
async function radioCandidates(auth: SubsonicAuth, seed: Song, have: Set<string>): Promise<Song[]> {
  const tiers: (() => Promise<Song[]>)[] = [
    () => getSimilarSongs(auth, seed.id, 20),
    () => (seed.artist ? getTopSongs(auth, seed.artist, 20) : Promise.resolve([])),
    () => (seed.genre ? getRandomSongs(auth, 20, seed.genre) : Promise.resolve([])),
  ];
  for (const tier of tiers) {
    let songs: Song[];
    try {
      songs = await tier();
    } catch {
      continue; // este nivel falló; el siguiente puede funcionar
    }
    const fresh = songs.filter((s) => !have.has(s.id) && !s.url);
    if (fresh.length > 0) return fresh;
  }
  return [];
}

async function maybeQueueAutoplay() {
  const { queue, index, repeat, radioMode } = usePlayerStore.getState();
  // Con repeat la cola nunca "se acaba"; y si aún quedan 2+ canciones, aún no.
  if (repeat !== 'off' || index < queue.length - 2) return;
  const { auth, offline } = useAuthStore.getState();
  if (!auth || offline) return;
  // La radio se alarga aunque el ajuste esté apagado: la pediste tú a mano.
  if (!useSettings.getState().autoplaySimilar && !radioMode) return;
  const last = queue[queue.length - 1];
  if (!last || last.url || autoplayFetchedFor === last.id) return;
  autoplayFetchedFor = last.id;
  let similar: Song[];
  try {
    // Los niveles de respaldo (artista, género) solo en radio: el autoplay de
    // siempre se comporta como hasta ahora.
    similar = radioMode
      ? await radioCandidates(auth, last, new Set(queue.map((s) => s.id)))
      : await getSimilarSongs(auth, last.id, 20);
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
function nextIndex(_manual: boolean): number | null {
  const { queue, index, repeat } = usePlayerStore.getState();
  // Sin conexión se saltan las pistas sin fichero local (solo-stream); online
  // cualquiera vale. `ok` decide si un índice es candidato.
  const offline = useAuthStore.getState().offline;
  const ok = (i: number) => !offline || playableOffline(queue[i]);
  for (let i = index + 1; i < queue.length; i++) {
    if (ok(i)) return i;
  }
  // Fin de la cola: con repeat 'all' se envuelve buscando desde el principio
  // (incluye el índice actual, así que una sola pista reproducible se repite).
  if (repeat === 'all') {
    for (let i = 0; i <= index; i++) {
      if (ok(i)) return i;
    }
  }
  return null;
}

// ── ReplayGain (normalización de volumen) ───────────────────────────────────
// El volumen efectivo de un player es siempre `volume` (el del usuario) por el
// factor ReplayGain de SU canción. Las etiquetas vienen del servidor (y se
// conservan en las descargas); sin etiquetas o con el ajuste apagado, 1.

/** Factor lineal de ReplayGain para una canción según el modo del ajuste. */
function gainFactor(song: Song | null | undefined): number {
  let mode = useSettings.getState().replayGain;
  const rg = song?.replayGain;
  if (mode === 'off' || !rg) return 1;
  if (mode === 'auto') {
    // Como Spotify: álbum entero sin shuffle → ganancia de álbum (conserva
    // su dinámica interna); playlists, favoritos o shuffle → por canción.
    const st = usePlayerStore.getState();
    mode = st.sourceHref?.startsWith('/album/') && !st.shuffle ? 'album' : 'track';
  }
  // Modo álbum sin ganancia de álbum (o viceversa): se usa la que haya.
  const gain = mode === 'album' ? (rg.albumGain ?? rg.trackGain) : (rg.trackGain ?? rg.albumGain);
  if (typeof gain !== 'number' || !Number.isFinite(gain)) return 1;
  let f = Math.pow(10, gain / 20);
  // Con ganancia positiva, no pasar del pico del fichero (evita clipping).
  const peak = mode === 'album' ? (rg.albumPeak ?? rg.trackPeak) : (rg.trackPeak ?? rg.albumPeak);
  if (typeof peak === 'number' && peak > 0) f = Math.min(f, 1 / peak);
  // Sujeción de seguridad ante etiquetas disparatadas.
  return Math.min(Math.max(f, 0.05), 4);
}

/** Volumen efectivo (usuario × ReplayGain) para la canción indicada. */
function effectiveVolume(song: Song | null | undefined): number {
  return usePlayerStore.getState().volume * gainFactor(song);
}

// Al cambiar el modo en Ajustes, reaplicar el volumen de la pista que suena
// (fuera de rampas: un fundido en curso converge solo al valor nuevo).
let lastReplayGainMode = useSettings.getState().replayGain;
useSettings.subscribe((s) => {
  if (s.replayGain === lastReplayGainMode) return;
  lastReplayGainMode = s.replayGain;
  if (fadingOut || pauseFadeTimer) return;
  const p = activePlayer();
  if (p) p.volume = effectiveVolume(currentSong(usePlayerStore.getState()));
});

// ── Crossfade ───────────────────────────────────────────────────────────────
// Al acercarse el final de la pista, la siguiente arranca en el player de
// reserva a volumen 0 y ambos volúmenes se cruzan (curva de igual potencia).
// El entrante pasa a ser el activo desde el primer instante: el estado, la
// notificación y el scrobble cambian al empezar el fundido, como en Spotify.

let fadeTimer: ReturnType<typeof setInterval> | null = null;
/** Player saliente mientras hay un fundido en marcha. */
let fadingOut: AudioPlayer | null = null;
/**
 * Datos del crossfade en curso (null si no hay). El progreso se calcula por
 * reloj de pared (`t0`), así que da igual quién dé el paso: el `setInterval`
 * fluido de primer plano o el latido de `onStatus`. Esto último es lo que
 * arregla el crossfade en segundo plano: Android congela los setInterval al
 * minimizar, pero el `playbackStatusUpdate` nativo sigue latiendo, así que la
 * rampa de volumen avanza igual y la entrante no se queda muda a volumen 0.
 */
let fadeState: {
  incoming: AudioPlayer;
  t0: number;
  fadeSec: number;
  outGain: number;
  inGain: number;
} | null = null;

/**
 * Aborta el fundido en curso, si lo hay: silencia y para el saliente y deja
 * el activo a volumen normal. Se llama ante cualquier intervención (cambio de
 * pista manual, seek, pausa, reset, salida remota…) para que el resto del
 * motor opere como si no hubiera crossfade.
 */
function cutCrossfade() {
  // Un traspaso de servidor en marcha también usa el player de reserva y también
  // es una operación que cualquier intervención (cambio de pista, seek, pausa,
  // reset…) debe abortar: pasa por aquí, que es el canal común.
  cancelHandoff();
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  fadeState = null;
  if (pauseFadeTimer) {
    clearInterval(pauseFadeTimer);
    pauseFadeTimer = null;
  }
  // El fundido de sueño también es una rampa en marcha: si el usuario toca algo
  // (pausa, seek, cambio de pista) hay que soltarla, o seguiría bajando el
  // volumen de lo que sea que suene ahora. El vencimiento sigue en pie y
  // `onStatus` lo rearma si aún queda dentro de la ventana.
  clearSleepFade();
  const volume = usePlayerStore.getState().volume;
  if (fadingOut) {
    try {
      fadingOut.pause();
      fadingOut.volume = volume;
    } catch {
      // ignore
    }
    fadingOut = null;
  }
  const p = activePlayer();
  if (p) p.volume = effectiveVolume(currentSong(usePlayerStore.getState()));
}

// ── Traspaso de servidor sin corte ──────────────────────────────────────────
// Al cambiar de servidor (manual o automático por red) la pista en curso apunta
// al host viejo, que puede haber muerto. La vía barata era recargarla en seco
// sobre el player activo: eso deja un silencio audible (el "blip") mientras el
// host nuevo bufferea desde cero. En vez de eso cargamos el stream del host
// nuevo en el player de reserva a volumen 0 y dejamos sonando el viejo de su
// buffer; cuando el nuevo ya suena de verdad lo alineamos con la posición actual
// del viejo y hacemos el cambio instantáneo. Sin fundido a propósito: es la
// misma canción, y cruzar dos posiciones casi iguales sonaría a fase.
//
// Lo mueve el evento NATIVO del propio player de reserva (no un timer), así que
// aguanta en segundo plano, que es donde ocurre el switch automático. Se aborta
// por `cutCrossfade` (cambio de pista, seek, pausa, reset…) y, si el host nuevo
// no arranca a tiempo, cae a la recarga en seco: nunca peor que antes.
let handoffToken = 0;
let handoffReserve: AudioPlayer | null = null;
let handoffSub: { remove: () => void } | null = null;

/** Aborta un traspaso en curso y suelta el player de reserva. */
function cancelHandoff() {
  if (!handoffSub && !handoffReserve) return;
  handoffToken++;
  if (handoffSub) {
    try {
      handoffSub.remove();
    } catch {
      // ignore
    }
    handoffSub = null;
  }
  if (handoffReserve) {
    try {
      handoffReserve.pause();
      handoffReserve.volume = usePlayerStore.getState().volume;
    } catch {
      // ignore
    }
    handoffReserve = null;
  }
}

/** Recarga en seco la pista actual contra la URL activa y vuelve a su posición
 *  (comportamiento clásico; fallback del traspaso y vía para el caso en pausa). */
function hardReload(index: number, sec: number, autoplay: boolean) {
  void (async () => {
    await loadIndex(index, autoplay);
    if (sec > 0) {
      pendingSeek = { sec, at: Date.now() };
      activePlayer()?.seekTo(sec);
      usePlayerStore.setState({ positionSec: sec });
    }
  })();
}

/** Traspaso sin corte de la pista en curso al host activo (ver bloque de arriba). */
function handoffToNewSource(index: number, song: Song, sec: number) {
  cutCrossfade(); // libera el player de reserva y cancela cualquier traspaso previo
  const oldP = activePlayer();
  if (!oldP) {
    hardReload(index, sec, true);
    return;
  }
  // Con stream transcodificado y soporte de timeOffset, el nuevo arranca ya en
  // `sec` (el seek nativo no vale en un transcode al vuelo). Si no, desde 0 y
  // buscamos: acceso aleatorio normal.
  const useOffset = isTranscoded(song) && transcodeOffsetSupported === true;
  const startAt = useOffset ? sec : 0;
  const r = ensurePlayer(1 - activeIdx);
  const token = ++handoffToken;
  handoffReserve = r;
  try {
    r.replace(sourceFor(song, startAt));
    r.loop = usePlayerStore.getState().repeat === 'one';
    r.volume = 0; // inaudible hasta el cambio; el viejo sigue sonando de su buffer
    r.play();
    if (!useOffset && sec > 0) r.seekTo(sec);
  } catch {
    handoffReserve = null;
    hardReload(index, sec, true);
    return;
  }
  let ticks = 0;
  let aligned = false;
  handoffSub = r.addListener('playbackStatusUpdate', (st: AudioStatus) => {
    if (token !== handoffToken) return; // ya cancelado
    ticks += 1;
    const ready = st.playing && st.isLoaded && !st.isBuffering && (st.currentTime ?? 0) > 0;
    if (!ready) {
      // ~6 s (12 ticks de 500 ms): el host nuevo no arranca → recarga en seco.
      if (ticks > 12) {
        cancelHandoff();
        hardReload(index, sec, true);
      }
      return;
    }
    // Primer instante en que el nuevo suena: lo llevamos a donde está AHORA el
    // viejo (ha avanzado mientras cargaba) y esperamos un tick a que llegue, para
    // no repetir ni saltar audio. Con offset el arranque ya cuadra: no se re-pide.
    if (!aligned && !useOffset) {
      aligned = true;
      try {
        r.seekTo(oldP.currentTime ?? sec);
      } catch {
        // ignore
      }
      return;
    }
    // Listo y alineado: cambio instantáneo. Primero volteamos el activo para que
    // el estado lo alimente ya el nuevo; así la pausa del viejo (que emite
    // playing=false) se ignora y no parpadea el botón de play.
    handoffSub?.remove();
    handoffSub = null;
    handoffReserve = null;
    handoffToken += 1;
    try {
      r.volume = effectiveVolume(song);
    } catch {
      // ignore
    }
    activeIdx = 1 - activeIdx;
    streamOffsetSec = useOffset ? startAt : 0;
    try {
      oldP.pause();
      oldP.volume = usePlayerStore.getState().volume;
    } catch {
      // ignore
    }
    usePlayerStore.setState({ isBuffering: false });
    applyLockScreen(r, song);
  });
}

/** Si toca (ajuste activo y quedan ≤ N segundos), arranca el crossfade. */
function maybeStartCrossfade(status: AudioStatus) {
  const fadeSec = useSettings.getState().crossfadeSec;
  // `handoffReserve`: un traspaso de servidor está usando el player de reserva.
  if (fadeSec <= 0 || fadingOut || handoffReserve || !status.playing) return;
  const st = usePlayerStore.getState();
  // Mismos casos que excluye el avance normal, más los que no tienen final
  // predecible (radio) o donde el fundido no pinta nada (pistas muy cortas).
  if (st.repeat === 'one' || st.sleepAtSongEnd) return;
  // Ni durante el fundido de sueño: son dos rampas sobre el mismo volumen, y
  // el crossfade arrancaría la entrante a tope de camino al silencio.
  if (sleepFadeTimer) return;
  const current = st.queue[st.index];
  const duration = st.durationSec;
  if (!current || current.url || duration < fadeSec + 5) return;
  const remaining = duration - (streamOffsetSec + (status.currentTime ?? 0));
  if (remaining <= 0 || remaining > fadeSec) return;
  const ni = nextIndex(false);
  if (ni == null) return;
  const next = st.queue[ni];
  if (!next || next.url) return;
  startCrossfade(ni, Math.min(fadeSec, remaining));
}

function startCrossfade(index: number, fadeSec: number) {
  const st = usePlayerStore.getState();
  const song = st.queue[index];
  if (!song) return;
  const outgoingSong = st.queue[st.index];
  const out = activePlayer();
  const p = ensurePlayer(1 - activeIdx);
  try {
    p.replace(sourceFor(song));
    p.loop = false;
    p.volume = 0;
    p.play();
  } catch {
    return; // sin crossfade: el fin de pista normal hará el cambio
  }
  pushHistory();
  consumeQueuedOnIndexChange(index);
  fadingOut = out;
  activeIdx = 1 - activeIdx;
  streamOffsetSec = 0; // la entrante arranca desde el principio
  scrobbledThisTrack = false;
  usePlayerStore.setState({
    index,
    positionSec: 0,
    durationSec: song.duration ?? 0,
    isPlaying: true,
  });
  applyLockScreen(p, song);
  onTrackChanged(song);
  // Cada extremo del fundido apunta al volumen efectivo de SU canción
  // (ReplayGain por pista); el volumen de usuario se lee vivo en cada tick.
  runFade(p, fadeSec, gainFactor(outgoingSong), gainFactor(song));
}

/**
 * Da un paso del crossfade según el tiempo transcurrido: cruza los volúmenes
 * (curva de igual potencia, la suma se percibe constante) y, al llegar al final,
 * apaga el saliente y cierra el fundido. Es idempotente y sin estado propio, así
 * que lo pueden llamar sin pisarse tanto el `setInterval` de primer plano como
 * el respaldo de `onStatus`.
 */
function tickFade() {
  if (!fadeState) return;
  const { incoming, t0, fadeSec, outGain, inGain } = fadeState;
  const x = Math.min(1, (Date.now() - t0) / (fadeSec * 1000));
  const volume = usePlayerStore.getState().volume;
  const out = fadingOut;
  try {
    if (out) out.volume = volume * outGain * Math.cos((x * Math.PI) / 2);
    incoming.volume = volume * inGain * Math.sin((x * Math.PI) / 2);
  } catch {
    // ignore
  }
  if (x >= 1) {
    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
    if (out) {
      try {
        out.pause();
        out.volume = volume;
      } catch {
        // ignore
      }
    }
    if (fadingOut === out) fadingOut = null;
    fadeState = null;
  }
}

/**
 * Arranca el fundido: `fadingOut` ya lo fijó `startCrossfade`. El `setInterval`
 * de 200 ms mueve la rampa fina en primer plano; en segundo plano se congela y
 * toma el relevo el latido de `onStatus` (ver `fadeState`).
 */
function runFade(
  incoming: AudioPlayer,
  fadeSec: number,
  outGain: number,
  inGain: number,
) {
  if (fadeTimer) clearInterval(fadeTimer);
  fadeState = { incoming, t0: Date.now(), fadeSec, outGain, inGain };
  fadeTimer = setInterval(tickFade, 200);
}

// ── Fundido corto al pausar/reanudar (solo controles dentro de la app) ───────
// Los play/pausa del sistema (notificación, bloqueo, Android Auto, auriculares)
// van por nativo y se quedan instantáneos, que es lo esperable ahí.

const PAUSE_FADE_MS = 180;
let pauseFadeTimer: ReturnType<typeof setInterval> | null = null;

/** Rampa lineal del volumen de `p` de `from` a `to` en PAUSE_FADE_MS; al acabar
 *  llama a `onDone`. Cancela cualquier rampa de pausa/reanudación anterior. */
function fadeVolume(p: AudioPlayer, from: number, to: number, onDone?: () => void) {
  if (pauseFadeTimer) {
    clearInterval(pauseFadeTimer);
    pauseFadeTimer = null;
  }
  const t0 = Date.now();
  pauseFadeTimer = setInterval(() => {
    const x = Math.min(1, (Date.now() - t0) / PAUSE_FADE_MS);
    try {
      p.volume = from + (to - from) * x;
    } catch {
      // ignore
    }
    if (x >= 1) {
      if (pauseFadeTimer) clearInterval(pauseFadeTimer);
      pauseFadeTimer = null;
      onDone?.();
    }
  }, 25);
}

// Tras un seek, el player nativo sigue emitiendo estados con la posición
// antigua hasta que la búsqueda termina; si se dejaran pasar, la UI (slider,
// letra karaoke) rebotaría a la posición vieja y volvería a saltar. Mientras
// el seek está pendiente se mantiene la posición pedida y no se evalúa el
// crossfade (un estado viejo cerca del final lo dispararía en falso).
let pendingSeek: { sec: number; at: number } | null = null;

/** Listener de estado de expo-audio: progreso, play/pausa y fin de pista. */
// ── Detección de servidor caído a mitad de reproducción ─────────────────────
// El motor de red (autoUrl) reacciona a cambios de estado de red y al fallo de
// la query de Inicio, pero si el servidor se cae mientras suena una pista de
// streaming (sin cambiar la red y fuera de Inicio) nada lo notaría. Aquí lo
// detectamos por ATASCO: si una pista que suena por streaming se queda
// buffering sin que avance la posición varios segundos, pedimos un sondeo; si
// de verdad no llega y hay descargas, autoUrl cae a offline solo.
const STALL_PROBE_MS = 6000;
let stallSince = 0;
let stallPos = -1;
let stallProbed = false;

function maybeDetectStall(intendPlay: boolean, buffering: boolean, positionSec: number): void {
  const st = usePlayerStore.getState();
  const song = st.queue[st.index];
  // Solo aplica online y a pistas que salen del servidor por streaming (las
  // descargadas/locales suenan de disco y no dependen del servidor).
  const streamed = !!song && !song.url && !song.localUri && !downloadedUri(song);
  if (useAuthStore.getState().offline || !intendPlay || !streamed || !buffering) {
    stallSince = 0;
    stallProbed = false;
    stallPos = positionSec;
    return;
  }
  // Si la posición avanza, es un rebuffer normal, no un atasco.
  if (Math.abs(positionSec - stallPos) > 0.5) {
    stallSince = 0;
    stallProbed = false;
    stallPos = positionSec;
    return;
  }
  const now = Date.now();
  if (stallSince === 0) {
    stallSince = now;
  } else if (!stallProbed && now - stallSince >= STALL_PROBE_MS) {
    stallProbed = true; // una sola vez por atasco; autoUrl ya reintenta
    checkAutoUrlNow();
  }
}

function onStatus(status: AudioStatus) {
  // Con salida remota (UPnP/DLNA) el player local está en pausa y sus
  // estados no deben pisar los que llegan del aparato remoto.
  if (remoteKind()) return;
  // Respaldo del sleep timer: si el setTimeout quedó congelado en segundo
  // plano, el latido del player nativo lo dispara aquí.
  const endsAt = sleepDeadline();
  if (endsAt && Date.now() >= endsAt) {
    fireSleepTimer();
    return;
  }
  // Mismo respaldo para el fundido: si su timer quedó congelado, o si una
  // intervención lo soltó y el vencimiento sigue dentro de la ventana, el
  // latido del player lo rearma con lo que quede.
  if (endsAt && !sleepFadeTimer) {
    const left = endsAt - Date.now();
    if (left <= SLEEP_FADE_MS) startSleepFade(left);
  }
  // Respaldo del crossfade: su setInterval se congela en segundo plano, pero
  // este latido nativo sigue vivo, así que la rampa de volumen avanza igual y
  // la canción entrante deja de quedarse muda a volumen 0 al minimizar.
  if (fadeState) tickFade();
  const prev = usePlayerStore.getState();
  // Bufferea si queremos reproducir pero el audio aún no fluye (carga inicial,
  // rebuffer en streaming, seek…). Si está en pausa, no es buffering.
  const intendPlay = status.playing || prev.isPlaying;
  const buffering =
    intendPlay && !status.didJustFinish && (status.isBuffering || !status.isLoaded);
  // Con un stream re-pedido con timeOffset, el player nativo cuenta desde 0:
  // la posición real es el offset más su tiempo.
  let positionSec = streamOffsetSec + (status.currentTime ?? 0);
  if (pendingSeek) {
    if (Math.abs(positionSec - pendingSeek.sec) < 1 || Date.now() - pendingSeek.at > 2000) {
      pendingSeek = null; // el player ya alcanzó el destino (o nos rendimos)
    } else {
      positionSec = pendingSeek.sec;
    }
  }
  usePlayerStore.setState({
    positionSec,
    // Con offset activo el nativo reporta la duración del tramo restante, no
    // la de la canción: se conserva la duración conocida.
    durationSec: streamOffsetSec > 0 ? prev.durationSec : status.duration || prev.durationSec,
    // Durante el fundido de pausa/reanudación el player nativo sigue sonando
    // unos ms; mantenemos el estado ya fijado para que el botón no parpadee.
    isPlaying: pauseFadeTimer ? prev.isPlaying : status.playing,
    isBuffering: buffering,
  });
  maybeScrobbleThreshold(positionSec);
  maybeDetectStall(intendPlay, buffering, positionSec);
  // Sincronización de la cola con el servidor.
  if (status.playing) startPeriodicSync();
  else {
    stopPeriodicSync();
    if (prev.isPlaying) scheduleSync(); // acaba de pausar
  }
  if (!pendingSeek) maybeStartCrossfade(status);
  if (status.didJustFinish) {
    if (handleSleepAtSongEnd()) return;
    const ni = nextIndex(false);
    if (ni == null) {
      usePlayerStore.setState({ isPlaying: false });
    } else {
      pushHistory();
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
  cutCrossfade();
  activePlayer()?.pause();
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
  // URL principal (no la activa): así la cola no se pierde al conmutar de red
  // (la URL activa cambia; la principal identifica al perfil). Ver auth store.
  if (auth) {
    const primary = auth.urls?.[0] ?? auth.serverUrl;
    return `resonus.queue.server.${safeKey(primary)}.${safeKey(auth.username)}`;
  }
  return null;
}

interface StoredQueue {
  queue: Song[];
  index: number;
  positionSec: number;
  /** La cola era una radio: al restaurarla debe seguir alargándose sola. */
  radioMode?: boolean;
}

function saveQueueLocal() {
  const key = queueStorageKey();
  if (!key) return;
  const { queue, index, positionSec, radioMode } = usePlayerStore.getState();
  if (queue.length === 0) return;
  // Tope de tamaño por prudencia con SecureStore; 500 canciones dan de sobra.
  const payload: StoredQueue = {
    queue: queue.slice(0, 500),
    index: Math.min(index, 499),
    positionSec,
    radioMode,
  };
  void setItem(key, JSON.stringify(payload));
}

/**
 * Olvida la cola guardada del perfil activo (el usuario la vació adrede).
 * Se guarda una cola vacía en vez de borrar la clave: es la "lápida" que
 * evita que restoreQueue resucite la copia del servidor en el próximo
 * arranque (el servidor no ofrece forma fiable de borrar la suya).
 */
function clearQueueLocal() {
  const key = queueStorageKey();
  if (!key) return;
  const empty: StoredQueue = { queue: [], index: 0, positionSec: 0 };
  void setItem(key, JSON.stringify(empty));
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
 * Engancha los eventos de la salida remota (UPnP/DLNA) a la cola; ver
 * src/store/upnp.ts. Llamar una vez al arrancar.
 */
export function initRemoteIntegration() {
  const events: RemoteEvents = {
    onConnected: () => {
      // Transfiere la pista actual al aparato y silencia el player local.
      const { queue, index, positionSec, isPlaying } = usePlayerStore.getState();
      cutCrossfade();
      try {
        activePlayer()?.pause();
      } catch {
        // ignore
      }
      clearLockScreen();
      if (queue[index]) void remoteLoadIndex(index, isPlaying, positionSec);
    },
    onDisconnected: (lastPositionSec) => {
      // La sesión de medios del casting ya la cierra `upnpDisconnect` (cubre
      // también los cortes silenciosos). Aquí solo volvemos al player local.
      const { queue, index } = usePlayerStore.getState();
      if (!queue[index]) return;
      void (async () => {
        await loadIndex(index, false);
        if (lastPositionSec > 0) {
          pendingSeek = { sec: lastPositionSec, at: Date.now() };
          activePlayer()?.seekTo(lastPositionSec);
        }
        usePlayerStore.setState({ positionSec: lastPositionSec, isPlaying: false });
      })();
    },
    onProgress: (positionSec, durationSec) => {
      usePlayerStore.setState({
        positionSec,
        durationSec: durationSec || usePlayerStore.getState().durationSec,
      });
      maybeScrobbleThreshold(positionSec);
      // Mueve el scrubber de la notificación/bloqueo del casting.
      if (isUpnpConnected()) castSetState(usePlayerStore.getState().isPlaying, positionSec * 1000);
    },
    onPlayingChanged: (isPlaying, isBuffering) => {
      usePlayerStore.setState({ isPlaying, isBuffering });
      if (isPlaying) startPeriodicSync();
      else {
        stopPeriodicSync();
        scheduleSync();
      }
      // Refleja play/pausa en la sesión de medios del casting.
      if (isUpnpConnected()) castSetState(isPlaying, usePlayerStore.getState().positionSec * 1000);
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
  initUpnp(events);
  initJukebox(events);
  // Controles pulsados en la notificación/bloqueo o botones de volumen durante
  // el casting: las acciones del store ya se enrutan al renderer (remoteKind()).
  initCastMedia((action, value) => {
    if (!isUpnpConnected()) return;
    const st = usePlayerStore.getState();
    switch (action) {
      case 'play':
        if (!st.isPlaying) st.toggle();
        break;
      case 'pause':
      case 'stop':
        if (st.isPlaying) st.toggle();
        break;
      case 'next':
        st.next();
        break;
      case 'previous':
        st.previous();
        break;
      case 'seek':
        if (value != null) st.seekTo(value / 1000);
        break;
      case 'volume':
        // El sistema manda +1 / -1 por pulsación; movemos el volumen a pasos.
        st.setVolume(st.volume + (value ?? 0) * 0.05);
        break;
      default:
        break;
    }
  });
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
  /** Cuándo vence el temporizador de sueño (ms epoch), o null si no hay. */
  sleepEndsAt: number | null;
  /** Pausar al terminar la pista actual (temporizador "fin de la canción"). */
  sleepAtSongEnd: boolean;
  /** De dónde salió la cola actual (álbum, lista, artista…), si se conoce. */
  source: string | null;
  /** Ruta del origen para poder navegar a él desde el reproductor. */
  sourceHref: string | null;
  /**
   * La cola es una radio: se alarga sola con parecidas aunque el ajuste de
   * autoplay esté apagado, porque la pediste tú a mano. La enciende
   * `startRadio`; cualquier otra cola (álbum, lista…) la apaga.
   */
  radioMode: boolean;
  playQueue: (
    songs: Song[],
    startIndex?: number,
    source?: string,
    sourceHref?: string,
  ) => Promise<void>;
  /**
   * Arranca una radio a partir de una canción: suena ella ya y la cola se va
   * llenando sola con parecidas, sin fin.
   */
  startRadio: (seed: Song, source: string) => Promise<void>;
  /** Deja de alargar la cola. No la toca: termina cuando termine. */
  stopRadio: () => void;
  addToQueue: (song: Song) => void;
  playNext: (song: Song) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  jumpTo: (index: number) => void;
  /** Quita la canción en `index`. Devuelve la función que la reinserta en su
   *  sitio (para el toast «Deshacer»), salvo al quitar la actual o vaciar. */
  removeAt: (index: number) => Promise<(() => void) | undefined>;
  moveTrack: (from: number, to: number) => void;
  /** Guarda la valoración (1-5; 0 = sin valorar) en las copias de la cola. */
  rateSong: (id: string, rating: number) => void;
  /** Vacía la cola dejando solo la canción actual (sigue sonando). Devuelve
   *  la función que deshace el vaciado (para el toast «Deshacer»), o nada si
   *  no había cola. */
  clearQueue: () => (() => void) | undefined;
  /** Stop de verdad (long-press en play): para y elimina cola, mini player y
   *  notificación. Devuelve la función que lo deshace (cola y posición de
   *  vuelta, en pausa), o nada si no sonaba nada. */
  stopAndClear: () => Promise<(() => void) | undefined>;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setSleepTimer: (minutes: number) => void;
  setSleepAtSongEnd: () => void;
  cancelSleepTimer: () => void;
  /** Restaura la cola guardada en el servidor (sin reproducir). */
  restoreFromServer: () => Promise<void>;
  /** Restaura la cola guardada en este dispositivo (sin reproducir).
   *  Devuelve true si había copia local (aunque fuera una cola vaciada
   *  adrede): en ese caso no debe entrar el respaldo del servidor. */
  restoreFromStorage: () => Promise<boolean>;
  /** Retoma la última cola: primero la copia local; si no hay, la del servidor. */
  restoreQueue: () => Promise<void>;
  /** Recarga la pista en curso contra la URL de servidor activa, conservando
   *  posición y estado de reproducción. Se llama al conmutar de URL de red
   *  (la fuente vieja dejó de responder). No afecta a radio/local/descargadas. */
  reloadCurrent: () => void;
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
  sleepEndsAt: null,
  sleepAtSongEnd: false,
  source: null,
  sourceHref: null,
  radioMode: false,

  playQueue: async (songs, startIndex = 0, source, sourceHref) => {
    if (songs.length === 0) return;
    // Descarta las no disponibles offline (no descargadas): no se pueden
    // reproducir. Se remapea el índice inicial a la canción tocada dentro de la
    // lista ya filtrada. Online nunca se marca `unavailable`, así que no cambia.
    if (songs.some((s) => s.unavailable)) {
      const tapped = songs[startIndex];
      const playable = songs.filter((s) => !s.unavailable);
      if (playable.length === 0) return;
      startIndex = tapped && !tapped.unavailable ? Math.max(0, playable.indexOf(tapped)) : 0;
      songs = playable;
    }
    attachAppState();
    autoplayFetchedFor = null;
    resetWarmed();
    // Antes de saltar a otra lista/álbum, guarda la canción actual en el
    // historial "atrás" para poder volver a ella (estilo Spotify).
    pushHistory();
    // Marca el origen como recién escuchado (orden "Recientes" de Biblioteca).
    if (sourceHref) useLastPlayed.getState().touch(sourceHref);
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
      // Cualquier cola normal apaga la radio; `startRadio` la vuelve a encender.
      radioMode: false,
    });
    await loadIndex(startIndex, true);
  },

  startRadio: async (seed, source) => {
    // Suena la semilla ya y las parecidas se piden después: esperar a que
    // responda el servidor antes de dar al play haría que "iniciar mix" se
    // sintiera roto. `maybeQueueAutoplay` rellena la cola en segundo plano.
    await get().playQueue([seed], 0, source);
    set({ radioMode: true });
    void maybeQueueAutoplay();
  },

  stopRadio: () => {
    set({ radioMode: false });
    saveQueueLocal();
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
    const p = activePlayer();
    if (!p) return;
    // Volumen efectivo de la pista actual (usuario × ReplayGain).
    const vol = effectiveVolume(currentSong(get()));
    if (get().isPlaying) {
      // Pausar en mitad de un fundido corta el saliente: al reanudar debe
      // sonar solo la pista actual, a volumen normal.
      cutCrossfade();
      // Baja el volumen y pausa al acabar; deja el volumen restaurado para que
      // un play posterior (incluido el del sistema/bloqueo) suene normal.
      set({ isPlaying: false });
      fadeVolume(p, vol, 0, () => {
        try {
          p.pause();
          // Reconcilia por si el volumen cambió durante la rampa; así un play
          // posterior (incluido el del sistema/bloqueo) suena al volumen real.
          p.volume = effectiveVolume(currentSong(get()));
        } catch {
          // ignore
        }
        scheduleSync(); // la sincronización "al pausar" que hace onStatus
      });
    } else {
      // Arranca en silencio y sube: fundido de entrada al reanudar.
      try {
        p.volume = 0;
      } catch {
        // ignore
      }
      p.play();
      set({ isPlaying: true });
      fadeVolume(p, 0, vol, () => {
        try {
          p.volume = effectiveVolume(currentSong(get()));
        } catch {
          // ignore
        }
      });
    }
  },

  next: () => {
    const ni = nextIndex(true);
    if (ni != null) {
      pushHistory();
      void loadIndex(ni, true);
    }
  },

  previous: () => {
    const { index, positionSec } = get();
    // Como Spotify: pasados unos segundos, "anterior" reinicia la canción. En
    // modo "always" (estilo YouTube) siempre va a la pista previa, sin reiniciar.
    if (useSettings.getState().previousButtonMode !== 'always' && positionSec > 3) {
      get().seekTo(0);
      return;
    }
    // Vuelve a la canción previa del historial, aunque sea de otra lista/álbum.
    const entry = playedHistory.pop();
    if (entry) {
      set({
        queue: entry.queue,
        index: entry.index,
        source: entry.source,
        sourceHref: entry.sourceHref,
        originalQueue: entry.originalQueue,
        shuffle: entry.shuffle,
        queuedCount: 0,
        positionSec: 0,
        durationSec: 0,
      });
      void loadIndex(entry.index, true);
      return;
    }
    if (index > 0) void loadIndex(index - 1, true);
    else get().seekTo(0);
  },

  seekTo: (sec) => {
    cutCrossfade();
    if (remoteKind()) {
      remoteSeek(sec);
      set({ positionSec: sec });
      return;
    }
    const song = currentSong(get());
    if (song && isTranscoded(song)) {
      // Un stream generado al vuelo no tiene acceso aleatorio: el seek nativo
      // reinicia. Hay que re-pedirlo con `timeOffset`, pero solo si el servidor
      // lo soporta. Esa respuesta se calienta de forma asíncrona al cargar la
      // pista, así que aquí la RESOLVEMOS (no leemos una variable que, con un
      // seek justo tras cargar, aún estaría sin comprobar y nos mandaría al
      // seek nativo → reinicio). Fijamos ya la posición y el pendingSeek para
      // que el slider no rebote mientras se decide.
      pendingSeek = { sec, at: Date.now() };
      set({ positionSec: sec });
      void ensureTranscodeOffsetSupport().then((supported) => {
        // Si mientras se resolvía cambió la pista, no toques el player nuevo.
        if (currentSong(get()) !== song) return;
        const p = activePlayer();
        if (!p) return;
        pendingSeek = { sec, at: Date.now() }; // refresca la ventana de espera
        if (supported) {
          streamOffsetSec = sec;
          try {
            p.replace(sourceFor(song, sec));
            p.volume = effectiveVolume(song);
            if (get().isPlaying) p.play();
          } catch {
            // ignore
          }
        } else {
          // Sin soporte de offset: seek nativo como mejor esfuerzo.
          p.seekTo(sec);
        }
        set({ positionSec: sec });
      });
      return;
    }
    pendingSeek = { sec, at: Date.now() };
    activePlayer()?.seekTo(sec);
    set({ positionSec: sec });
  },

  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    set({ volume });
    if (remoteKind()) remoteSetVolume(volume);
    else if (!fadingOut && !pauseFadeTimer) {
      // En mitad de un fundido (crossfade o pausa/reanudación) no se pisa la
      // rampa: converge sola y el volumen queda restaurado al terminar.
      const p = activePlayer();
      if (p) p.volume = effectiveVolume(currentSong(get()));
    }
  },

  jumpTo: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    // Salto hacia delante como cualquier otro: "anterior" debe poder volver.
    pushHistory();
    void loadIndex(index, true);
  },

  removeAt: async (index) => {
    const { queue, index: cur, queuedCount } = get();
    if (index < 0 || index >= queue.length) return undefined;
    const removed = queue[index];
    const next = queue.filter((_, i) => i !== index);
    if (next.length === 0) {
      clearQueueLocal();
      await get().reset();
      return undefined;
    }
    if (index === cur) {
      // Quitamos la actual: cargamos la que ocupa ahora esa posición. Si era
      // la primera del bloque "en cola", pasa a sonar y queda consumida.
      const newIndex = Math.min(cur, next.length - 1);
      set({ queue: next, index: newIndex, queuedCount: Math.max(0, queuedCount - 1) });
      await loadIndex(newIndex, get().isPlaying);
      scheduleSync();
      return undefined;
    }
    const inQueuedBlock = index > cur && index <= cur + queuedCount;
    set({
      queue: next,
      index: index < cur ? cur - 1 : cur,
      queuedCount: inQueuedBlock ? queuedCount - 1 : queuedCount,
    });
    scheduleSync();
    return () => {
      // Solo si la cola no ha cambiado desde entonces (misma referencia; el
      // avance automático no la sustituye, así que se ajusta el índice).
      const st = get();
      if (st.queue !== next) return;
      const q = [...st.queue];
      q.splice(index, 0, removed);
      set({
        queue: q,
        index: st.index >= index ? st.index + 1 : st.index,
        queuedCount: inQueuedBlock ? st.queuedCount + 1 : st.queuedCount,
      });
      scheduleSync();
    };
  },

  clearQueue: () => {
    const { queue, index, queuedCount, originalQueue, radioMode } = get();
    const current = queue[index];
    if (!current) return undefined;
    // Vaciar apaga también la radio. Si no, quedaba zombi: el autoplay solo se
    // dispara al EMPEZAR una canción, y tras vaciar ya no empieza ninguna, así
    // que el icono decía "radio activa" en una radio que nunca iba a alargarse.
    set({ queue: [current], index: 0, queuedCount: 0, originalQueue: null, radioMode: false });
    scheduleSync();
    return () => {
      // Solo si la cola sigue como la dejó el vaciado (no se pisa nada nuevo).
      const st = get();
      if (st.queue.length !== 1 || st.queue[0]?.id !== current.id) return;
      set({ queue, index, queuedCount, originalQueue, radioMode });
      scheduleSync();
    };
  },

  stopAndClear: async () => {
    const {
      queue,
      index,
      positionSec,
      queuedCount,
      originalQueue,
      shuffle,
      source,
      sourceHref,
      radioMode,
    } = get();
    if (queue.length === 0) return undefined;
    // Parada deliberada: se olvida también la copia guardada, para que la
    // cola no reaparezca al reabrir la app.
    clearQueueLocal();
    await get().reset();
    return () => {
      void (async () => {
        // Solo si no se ha puesto nada nuevo a sonar mientras tanto.
        if (get().queue.length > 0) return;
        attachAppState();
        set({
          queue,
          index,
          positionSec,
          durationSec: queue[index]?.duration ?? 0,
          isPlaying: false,
          queuedCount,
          originalQueue,
          shuffle,
          source,
          sourceHref,
          radioMode,
        });
        // Como al restaurar la cola guardada: pista cargada, en pausa.
        await loadIndex(index, false);
        if (positionSec > 0) {
          pendingSeek = { sec: positionSec, at: Date.now() };
          activePlayer()?.seekTo(positionSec);
        }
        usePlayerStore.setState({ positionSec, isPlaying: false });
        scheduleSync();
      })();
    };
  },

  rateSong: (id, rating) => {
    const patch = (list: Song[]) =>
      list.map((s) => (s.id === id ? { ...s, userRating: rating } : s));
    const { queue, originalQueue } = get();
    set({
      queue: patch(queue),
      originalQueue: originalQueue ? patch(originalQueue) : null,
    });
    // Refleja la nota en las listas ya cargadas (álbum, playlist, favoritos,
    // búsqueda): todas exponen `songs: Song[]`. Parche optimista en la caché de
    // React Query para que el cambio se vea al momento sin re-pedir al servidor.
    queryClient.setQueriesData({ predicate: () => true }, (data: unknown) => {
      if (!data || typeof data !== 'object') return data;
      const songs = (data as { songs?: Song[] }).songs;
      if (!Array.isArray(songs) || !songs.some((s) => s.id === id)) return data;
      return { ...data, songs: patch(songs) };
    });
  },

  moveTrack: async (from, to) => {
    const { queue, index, queuedCount } = get();
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
    // El bloque "en cola" (index+1..index+queuedCount) se mantiene al reordenar
    // dentro de lo que viene: si una del origen entra en la zona de cola pasa a
    // estar encolada, y si una encolada sale deja de estarlo (estilo Spotify).
    // Cualquier movimiento que toque la actual o lo ya reproducido lo disuelve.
    let newQueuedCount = 0;
    if (from > index && to > index) {
      const fromQueued = from - (index + 1) < queuedCount;
      const toQueued = to - (index + 1) < queuedCount;
      newQueuedCount = Math.max(
        0,
        queuedCount + (!fromQueued && toQueued ? 1 : 0) - (fromQueued && !toQueued ? 1 : 0),
      );
    }
    set({ queue: next, index: newIndex, queuedCount: newQueuedCount });
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
    // Primer toque: repetir la canción actual ('one'); segundo: toda la cola
    // ('all'); tercero: apagado. Como Feishin.
    const order: RepeatMode[] = ['off', 'one', 'all'];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat });
    const p = activePlayer();
    if (p) p.loop = repeat === 'one';
  },

  setSleepTimer: (minutes) => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = setTimeout(fireSleepTimer, minutes * 60_000);
    armSleepFade(minutes * 60_000);
    set({ sleepEndsAt: Date.now() + minutes * 60_000, sleepAtSongEnd: false });
  },

  setSleepAtSongEnd: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    // Sin fundido: la canción acaba sola, y bajarle el final sería estropear
    // justo lo que se ha pedido oír entero.
    abortSleepFade();
    set({ sleepEndsAt: null, sleepAtSongEnd: true });
  },

  cancelSleepTimer: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    abortSleepFade();
    set({ sleepEndsAt: null, sleepAtSongEnd: false });
  },

  restoreFromServer: async () => {
    const { auth, offline } = useAuthStore.getState();
    if (!auth || offline || get().queue.length > 0) return;
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
      // La cola del servidor es Subsonic puro: no tiene dónde llevar esto, así
      // que una radio recuperada desde ahí deja de serlo. La copia local sí lo
      // guarda, y es la que se intenta primero (ver `restoreQueue`).
      radioMode: false,
    });
    // Cargamos la pista (sin reproducir) y dejamos la posición lista.
    await loadIndex(index, false);
    if (positionSec > 0) {
      pendingSeek = { sec: positionSec, at: Date.now() };
      activePlayer()?.seekTo(positionSec);
    }
    usePlayerStore.setState({ positionSec, isPlaying: false });
  },

  restoreFromStorage: async () => {
    const key = queueStorageKey();
    if (!key || get().queue.length > 0) return true;
    let saved: StoredQueue | null = null;
    try {
      const raw = await getItem(key);
      saved = raw ? (JSON.parse(raw) as StoredQueue) : null;
    } catch {
      return false;
    }
    if (!saved || !Array.isArray(saved.queue)) return false;
    // Cola vacía guardada = el usuario la vació adrede: no hay nada que
    // restaurar, pero tampoco debe entrar el respaldo del servidor.
    if (saved.queue.length === 0) return true;
    // Si entre tanto ya se empezó a reproducir algo, no pisamos la cola.
    if (get().queue.length > 0) return true;
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
      // Si era una radio, sigue siéndolo: cerrar la app no debería dejarla
      // muda al llegar al final de lo que ya había encolado.
      radioMode: saved.radioMode === true,
    });
    await loadIndex(index, false);
    if (positionSec > 0) {
      pendingSeek = { sec: positionSec, at: Date.now() };
      activePlayer()?.seekTo(positionSec);
    }
    usePlayerStore.setState({ positionSec, isPlaying: false });
    return true;
  },

  restoreQueue: async () => {
    // La copia local es la más fiel (incluye descargas, radios y el modo
    // offline); la del servidor queda de respaldo para sesiones nuevas —
    // salvo que la copia local diga que la cola se vació adrede.
    const handled = await get().restoreFromStorage();
    if (!handled && get().queue.length === 0) await get().restoreFromServer();
  },

  reloadCurrent: () => {
    const { queue, index, positionSec, isPlaying } = get();
    const song = queue[index];
    // Radio (url propia), local y descargadas suenan igual pase lo que pase:
    // su fuente no depende de la URL de servidor.
    if (!song || song.url || song.localUri || downloadedUri(song)) return;
    // El cast (UPnP) lleva su propia sesión; no lo tocamos.
    if (remoteKind()) return;
    // En pausa no hay audio que preservar: recarga en seco, más simple y segura.
    // Sonando, traspaso sin corte contra el host nuevo (ver `handoffToNewSource`).
    if (isPlaying) handoffToNewSource(index, song, positionSec);
    else hardReload(index, positionSec, false);
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
    if (remoteKind() === 'upnp') void upnpDisconnect(true);
    else if (remoteKind() === 'jukebox') void jukeboxDisconnect(true);
    cutCrossfade();
    try {
      activePlayer()?.pause();
    } catch {
      // ignore
    }
    clearLockScreen();
    playedHistory = [];
    streamOffsetSec = 0;
    scrobbledThisTrack = false;
    // El soporte de timeOffset es por servidor: se re-comprueba al cambiar.
    transcodeOffsetSupported = null;
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
      radioMode: false,
    });
  },
}));
