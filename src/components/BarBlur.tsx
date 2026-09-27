/**
 * The blur behind the navigation bar and the mini player ("Blur behind the
 * bars", Settings › Appearance).
 *
 * On Android a BlurView can only blur what sits inside a `BlurTargetView`, and
 * never itself: the root layout wraps the Stack in one (`BarBlurTarget`) and
 * both bars are drawn next to it, outside. That is why, with this on, the tabs
 * navigator hands its own bar over to `GlobalTabBar` even on the tab screens.
 *
 * Android 12 is the floor. Below it expo-blur falls back to a flat tint, which
 * is the see-through bar that was tried and reverted (b8bb8b1): a veil tints
 * what is behind it without hiding it.
 */
import { BlurTargetView, BlurView } from 'expo-blur';
import { createRef, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { useSettings } from '@/store/settings';
import { useTheme, useThemeMode } from '@/theme';

export const canBlurBars =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version >= 31);

const target = createRef<View | null>();

/** Whether the bars are see-through, blurring what scrolls under them. */
export function useBarBlur(): boolean {
  return useSettings((s) => s.blurBars) && canBlurBars;
}


/** What the bars blur: everything the Stack draws (the root layout's). */
export function BarBlurTarget({ children }: { children: ReactNode }) {
  return (
    <BlurTargetView ref={target} style={{ flex: 1 }}>
      {children}
    </BlurTargetView>
  );
}

/**
 * `tint` is laid over the blur so the bar keeps a colour of its own and its
 * labels stay legible over a bright cover: the page colour for the navigation
 * bar, the cover's for the mini player.
 */
export function BarBlur({ tint, alpha }: { tint?: string; alpha?: number }) {
  const colors = useTheme();
  const mode = useThemeMode();
  const a = alpha ?? (mode === 'light' ? 0.7 : 0.6);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BlurView
        style={StyleSheet.absoluteFill}
        blurTarget={target}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={60}
        tint={mode === 'light' ? 'light' : 'dark'}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(tint ?? colors.background, a) }]} />
    </View>
  );
}

/**
 * The background of a screen's top bar, which fades in as the header scrolls
 * away: the header's colour, solid.
 *
 * Not blurred. A bar inside a screen can only blur a target of its own around
 * that screen's list, and a screen wrapped in a `BlurTargetView` stops being
 * drawn the moment it starts to leave: going back showed an empty page for a
 * few frames before the fade.
 */
export function TopBarBackground({
  color,
  opacity,
}: {
  color: string;
  opacity: Animated.AnimatedInterpolation<number> | number;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity, backgroundColor: color }]}
    />
  );
}

function withAlpha(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  if (n.length !== 6) return hex;
  return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
