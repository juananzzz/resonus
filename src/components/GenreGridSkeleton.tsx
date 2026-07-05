/**
 * Esqueleto de carga para la rejilla de géneros de Buscar ("Explorar todo"):
 * tarjetas grises pulsando con el mismo tamaño que las reales, en lugar de un
 * hueco vacío mientras llegan del servidor.
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

export function GenreGridSkeleton({ width, count = 14 }: { width: number; count?: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.grid}>
      {Array.from({ length: count }, (_, i) => (
        <Animated.View key={i} style={[styles.card, { width }, pulseStyle]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Mismo alto y radio que GenreCard para que no salte al llegar el contenido.
  card: { height: 88, borderRadius: radius.md, backgroundColor: colors.surfaceHighlight },
});
