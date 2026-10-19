/**
 * Picking the accent from the four colors iOS returns.
 *
 * They come labeled by role, not by vibrancy: `background` is the dominant
 * area of the cover and `primary`, `secondary` and `detail` are the foreground
 * ones in order of how much of the cover they take. Android's side of the
 * same module answers in vibrancy labels (`vibrant`, `darkVibrant`…) instead,
 * so the two platforms can never pick by the same rule — this mapping is the
 * price of one module for both, not a workaround to remove.
 *
 * Pure functions only, so the picker is unit-tested (see
 * `test/colorPick.test.ts`) without dragging the theme or the API layer in
 * behind it.
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

/** Saturation of a hex color in HSL, or -1 if it cannot be read. */
export function saturationOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return -1;
  return rgbToHsl(rgb[0], rgb[1], rgb[2])[1];
}

/**
 * Mixes a hex color toward black by `amount` (0-1): a slightly darker shade
 * of the same hue, for gradients that fall away like a shadow. Unreadable
 * input comes back untouched.
 */
export function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const f = 1 - Math.min(Math.max(amount, 0), 1);
  const to = (v: number) =>
    Math.round(v * f)
      .toString(16)
      .padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

/**
 * The dominant area reads as "the color of this cover", so it wins whenever
 * it carries any color at all; the covers it fails on are the ones whose
 * dominant area is a white border or a black void, and there the foreground
 * colors are all there is. Among those, order beats saturation unless the gap
 * is wide: a small vivid detail should not push aside the color the cover is
 * made of.
 *
 * And a faintly tinted foreground on a monochrome cover is not an accent, it
 * is noise with a hue: gray clouds came back purple, black voids brown. Only
 * a properly saturated foreground may speak for such a cover; otherwise the
 * neutral background — gray, black, white as it is — is the truth.
 */
export function pickIosColor(
  background: string | undefined,
  primary: string | undefined,
  secondary: string | undefined,
  detail: string | undefined,
): string | undefined {
  const NEUTRAL = 0.15;
  const CLEARLY_MORE = 1.5;
  const VIVID = 0.4;

  if (background && saturationOf(background) >= NEUTRAL) return background;

  let best: string | undefined;
  let bestSat = 0;
  for (const hex of [primary, secondary, detail]) {
    if (!hex) continue;
    const s = saturationOf(hex);
    if (s < NEUTRAL) continue;
    if (!best || s >= bestSat * CLEARLY_MORE) {
      best = hex;
      bestSat = s;
    }
  }

  return best && bestSat >= VIVID ? best : background;
}
