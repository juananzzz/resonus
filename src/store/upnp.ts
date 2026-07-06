/**
 * Integración con renderers UPnP/DLNA (módulo nativo modules/upnp-cast).
 *
 * La cola vive en el store del player y aquí solo se gestiona la sesión
 * (aparato elegido) y los eventos de vuelta. El módulo nativo sondea el estado
 * del renderer cada segundo; el fin de pista se deduce de un STOPPED cerca del
 * final (UPnP no distingue "terminó" de "lo pararon").
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { create } from 'zustand';

import { streamUrl, type Song } from '@/api/backend';
import { useAuthStore } from './auth';
import { useSettings } from './settings';

/** Eventos que el player registra para reaccionar a la salida remota (UPnP). */
export interface RemoteEvents {
  /** Sesión iniciada: transferir la pista actual al renderer. */
  onConnected: () => void;
  /** Sesión terminada: volver al player local en esta posición. */
  onDisconnected: (lastPositionSec: number) => void;
  onProgress: (positionSec: number, durationSec: number) => void;
  onPlayingChanged: (isPlaying: boolean, isBuffering: boolean) => void;
  /** La pista terminó de forma natural en el renderer. */
  onFinished: () => void;
}

export interface UpnpDevice {
  id: string;
  name: string;
  address: string;
  isTV: boolean;
}

interface UpnpStoreState {
  connected: boolean;
  deviceId: string | null;
  deviceName: string | null;
  /** Renderers vistos en la última búsqueda. */
  devices: UpnpDevice[];
  scanning: boolean;
}

export const useUpnp = create<UpnpStoreState>(() => ({
  connected: false,
  deviceId: null,
  deviceName: null,
  devices: [],
  scanning: false,
}));

interface NativeState {
  playbackState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED' | 'BUFFERING' | 'ERROR';
  positionMs: number;
  durationMs: number;
}

const native = requireOptionalNativeModule('UpnpCast');

export const upnpAvailable = !!native;

let events: RemoteEvents | null = null;
let stateSub: { remove: () => void } | undefined;
let lastPositionSec = 0;
let lastDurationSec = 0;
/** Evita avanzar la cola dos veces por el mismo fin de pista. */
let finishedFired = false;
/** Ignora STOPPED transitorios mientras el renderer carga otra pista. */
let loading = false;

export function isUpnpConnected(): boolean {
  return useUpnp.getState().connected;
}

/** Registra los eventos del player. Llamar una sola vez (desde el player). */
export function initUpnp(ev: RemoteEvents): void {
  events = ev;
}

function onNativeState(e: NativeState) {
  if (!isUpnpConnected()) return;
  const pos = (e.positionMs ?? 0) / 1000;
  const dur = (e.durationMs ?? 0) / 1000;
  if (pos > 0) lastPositionSec = pos;
  if (dur > 0) lastDurationSec = dur;
  switch (e.playbackState) {
    case 'PLAYING':
      loading = false;
      finishedFired = false;
      events?.onProgress(pos, dur || lastDurationSec);
      events?.onPlayingChanged(true, false);
      break;
    case 'BUFFERING':
      events?.onPlayingChanged(true, true);
      break;
    case 'PAUSED':
      events?.onProgress(pos, dur || lastDurationSec);
      events?.onPlayingChanged(false, false);
      break;
    case 'STOPPED':
    case 'IDLE':
      // Fin natural: el renderer paró estando ya cerca del final.
      if (!finishedFired && !loading && lastDurationSec > 0 && lastPositionSec >= lastDurationSec - 3) {
        finishedFired = true;
        events?.onFinished();
      }
      break;
    default:
      break;
  }
}

/** Busca renderers en la red (~5 s) y actualiza la lista del store. */
export async function upnpSearch(): Promise<void> {
  if (!native || useUpnp.getState().scanning) return;
  useUpnp.setState({ scanning: true });
  try {
    const found = (await native.search(5000)) as UpnpDevice[];
    useUpnp.setState({ devices: found });
  } catch {
    // dejamos la lista anterior
  } finally {
    useUpnp.setState({ scanning: false });
  }
}

export async function upnpConnect(device: UpnpDevice): Promise<boolean> {
  if (!native) return false;
  const ok = (await native.connect(device.id)) as boolean;
  if (!ok) return false;
  lastPositionSec = 0;
  lastDurationSec = 0;
  finishedFired = false;
  stateSub?.remove();
  stateSub = native.addListener('state', onNativeState);
  useUpnp.setState({ connected: true, deviceId: device.id, deviceName: device.name });
  events?.onConnected();
  return true;
}

/** Corta la sesión; con silent no avisa al player (p. ej. al pasar a cast). */
export async function upnpDisconnect(silent = false): Promise<void> {
  if (!isUpnpConnected()) return;
  stateSub?.remove();
  stateSub = undefined;
  useUpnp.setState({ connected: false, deviceId: null, deviceName: null });
  try {
    await native?.disconnect();
  } catch {
    // ignore
  }
  if (!silent) events?.onDisconnected(lastPositionSec);
}

/**
 * Carga una pista en el renderer. Devuelve false si no hay sesión o la canción
 * no es casteable (ficheros locales: el renderer no puede alcanzarlos).
 */
export async function upnpLoad(song: Song, autoplay: boolean, startTimeSec = 0): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  const auth = useAuthStore.getState().auth;
  let url: string | undefined;
  if (song.url) url = song.url;
  else if (!song.localUri && auth) url = streamUrl(auth, song.id, useSettings.getState().maxBitRate);
  if (!url) return false;
  loading = true;
  finishedFired = false;
  lastPositionSec = startTimeSec;
  lastDurationSec = song.duration ?? 0;
  const title = [song.title, song.artist].filter(Boolean).join(' — ');
  try {
    const ok = (await native.load(url, title, startTimeSec * 1000)) as boolean;
    // El renderer siempre arranca reproduciendo; si no toca, se pausa al vuelo.
    if (ok && !autoplay) void native.pause();
    if (!ok) loading = false;
    return ok;
  } catch {
    loading = false;
    return false;
  }
}

export async function upnpPlay(): Promise<void> {
  try {
    await native?.play();
  } catch {
    // ignore
  }
}

export async function upnpPause(): Promise<void> {
  try {
    await native?.pause();
  } catch {
    // ignore
  }
}

export async function upnpSeek(sec: number): Promise<void> {
  try {
    await native?.seek(sec * 1000);
  } catch {
    // ignore
  }
}

/** Volumen del renderer; el slider de la app va 0..1 y UPnP usa 0..100. */
export function upnpSetVolume(volume: number): void {
  try {
    void native?.setVolume(Math.round(Math.max(0, Math.min(1, volume)) * 100));
  } catch {
    // ignore
  }
}
