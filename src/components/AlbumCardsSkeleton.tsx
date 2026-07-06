/**
 * Esqueleto de carga para cuadrículas y carruseles de álbumes: bloques grises
 * con la silueta de la carátula y dos líneas de texto, pulsando suave. En fila
 * (carrusel del inicio) o en rejilla que envuelve (Explorar / Género), con el
 * mismo tamaño que AlbumCard para que no salte al llegar el contenido.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';

interface Props {
  /** Ancho de cada tarjeta (= al de AlbumCard para que no salte). */
  width?: number;
  count?: number;
  /** Carrusel horizontal (inicio) en vez de rejilla que envuelve. */
  horizontal?: boolean;
}

export function AlbumCardsSkeleton({ width = 150, count = 6, horizontal }: Props) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.wrap, horizontal ? styles.row : styles.grid, pulseStyle]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width }}>
          <View style={[styles.cover, { width, height: width }]} />
          <View style={styles.title} />
          <View style={styles.sub} />
        </View>
      ))}
    </Animated.View>
  );
}

const block = { backgroundColor: colors.surfaceHighlight } as const;

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cover: { ...block, borderRadius: radius.md },
  title: { ...block, height: 12, width: '85%', borderRadius: radius.sm, marginTop: spacing.sm },
  sub: { ...block, height: 10, width: '55%', borderRadius: radius.sm, marginTop: spacing.xs },
});
