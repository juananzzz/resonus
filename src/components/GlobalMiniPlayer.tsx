/**
 * MiniPlayer global: se muestra en TODAS las pantallas (no solo en las
 * pestañas), igual que en Spotify. Se posiciona encima de la barra de
 * pestañas cuando estamos en ellas, y al fondo en el resto de pantallas.
 * En los modales a pantalla completa (reproductor, cola, letras) se desvanece
 * en vez de desaparecer de golpe, para que no parpadee mientras sube el modal.
 */
import { useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, TAB_BAR_HEIGHT } from '@/theme';
import { MiniPlayer } from './MiniPlayer';

export function GlobalMiniPlayer() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const root = segments[0];

  const visible = !(root === 'player' || root === 'queue' || root === 'lyrics');
  const inTabs = root === '(tabs)' || root === undefined;
  const bottom = inTabs ? TAB_BAR_HEIGHT + insets.bottom : insets.bottom + spacing.sm;

  // Conserva la última posición visible para que no salte mientras se desvanece
  // al abrir un modal a pantalla completa.
  const lastBottom = useRef(bottom);
  if (visible) lastBottom.current = bottom;

  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  return (
    <Animated.View
      style={{ position: 'absolute', left: 0, right: 0, bottom: lastBottom.current, opacity }}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      <MiniPlayer />
    </Animated.View>
  );
}
