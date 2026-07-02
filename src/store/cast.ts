/**
 * Integración con Google Cast (Chromecast).
 *
 * La cola sigue viviendo en el store del player: cuando hay sesión de cast,
 * cada pista se manda al Chromecast como URL de stream (el aparato la descarga
 * directamente del servidor) en vez de a expo-audio. Este módulo solo gestiona
 * la sesión y reenvía los eventos (progreso, fin de pista, play/pausa) por los
 * callbacks que registra el player, así la lógica de cola no cambia.
 *
 * La librería nativa se carga con require() perezoso para que la app siga
 * funcionando en web y en móviles sin Google Play Services.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';

import { coverArtUrl, streamUrl, type Song } from '@/api/subsonic';
import { useAuthStore } from './auth';
import { useSettings } from './settings';

type GoogleCastModule = typeof import('react-native-google-cast');
type RemoteMediaClient = import('react-native-google-cast').RemoteMediaClient;
type CastSession = import('react-native-google-cast').CastSession;

interface CastStoreState {
  /** Hay una sesión de cast activa (la salida es el Chromecast). */
  connected: boolean;
  /** Nombre del aparato ("Salón TV") para mostrarlo en el reproductor. */
  deviceName: string | null;
}

export const useCast = create<CastStoreState>(() => ({ connected: false, deviceName: null }));

/** Eventos que el player registra para reaccionar a la sesión de cast. */
export interface CastEvents {
  /** Sesión iniciada: transferir la pista actual al Chromecast. */
  onConnected: () => void;
  /** Sesión terminada: volver al player local en esta posición. */
  onDisconnected: (lastPositionSec: number) => void;
  onProgress: (positionSec: number, durationSec: number) => void;
  onPlayingChanged: (isPlaying: boolean, isBuffering: boolean) => void;
  /** La pista terminó de forma natural en el Chromecast. */
  onFinished: () => void;
}

let cast: GoogleCastModule | null = null;
let client: RemoteMediaClient | null = null;
let session: CastSession | null = null;
let lastPositionSec = 0;
let initialized = false;

export function isCastConnected(): boolean {
  return useCast.getState().connected;
}

/** Engancha los listeners de sesión. Llamar una sola vez (desde el player). */
export function initCast(events: CastEvents): void {
  if (initialized || Platform.OS === 'web') return;
  initialized = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cast = require('react-native-google-cast') as GoogleCastModule;
  } catch {
    return; // sin módulo nativo (web / build sin cast)
  }

  const manager = cast.CastContext.getSessionManager();

  const start = (s: CastSession) => {
    session = s;
    client = new cast!.RemoteMediaClient();
    lastPositionSec = 0;
    void s.getCastDevice().then(
      (d) => useCast.setState({ connected: true, deviceName: d?.friendlyName ?? null }),
      () => useCast.setState({ connected: true, deviceName: null }),
    );
    client.onMediaProgressUpdated((progress, duration) => {
      lastPositionSec = progress;
      events.onProgress(progress, duration);
    }, 1);
    client.onMediaStatusUpdated((st) => {
      if (!st || !st.playerState) return;
      if (st.playerState === 'idle') {
        // `idle` también llega al cargar otra pista (cancelled/interrupted);
        // solo el fin natural avanza la cola.
        if (st.idleReason === 'finished') events.onFinished();
        return;
      }
      events.onPlayingChanged(
        st.playerState === 'playing',
        st.playerState === 'buffering' || st.playerState === 'loading',
      );
    });
    events.onConnected();
  };

  const end = () => {
    client = null;
    session = null;
    useCast.setState({ connected: false, deviceName: null });
    events.onDisconnected(lastPositionSec);
  };

  manager.onSessionStarted(start);
  manager.onSessionResumed(start);
  manager.onSessionEnded(end);
}

/**
 * Carga una pista en el Chromecast. Devuelve false si no hay sesión o la
 * canción no es casteable (ficheros locales: el aparato no puede alcanzarlos).
 */
export async function castLoad(song: Song, autoplay: boolean, startTimeSec = 0): Promise<boolean> {
  if (!client) return false;
  const auth = useAuthStore.getState().auth;
  let url: string | undefined;
  if (song.url) url = song.url;
  else if (!song.localUri && auth) url = streamUrl(auth, song.id, useSettings.getState().maxBitRate);
  if (!url) return false;

  const coverUrl = !song.url && auth ? coverArtUrl(auth, song.coverArt ?? song.albumId, 500) : undefined;
  try {
    await client.loadMedia({
      autoplay,
      startTime: startTimeSec,
      mediaInfo: {
        contentUrl: url,
        streamType: (song.url ? 'live' : 'buffered') as import('react-native-google-cast').MediaStreamType,
        streamDuration: song.duration,
        metadata: {
          type: 'musicTrack',
          title: song.title,
          artist: song.artist,
          albumTitle: song.album,
          images: coverUrl ? [{ url: coverUrl }] : [],
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function castPlay(): Promise<void> {
  try {
    await client?.play();
  } catch {
    // ignore
  }
}

export async function castPause(): Promise<void> {
  try {
    await client?.pause();
  } catch {
    // ignore
  }
}

export async function castSeek(sec: number): Promise<void> {
  try {
    await client?.seek({ position: sec });
  } catch {
    // ignore
  }
}

/** Volumen del aparato (0..1); es lo que el usuario espera al mover el slider. */
export function castSetVolume(volume: number): void {
  try {
    session?.setVolume(volume);
  } catch {
    // ignore
  }
}

/** Detiene la reproducción remota (al hacer reset/cambiar de perfil). */
export async function castStop(): Promise<void> {
  try {
    await client?.stop();
  } catch {
    // ignore
  }
}
