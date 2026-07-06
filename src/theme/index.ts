/**
 * Tema visual de Resonus. Estética oscura tipo Spotify; el único color
 * configurable es el acento (elegible en Ajustes → Theme). El acento se muta en
 * caliente con `applyAccent`; los usos inline lo cogen al re-renderizar.
 */

/** Acento por defecto (verde Spotify). */
export const DEFAULT_ACCENT = '#1DB954';

export const colors = {
  background: '#121212',
  surface: '#181818',
  surfaceHighlight: '#282828',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textMuted: '#727272',
  accent: DEFAULT_ACCENT,
  accentPressed: '#1AA34A',
  danger: '#E03131',
};

/** Oscurece un hex (por defecto ~14%) para el estado "pressed". */
function darken(hex: string, amount = 0.14): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (c: number) => Math.round(c * (1 - amount));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  const to = (x: number) => x.toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Cambia el acento en caliente (accent + su tono "pressed"). */
export function applyAccent(hex: string): void {
  colors.accent = hex;
  colors.accentPressed = darken(hex);
}

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
