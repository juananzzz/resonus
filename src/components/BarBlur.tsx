/**
 * The blur behind the navigation bar and the mini player (a switch each, in
 * Settings › Home & navigation and Settings › Player).
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

/**
 * Whether a bar is see-through, blurring what scrolls under it.
 *
 * The navigation bar never is while the gradient style is on: the two fill the
 * same pixels, so the style wins and the blur setting stops having any effect
 * at all (it still switches, it just does not show while the gradient is on).
 */
export function useBarBlur(bar: 'tabs' | 'miniPlayer'): boolean {
  const blur = useSettings((s) => (bar === 'tabs' ? s.blurBars : s.blurMiniPlayer));
  const style = useSettings((s) => s.navBarStyle);
  return blur && !(bar === 'tabs' && style === 'gradient') && canBlurBars;
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
 * away: the header's own flat colour, so the bar never thins over the list
 * scrolling under it.
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
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
    </Animated.View>
  );
}

/**
 * The bar's colour, laid flat: nothing about it animates, so it keeps the
 * header's colour over whatever scrolls under it at every scroll. A screen
 * whose bar answers something other than its title — a selection, where the
 * bar says how many songs the hand marked — wants this one: the header's own
 * title scrolls behind the bar and is hidden, and the bar's words stay whole,
 * so a bar that thinned in as the header fell away would read as the bar
 * changing rather than as what it says changing.
 *
 * Not the one above with its opacity pinned to 1: `Animated.View` gives a
 * style nothing to hold when the number it is handed never moves, and the
 * flat colour never comes down at all.
 */
export function TopBarPaint({ color }: { color: string }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
  );
}

function withAlpha(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  if (n.length !== 6) return hex;
  return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
