/**
 * Puente JS ↔ módulo nativo `CarAuto` (Android Auto / Automotive OS).
 *
 * El módulo nativo mantiene UNA MediaLibrarySession (Media3) que da los
 * controles del coche y el árbol navegable. Desde JS:
 *  - `setNodes` empuja el árbol de navegación (root → álbumes/artistas/…).
 *  - `setNowPlaying`/`setQueue`/`setQueueIndex`/`setPlaybackState` mantienen la
 *    sesión del coche sincronizada con la reproducción real.
 *  - `onPlay` se dispara cuando se toca una hoja reproducible en el coche.
 *  - `onTransport` se dispara con los botones de transporte (play/pausa/next…).
 *
 * En plataformas sin el módulo (web, iOS) todo es no-op.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const native = requireOptionalNativeModule('CarAuto');

export const carAutoAvailable = !!native;

/** Nodo del árbol de navegación que se muestra en el coche. */
export interface CarNode {
  id: string;
  title: string;
  subtitle?: string;
  /** http(s) → la descarga el host; file:// → se embebe; data: no soportada. */
  artworkUrl?: string;
  /** true = hoja reproducible; false = carpeta navegable. */
  playable: boolean;
  /** Cómo dibujar los hijos de un navegable: "list" | "grid". */
  contentStyle?: 'list' | 'grid';
}

/** Árbol: mapa de parentId → hijos. La raíz es la clave "root". */
export interface CarTree {
  nodes: Record<string, CarNode[]>;
}

export interface CarTrack {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationMs?: number;
}

export type TransportEvent =
  | { action: 'play' | 'pause' | 'next' | 'previous' }
  | { action: 'seek'; value: number } // ms
  | { action: 'seekToIndex'; value: number }
  | { action: 'shuffle'; value: number } // 1/0
  | { action: 'repeat'; value: 'off' | 'all' | 'one' };

export interface PlayEvent {
  mediaId: string;
  parentId?: string;
}

export function setNodes(tree: CarTree): void {
  native?.setNodes(JSON.stringify(tree));
}

export function setNowPlaying(track: CarTrack | null): void {
  native?.setNowPlaying(track ? JSON.stringify(track) : null);
}

export function setQueue(tracks: CarTrack[], currentIndex: number): void {
  native?.setQueue(JSON.stringify({ tracks, currentIndex }));
}

export function setQueueIndex(index: number): void {
  native?.setQueueIndex(index);
}

export function setPlaybackState(state: {
  isPlaying: boolean;
  positionMs: number;
  shuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
}): void {
  native?.setPlaybackState(JSON.stringify(state));
}

export function onPlay(cb: (e: PlayEvent) => void): { remove: () => void } | undefined {
  return native?.addListener('play', cb);
}

export function onTransport(cb: (e: TransportEvent) => void): { remove: () => void } | undefined {
  return native?.addListener('transport', cb);
}
