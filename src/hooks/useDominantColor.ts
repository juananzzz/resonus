/**
 * Extracts a background color from the cover art (dominant color) and
 * normalizes it to a pleasant tone: saturation is clamped (to avoid neon) and
 * lightness is clamped to a narrow band, so that text and controls are always
 * legible regardless of the cover art. This is what Spotify/Apple Music do with
 * the cover color.
 *
 * Which band depends on the appearance: medium-dark under the dark theme, pale
 * under the light one. The tint has to be a shade of the page it sits on — a
 * dark tinted bar in the middle of a white app is not a tint, it is a hole —
 * and keeping it on the right side of the line is also what lets every screen
 * using it go on writing over it in the ordinary text colour.
 */
import { useEffect, useState } from 'react';

import { CACHED_COVER, COVER } from '@/api/data';
import { hexToRgb, pickIosColor, rgbToHsl } from '@/lib/colorPick';
import { note } from '@/lib/perfLog';
import { BACKGROUND_TINTS, colors as theme, useThemeMode, type ThemeMode } from '@/theme';

function hslToHex(h: number, s: number, l: number): string {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue(h + 1 / 3);
    g = hue(h);
    b = hue(h - 1 / 3);
  }
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The same hue at another lightness, saturation capped: a cover's colour made
 * into a fill or an ink that reads against the page (the player's controls).
 */
export function toneOf(hex: string, lightness: number, maxSaturation: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return hslToHex(h, Math.min(s, maxSaturation), lightness);
}

/**
 * Clamps saturation and lightness into the readable band for the appearance.
 *
 * The light band is narrower and sits high (0.88–0.94): a pale wash keeps the
 * hue of the cover while leaving black text on it at well over the contrast the
 * dark band gives white text. Saturation is allowed a little further up there
 * because at that lightness a clamp of 0.55 comes out as grey.
 */
/** A colour already read off a cover, brought into another appearance's band:
 *  the same hue, the lightness and saturation the other theme uses. */
export function tintForMode(hex: string, mode: ThemeMode, vivid = false): string {
  return normalize(hex, mode, vivid);
}

function normalize(hex: string, mode: ThemeMode, vivid: boolean): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (mode === 'light') {
    return vivid
      ? hslToHex(h, Math.min(s, 0.8), Math.min(Math.max(l, 0.82), 0.9))
      : hslToHex(h, Math.min(s, 0.7), Math.min(Math.max(l, 0.88), 0.94));
  }
  return vivid
    ? hslToHex(h, Math.min(s, 0.7), Math.min(Math.max(l, 0.28), 0.4))
    : hslToHex(h, Math.min(s, 0.55), Math.min(Math.max(l, 0.2), 0.32));
}

/**
 * Size asked for when the image is only going to be reduced to one colour.
 *
 * `getColors` downloads on its own — it doesn't share expo-image's cache — so
 * asking for the same 500 or 600 px the screen is already showing meant
 * fetching every cover twice at full size. A small copy quantizes to the same
 * colour for a fraction of the bytes.
 *
 * It's also one single size across the app: the player and the mini player had
 * to agree on one already, or the same song came out two different colours on
 * two screens. Now everything reads the same pixels.
 */
const PALETTE_SIZE = COVER.thumb;

/** The same cover, small, when it's a server cover URL — Subsonic asks for
 *  `size`, Jellyfin for `fillWidth`/`fillHeight`. Anything else (local files,
 *  radio art) is left exactly as it is. */
function paletteUri(uri: string): string {
  return uri.replace(/([?&](?:size|fillWidth|fillHeight)=)\d+/g, `$1${PALETTE_SIZE}`);
}

/**
 * The same colour, worked out once and awaited: the palette, the platform's
 * own picker and the band, outside React, for callers the hook cannot reach -
 * the widget's handover runs from the player's store, not from a component,
 * and the radio art reads colours on its way to drawing a file.
 * The plain tint is what comes back when there is no cover to read or it
 * cannot be read, which is also what the hook falls back to.
 */
export async function dominantColorOf(
  uri: string | undefined,
  mode: ThemeMode,
  vivid = false,
): Promise<string> {
  return (await coverColorOf(uri, mode, vivid)) ?? theme.surfaceHighlight;
}

/**
 * `dominantColorOf`, but null when the cover could not be read: the download
 * failed, or (Android) the palette did and every swatch came back as the
 * fallback, which the library would otherwise cache for the session.
 */
