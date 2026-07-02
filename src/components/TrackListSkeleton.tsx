/**
 * Esqueleto de carga para las pantallas de álbum/playlist (estilo Spotify):
 * bloques grises con la silueta de la cabecera y las filas, pulsando suave,
 * en lugar de un spinner sobre pantalla vacía.
 */
import { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/theme';

// Misma carátula y barra superior que TrackListView para que la transición
// esqueleto → contenido no salte.
const COVER = Math.min(Dimensions.get('window').width * 0.58, 250);
const TOPBAR_H = 48;

export function TrackListSkeleton() {
  const insets = useSafeAreaInsets();
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.root}>
      <Animated.View
        style={[styles.content, { paddingTop: insets.top + TOPBAR_H + spacing.md }, pulseStyle]}
      >
        <View style={styles.coverWrap}>
          <View style={styles.cover} />
        </View>
        <View style={styles.title} />
        <View style={styles.meta} />
        <View style={styles.actions}>
          <View style={styles.actionsLeft}>
            <View style={styles.smallCircle} />
            <View style={styles.smallCircle} />
          </View>
          <View style={styles.playCircle} />
        </View>
        {Array.from({ length: 7 }, (_, i) => (
          <View key={i} style={styles.row}>
            <View style={styles.rowArt} />
            <View style={styles.rowInfo}>
              <View style={[styles.bar, { width: '65%' }]} />
              <View style={[styles.bar, styles.barThin, { width: '40%' }]} />
            </View>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const block = { backgroundColor: colors.surfaceHighlight, borderRadius: radius.sm } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg },
  coverWrap: { alignItems: 'center', marginBottom: spacing.lg },
  cover: { ...block, width: COVER, height: COVER, borderRadius: radius.md },
  title: { ...block, height: 24, width: '60%', marginBottom: spacing.md },
  meta: { ...block, height: 12, width: '35%' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.lg,
  },
  actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  smallCircle: { ...block, width: 26, height: 26, borderRadius: 13 },
  playCircle: { ...block, width: 56, height: 56, borderRadius: 28 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowArt: { ...block, width: 44, height: 44 },
  rowInfo: { flex: 1, gap: spacing.sm },
  bar: { ...block, height: 12 },
  barThin: { height: 8 },
});
