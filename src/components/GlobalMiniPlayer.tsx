/**
 * Global MiniPlayer: shown on ALL screens (not only in tabs), just like
 * Spotify. Sits above the tab bar when on tab screens, and at the bottom on
 * other screens. On full-screen modals (player, queue, lyrics) it fades out
 * instead of disappearing instantly, to avoid flickering while the modal slides up.
 */
import { useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NO_MINI_PLAYER, useTabBarShown } from '@/hooks/useTabBar';
import { spacing, TAB_BAR_HEIGHT } from '@/theme';
import { MiniPlayer } from './MiniPlayer';

export function GlobalMiniPlayer() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const root = segments[0];
  // Above the navigation bar wherever there is one, which with the setting on
  // is nearly everywhere and not only inside the tabs (see `useTabBarShown`).
  const withBar = useTabBarShown();

  // favorites-add too: its search bar lives at the bottom and the mini would
  // cover it. The list is shared because whatever floats at the bottom (the
  // toast, the multi-select bar) has to know where the mini is not.
  const visible = !NO_MINI_PLAYER.includes(root as string);
  const bottom = withBar ? TAB_BAR_HEIGHT + insets.bottom : insets.bottom + spacing.sm;

  // Keep the last visible position so it doesn't jump while fading out
  // when opening a full-screen modal.
  const lastBottom = useRef(bottom);
  if (visible) lastBottom.current = bottom;

  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  return (
    <Animated.View
      style={{ position: 'absolute', left: 0, right: 0, bottom: lastBottom.current, opacity, width: '100%' }}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      <MiniPlayer />
    </Animated.View>
  );
}
