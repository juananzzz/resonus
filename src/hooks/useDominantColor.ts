/**
 * Extrae un color de fondo a partir de la carátula (color dominante) y lo
 * normaliza a un tono oscuro y agradable: se recorta la saturación (para que no
 * salga un neón) y la luminosidad a un rango medio-oscuro, de forma que el texto
 * blanco y los controles siempre se lean bien, sea cual sea la portada. Es lo
 * que hacen Spotify/Apple Music con el color de la carátula.
 */
import { useEffect, useState } from 'react';
import { getColors } from 'react-native-image-colors';

import { colors as theme } from '@/theme';

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

/** Recorta saturación y luminosidad a un rango oscuro legible. */
function normalize(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return hslToHex(h, Math.min(s, 0.55), Math.min(Math.max(l, 0.2), 0.32));
}

export function useDominantColor(uri?: string): string {
  const [color, setColor] = useState<string>(theme.surfaceHighlight);

  useEffect(() => {
    let active = true;
    if (!uri) {
      setColor(theme.surfaceHighlight);
      return;
    }
    getColors(uri, { fallback: theme.surfaceHighlight, cache: true, key: uri })
      .then((res) => {
        if (!active) return;
        let c: string = theme.surfaceHighlight;
        // Preferimos un tono vivo y lo oscurecemos en `normalize`; así conserva
        // el carácter de la portada sin quedar apagado ni demasiado claro.
        if (res.platform === 'android') {
          c = res.vibrant || res.darkVibrant || res.muted || res.dominant || c;
        } else if (res.platform === 'ios') {
          c = res.background || res.primary || res.secondary || c;
        } else if (res.platform === 'web') {
          c = res.vibrant || res.darkVibrant || res.dominant || c;
        }
        setColor(normalize(c));
      })
      .catch(() => {
        if (active) setColor(theme.surfaceHighlight);
      });
    return () => {
      active = false;
    };
  }, [uri]);

  return color;
}
