/**
 * Loading skeleton for the Search genre grid ("Explore all"): gray pulsing
 * cards at the same size as real ones, instead of an empty gap while data
 * arrives from the server.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { GENRE_CARD_HEIGHT } from '@/components/GenreCard';
import { radius, spacing, themed } from '@/theme';
import { motion } from '@/theme/motion';

export function GenreGridSkeleton({ width, count = 14 }: { width: number; count?: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.45, { duration: motion.duration.pulse }), -1, true));
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <View style={styles.grid}>
      {Array.from({ length: count }, (_, i) => (
        <Animated.View key={i} style={[styles.card, { width }, pulseStyle]} />
      ))}
    </View>
  );
}

const styles = themed((colors) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Same height and border radius as GenreCard so the layout doesn't jump when content arrives.
  card: {
    height: GENRE_CARD_HEIGHT,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceHighlight,
  },
}));
