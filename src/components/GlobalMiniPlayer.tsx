/**
 * Global MiniPlayer: shown on ALL screens (not only in tabs), just like
 * Spotify. Sits above the tab bar when on tab screens, and at the bottom on
 * other screens. On full-screen modals (player, queue, lyrics) it fades out
 * instead of disappearing instantly, to avoid flickering while the modal slides up.
 */
import { useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NO_MINI_PLAYER, useTabBarBottom, useTabBarHeight, useTabBarShown } from '@/hooks/useTabBar';
import { dismissProgress } from '@/lib/playerReveal';
import { motion } from '@/theme/motion';
import { MINI_PLAYER_GAP, spacing } from '@/theme';
import { MiniPlayer } from './MiniPlayer';

export function GlobalMiniPlayer() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const root = segments[0];
  // Above the navigation bar wherever there is one, which with the setting on
  // is nearly everywhere and not only inside the tabs (see `useTabBarShown`).
  const withBar = useTabBarShown();
  const barHeight = useTabBarHeight();
  const barBottom = useTabBarBottom();

  // favorites-add too: its search bar lives at the bottom and the mini would
  // cover it. The list is shared because whatever floats at the bottom (the
  // toast, the multi-select bar) has to know where the mini is not.
  const visible = !NO_MINI_PLAYER.includes(root as string);
  const bottom = withBar ? barHeight + MINI_PLAYER_GAP + barBottom : insets.bottom + spacing.sm;

  // Keep the last visible position so it doesn't jump while fading out
  // when opening a full-screen modal.
  const lastBottom = useRef(bottom);
  if (visible) lastBottom.current = bottom;

  // Segment-driven opacity: 0 when a full-screen modal (player, queue, lyrics)
  // is on top, 1 everywhere else.
  const segmentOpacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    if (visible) {
      // Coming back from the player: snap to 1 immediately (dismissProgress
      // already animated it in) and clear dismissProgress so it is ready for
      // the next dismiss. No fade here — the user already watched it appear.
      segmentOpacity.value = 1;
      dismissProgress.value = 0;
    } else {
      segmentOpacity.value = withTiming(0, { duration: motion.duration.fade });
    }
  }, [visible, segmentOpacity]);

  // During a player swipe-down dismiss, the segments don't update until
  // navigation completes, so segmentOpacity stays 0. dismissProgress (0→1
  // as the player slides away) fills the gap: the mini player fades in while
  // the player is still animating off the screen.
  const animStyle = useAnimatedStyle(() => ({
    opacity: Math.max(segmentOpacity.value, dismissProgress.value),
  }));

  return (
    <Animated.View
      style={[{ position: 'absolute', left: 0, right: 0, bottom: lastBottom.current }, animStyle]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      <MiniPlayer active={visible} />
    </Animated.View>
  );
}
