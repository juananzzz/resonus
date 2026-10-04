/**
 * The little bars that say which row is the one you are hearing.
 *
 * A list already tints that row's title with the accent, which says "this
 * one" but not "this one, right now". The bars move while it plays and settle
 * while it is paused, so a glance at the list answers both questions — and
 * they are what everybody else in the genre uses for it, so nobody has to be
 * taught what they mean.
 *
 * Only ever one of these on screen at a time (one row of a list is current),
 * so the four looping animations are not a list's worth of work.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useAccent } from '@/hooks/useAccent';
import { usePlayerStore } from '@/store/player';
import { radius } from '@/theme';
import { motion } from '@/theme/motion';

/**
 * One period each, and none of them a multiple of another: bars that share a
 * period fall into step after a cycle or two and start reading as one block
 * going up and down. The stagger below only keeps them apart until then. The
 * slowest is the app's own pulse, the one the placeholders breathe at.
 */
const DURATIONS = [430, 610, 500, motion.duration.pulse] as const;
const STAGGER = 90;
/** How low a bar sits when nothing is playing, as a fraction of the height. */
const REST = 0.22;

function Bar({ index, playing, color }: { index: number; playing: boolean; color: string }) {
  const height = useSharedValue(REST);

  useEffect(() => {
    cancelAnimation(height);
    if (!playing) {
      // Down to the resting height rather than frozen mid-rise: a paused row
      // showing bars stopped at random heights looks like it is still going.
      height.set(withTiming(REST, { duration: motion.duration.move }));
      return;
    }
    height.set(withDelay(
      index * STAGGER,
      withRepeat(
        withTiming(1, { duration: DURATIONS[index], easing: motion.easing.loop }),
        -1,
        true,
      ),
    ));
    return () => cancelAnimation(height);
  }, [playing, index, height]);

  /**
   * Scaled rather than resized, and that is not a detail: a height in an
   * animated style is laid out again on every frame, for a row inside a
   * virtualised list, which is exactly the shape of the jank #154 was about. A
   * transform never touches layout.
   */
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: height.get() }] }));

  return (
    <Animated.View
      style={[
        {
          width: 3,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: color,
          transformOrigin: 'bottom',
        },
        style,
      ]}
    />
  );
}

export function PlayingBars({ size = 16, color }: { size?: number; color?: string }) {
  const accent = useAccent();
  // Subscribed here rather than passed in: the row that draws this is memoised
  // on purpose (#50), and play/pause should repaint four bars, not a list.
  const playing = usePlayerStore((s) => s.isPlaying);
  return (
    <View
      style={{
        height: size,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 3,
      }}
    >
      {DURATIONS.map((_, i) => (
        <Bar key={i} index={i} playing={playing} color={color ?? accent} />
      ))}
    </View>
  );
}
