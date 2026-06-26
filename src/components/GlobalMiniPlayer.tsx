/**
 * MiniPlayer global: se muestra en TODAS las pantallas (no solo en las
 * pestañas), igual que en Spotify. Se posiciona encima de la barra de
 * pestañas cuando estamos en ellas, y al fondo en el resto de pantallas.
 * Se oculta en los modales a pantalla completa (reproductor y cola).
 */
import { useSegments } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, TAB_BAR_HEIGHT } from '@/theme';
import { MiniPlayer } from './MiniPlayer';

export function GlobalMiniPlayer() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const root = segments[0];

  // Oculto sobre los modales a pantalla completa.
  if (root === 'player' || root === 'queue' || root === 'lyrics') return null;

  const inTabs = root === '(tabs)' || root === undefined;
  const bottom = inTabs
    ? TAB_BAR_HEIGHT + insets.bottom
    : insets.bottom + spacing.sm;

  return (
    <View
      style={{ position: 'absolute', left: 0, right: 0, bottom }}
      pointerEvents="box-none"
    >
      <MiniPlayer />
    </View>
  );
}
