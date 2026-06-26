/**
 * Tema visual de Resonus. Estética oscura tipo Spotify con un acento verde.
 * Un único tema oscuro para mantener el MVP sencillo.
 */

export const colors = {
  background: '#121212',
  surface: '#181818',
  surfaceHighlight: '#282828',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textMuted: '#727272',
  accent: '#1DB954',
  accentPressed: '#1AA34A',
  danger: '#E03131',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/** Altura de la barra de pestañas (sin contar el safe-area inferior). */
export const TAB_BAR_HEIGHT = 60;

/**
 * Espacio inferior que dejan las listas para no quedar tapadas por el
 * MiniPlayer flotante + la barra de pestañas.
 */
export const SCREEN_BOTTOM_PADDING = 140;
