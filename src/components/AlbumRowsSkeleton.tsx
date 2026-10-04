/**
 * Loading skeleton for album lists: rows with a square cover and two lines of
 * text, softly pulsing, at the same size as real rows (`AlbumRow`: 56pt cover)
 * so the transition doesn't jump.
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

export function AlbumRowsSkeleton({ count = 10 }: { count?: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.45, { duration: motion.duration.pulse }), -1, true));
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <Animated.View style={[styles.list, pulseStyle]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.cover} />
          <View style={styles.info}>
            <View style={[styles.bar, { width: '55%' }]} />
            <View style={[styles.bar, styles.barThin, { width: '30%' }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

// `block` is built inside the factory, not beside it: outside, it would copy
// the colour once at import and the skeleton would keep the appearance the app
// started in. Same in every skeleton here.
const styles = themed((colors) => {
  const block = { backgroundColor: colors.surfaceHighlight } as const;
  return {
    list: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    // radius.md, which is what `Cover` uses for square cover art.
    cover: { ...block, width: 56, height: 56, borderRadius: radius.md },
    info: { flex: 1, gap: spacing.sm },
    bar: { ...block, height: 12, borderRadius: radius.sm },
    barThin: { height: 8 },
  };
});
