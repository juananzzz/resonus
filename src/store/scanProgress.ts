/**
 * Progreso del análisis del catálogo local (modo sin conexión). Lo actualizan
 * las funciones de carga de `localLibrary` mientras leen las etiquetas ID3 de
 * cada fichero, para poder mostrar un indicador con cuántas canciones se han
 * analizado en lugar de un spinner indefinido.
 */
import { create } from 'zustand';

interface ScanProgressState {
  scanning: boolean;
  /** Canciones analizadas hasta ahora. */
  count: number;
  /** Total de ficheros a analizar (0 si aún no se sabe). */
  total: number;
  start: (total: number) => void;
  /** Suma `n` canciones analizadas (agrupado para no renderizar por fichero). */
  tick: (n?: number) => void;
  done: () => void;
}

export const useScanProgress = create<ScanProgressState>((set) => ({
  scanning: false,
  count: 0,
  total: 0,
  start: (total) => set({ scanning: true, count: 0, total }),
  tick: (n = 1) => set((s) => ({ count: s.count + n })),
  done: () => set({ scanning: false }),
}));
