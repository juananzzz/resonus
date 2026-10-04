/**
 * Loading skeleton for album/playlist screens (Spotify style): gray blocks
 * with a header and row silhouettes, softly pulsing, instead of a spinner
 * over an empty screen.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, themed } from '@/theme';
import { motion } from '@/theme/motion';
import { useScreenSize } from '@/hooks/useScreenSize';
import { BackButton } from './BackButton';

// Same top bar as TrackListView so the skeleton → content transition doesn't
// jump. The cover is the same size too, and worked out the same way: measured
// while rendering, or the placeholder is the size of a screen nobody is
// looking at any more (#131).
const TOPBAR_H = 48;

export function TrackListSkeleton() {
  const insets = useSafeAreaInsets();
  const { width, height } = useScreenSize();
  const cover = Math.round(Math.min(width * 0.58, height * 0.4, 250));
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.45, { duration: motion.duration.pulse }), -1, true));
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <View style={styles.root}>
      {/* Outside the pulse: if the screen never finishes loading — a stale
          link, a server that doesn't answer — this is the way out. */}
      <BackButton />
      <Animated.View
        style={[styles.content, { paddingTop: insets.top + TOPBAR_H + spacing.md }, pulseStyle]}
      >
        <View style={styles.coverWrap}>
          <View style={[styles.cover, { width: cover, height: cover }]} />
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

// See `AlbumRowsSkeleton` for why `block` lives inside the factory.
const styles = themed((colors) => {
  const block = { backgroundColor: colors.surfaceHighlight, borderRadius: radius.sm } as const;
  return {
    root: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.lg },
    coverWrap: { alignItems: 'center', marginBottom: spacing.lg },
    cover: { ...block, borderRadius: radius.md },
    title: { ...block, height: 24, width: '60%', marginBottom: spacing.md },
    meta: { ...block, height: 12, width: '35%' },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: spacing.lg,
    },
    actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    smallCircle: { ...block, width: 26, height: 26, borderRadius: radius.pill },
    playCircle: { ...block, width: 56, height: 56, borderRadius: radius.pill },
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
  };
});
