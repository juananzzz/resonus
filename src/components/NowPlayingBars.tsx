/** Pequeño ecualizador animado que indica la canción que está sonando. */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme';

function Bar({ duration, playing }: { duration: number; playing: boolean }) {
  const height = useSharedValue(0.35);

  useEffect(() => {
    if (playing) {
      height.value = withRepeat(
        withSequence(
          withTiming(1, { duration }),
          withTiming(0.35, { duration }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(height);
      height.value = withTiming(0.5);
    }
  }, [playing, duration, height]);

  const style = useAnimatedStyle(() => ({ height: `${height.value * 100}%` }));

  return (
    <Animated.View
      style={[
        { width: 3, backgroundColor: colors.accent, borderRadius: 2 },
        style,
      ]}
    />
  );
}

export function NowPlayingBars({ playing }: { playing: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 2,
        width: 18,
        height: 16,
      }}
    >
      <Bar duration={300} playing={playing} />
      <Bar duration={450} playing={playing} />
      <Bar duration={380} playing={playing} />
    </View>
  );
}
