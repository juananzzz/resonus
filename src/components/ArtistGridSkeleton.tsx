/**
 * Loading skeleton for artist grids: circles with a single line of text below,
 * softly pulsing, at the same size as real cards (`ArtistCard`) so the
 * transition doesn't jump.
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

export function ArtistGridSkeleton({ width, count = 12 }: { width: number; count?: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.45, { duration: motion.duration.pulse }), -1, true));
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <Animated.View style={[styles.grid, pulseStyle]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.card, { width }]}>
          <View style={[styles.block, { width, height: width, borderRadius: radius.pill }]} />
          <View style={[styles.bar, { width: width * 0.7 }]} />
        </View>
      ))}
    </Animated.View>
  );
}

// See `AlbumRowsSkeleton` for why `block` lives inside the factory.
const styles = themed((colors) => {
  const block = { backgroundColor: colors.surfaceHighlight } as const;
  return {
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    card: { alignItems: 'center', gap: spacing.xs },
    block,
    bar: { ...block, height: 12, borderRadius: radius.sm, marginTop: spacing.xs },
  };
});
