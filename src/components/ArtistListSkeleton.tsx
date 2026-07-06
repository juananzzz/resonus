/**
 * Esqueleto de carga para listas de artistas: filas con foto circular y dos
 * líneas de texto, pulsando suave, con el mismo tamaño que las filas reales
 * (Cover redonda de 52) para que la transición no salte.
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

export function ArtistListSkeleton({ count = 10 }: { count?: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.list, pulseStyle]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.photo} />
          <View style={styles.info}>
            <View style={[styles.bar, { width: '55%' }]} />
            <View style={[styles.bar, styles.barThin, { width: '30%' }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const block = { backgroundColor: colors.surfaceHighlight } as const;

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { ...block, width: 52, height: 52, borderRadius: 26 },
  info: { flex: 1, gap: spacing.sm },
  bar: { ...block, height: 12, borderRadius: radius.sm },
  barThin: { height: 8 },
});
