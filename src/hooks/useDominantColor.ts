/** Extrae un color de fondo a partir de la carátula (color dominante). */
import { useEffect, useState } from 'react';
import { getColors } from 'react-native-image-colors';

import { colors as theme } from '@/theme';

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
        // Preferimos tonos oscuros para que el texto blanco se lea bien.
        if (res.platform === 'android') {
          c = res.darkVibrant || res.darkMuted || res.dominant || c;
        } else if (res.platform === 'ios') {
          c = res.background || res.secondary || c;
        } else if (res.platform === 'web') {
          c = res.darkVibrant || res.dominant || c;
        }
        setColor(c);
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
