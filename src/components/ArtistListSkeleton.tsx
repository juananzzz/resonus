/**
 * Loading skeleton for artist lists: rows with a circular photo and two lines
 * of text, softly pulsing, at the same size as real rows (`ArtistRow`: 56pt
 * round photo) so the transition doesn't jump.
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

export function ArtistListSkeleton({ count = 10 }: { count?: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.45, { duration: motion.duration.pulse }), -1, true));
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

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

// See `AlbumRowsSkeleton` for why `block` lives inside the factory.
const styles = themed((colors) => {
  const block = { backgroundColor: colors.surfaceHighlight } as const;
  return {
    list: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    photo: { ...block, width: 56, height: 56, borderRadius: radius.pill },
    info: { flex: 1, gap: spacing.sm },
    bar: { ...block, height: 12, borderRadius: radius.sm },
    barThin: { height: 8 },
  };
});