export async function coverColorOf(
  uri: string | undefined,
  mode: ThemeMode,
  vivid = false,
): Promise<string | null> {
  // A cover marked as cache-only (offline, see `CACHED_COVER`) is not a URL
  // and is not ours to fetch: `getColors` downloads on its own, so it would
  // be exactly the request offline mode is there to avoid. The tint stays the
  // plain one, which is what a cover nobody can see should look like.
  if (!uri || uri.startsWith(CACHED_COVER)) return null;
  const src = paletteUri(uri);
  // Keyed by the small URL: two screens showing the same cover at different
  // sizes now share one cached palette. `quality` is read on iOS only, where
  // it decides how much of the image is looked at before averaging, and the
  // URL above already brought the cover down to `PALETTE_SIZE`, so there is
  // nothing to save by looking at less than all of it.
  try {
    const { getColors, cache } = await import('react-native-image-colors');
    const fallback = theme.surfaceHighlight;
    const res = await getColors(src, { fallback, cache: true, key: src, quality: 'high' });
    if (!res) return null;
    const swatches = Object.entries(res).filter(
      ([k]) => k !== 'platform' && k !== 'quality' && k !== 'average',
    );
    if (swatches.length > 0 && swatches.every(([, v]) => v === fallback)) {
      cache.removeItem(src);
      return null;
    }
    let c: string = theme.surfaceHighlight;
    if (res.platform === 'android') {
      // A swatch the palette did not find comes back as the fallback: a black
      // and white photo has no vibrant one, and taking it painted it grey.
      const found = [res.vibrant, res.darkVibrant, res.muted, res.dominant, res.average];
      c = found.find((x) => x && x !== fallback) || c;
    } else if (res.platform === 'ios') {
      c = pickIosColor(res.background, res.primary, res.secondary, res.detail) || c;
    } else if (res.platform === 'web') {
      c = res.vibrant || res.darkVibrant || res.dominant || c;
    }
    return normalize(c, mode, vivid);
  } catch {
    // A read that fails leaves the plain tint, which is also what "no accent
    // on this song" looks like — so say which cover it was, with the query
    // (and its secrets) cut off. The next report that carries one of these
    // names the format or the host to fix instead of the picker.
    const tail = src.split('?')[0].split('/').slice(-2).join('/');
    note(`accent unreadable: ${tail}`);
    return null;
  }
}

/** Every plain tint `dominantColorOf` can answer with when a cover could not
 *  be read, in any appearance, background tint and band. */
const PLAIN_TINTS = new Set(
  Object.values(BACKGROUND_TINTS).flatMap(({ dark, light }) =>
    [dark.surfaceHighlight, light.surfaceHighlight].flatMap((c) => [
      c.toLowerCase(),
      ...(['dark', 'light'] as const).flatMap((m) => [
        normalize(c, m, true).toLowerCase(),
        normalize(c, m, false).toLowerCase(),
      ]),
    ]),
  ),
);

/** Whether a colour is the plain tint rather than one read off a cover. */
export function isPlainTint(c: string): boolean {
  return PLAIN_TINTS.has(c.toLowerCase());
}

/**
 * Colours already worked out, by palette URL, appearance and band. Filled as
 * covers are read, so a screen opened again draws its tint on the first frame
 * instead of starting from the plain one and jumping (which `getColors`'s own
 * cache cannot prevent: it answers asynchronously even when it has the answer).
 */
const resolved = new Map<string, string>();

function resolvedKey(src: string, mode: ThemeMode, vivid: boolean): string {
  return `${mode}|${vivid ? 'v' : 'c'}|${src}`;
}

/**
 * The cover's colour, and whether it is known yet. `known` is false only
 * while a cover nobody has read before is being read: a screen can keep its
 * tint out of sight until then and fade it in, rather than paint the plain
 * one first and jump.
 *
 * `vivid` is a brighter, more saturated band for a header that fades into the
 * page, where the colour is behind the title rather than under body text.
 */
export function useCoverTint(uri?: string, vivid = false): { color: string; known: boolean } {
  // Switching appearance re-runs the whole thing: the palette `getColors`
  // returns is cached, so this is a second pass through `normalize` and not a
  // second download.
  const mode = useThemeMode();
  // A cover marked as cache-only (offline, see `CACHED_COVER`) is not a URL
  // and is not ours to fetch: `getColors` downloads on its own, so it would
  // be exactly the request offline mode is there to avoid. The tint stays the
  // plain one, which is what a cover nobody can see should look like.
  const readable = !!uri && !uri.startsWith(CACHED_COVER);
  const src = readable ? paletteUri(uri) : undefined;
  const key = src ? resolvedKey(src, mode, vivid) : undefined;
  const [read, setRead] = useState<{ key: string; color: string } | undefined>(undefined);

  useEffect(() => {
    if (!src || !key || resolved.has(key)) return;
    let active = true;
    // One reader for every caller: `dominantColorOf` does the palette work
    // (and answers with the plain tint when there is no cover to read), and
    // the result lands in the cache this hook is drawn from.
    coverColorOf(src, mode, vivid).then((read) => {
      const c = read ?? theme.surfaceHighlight;
      // A cover that could not be read is not remembered: the next screen
      // that shows it asks again.
      if (read) resolved.set(key, c);
      if (active) setRead({ key, color: c });
    });
    return () => {
      active = false;
    };
  }, [src, key, mode, vivid]);

  if (!key) return { color: theme.surfaceHighlight, known: true };
  const color = resolved.get(key) ?? (read?.key === key ? read.color : undefined);
  return color ? { color, known: true } : { color: theme.surfaceHighlight, known: false };
}

/**
 * The cover's colour (see `useCoverTint`). While a new cover is being read the
 * last colour stays, so the player moving on to the next song eases from one
 * tint to the other instead of passing through the plain one.
 */
export function useDominantColor(uri?: string, vivid = false): string {
  const { color, known } = useCoverTint(uri, vivid);
  const [last, setLast] = useState(color);
  if (known && color !== last) setLast(color);
  return known ? color : last;
}
