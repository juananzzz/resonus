/**
 * Loading skeleton for album grids and carousels: gray blocks with a cover
 * art silhouette and two lines of text, softly pulsing. In a row (home
 * carousel) or wrapping grid (Explore / Genre), at the same size as AlbumCard
 * so the layout doesn't jump when content arrives.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { radius, spacing, themed } from '@/theme';
import { motion } from '@/theme/motion';

interface Props {
  /** Width of each card (= AlbumCard's so the layout doesn't jump). */
  width?: number;
  count?: number;
  /** Horizontal carousel (home) instead of wrapping grid. */
  horizontal?: boolean;
}

export function AlbumCardsSkeleton({ width = 150, count = 6, horizontal }: Props) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.45, { duration: motion.duration.pulse }), -1, true));
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

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

// See `AlbumRowsSkeleton` for why `block` lives inside the factory.
const styles = themed((colors) => {
  const block = { backgroundColor: colors.surfaceHighlight } as const;
  return {
    wrap: { paddingHorizontal: spacing.lg },
    row: { flexDirection: 'row', gap: spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    cover: { ...block, borderRadius: radius.md },
    title: { ...block, height: 12, width: '85%', borderRadius: radius.sm, marginTop: spacing.sm },
    sub: { ...block, height: 10, width: '55%', borderRadius: radius.sm, marginTop: spacing.xs },
  };
});
