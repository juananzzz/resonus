/**
 * Where the navigation bar is, for everything that has to sit above it.
 *
 * The tabs own that bar on their own three screens. With "Always show the
 * navigation bar" on, `GlobalTabBar` draws the same thing everywhere else, and
 * then the MiniPlayer, the lists and their padding all have to move up by the
 * same amount they already do inside the tabs (#96).
 *
 * Full-screen modals are the exception: the player, the queue and the lyrics
 * cover everything, and the song picker keeps its own search bar down there.
 */
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useNavState } from '@/store/navState';
import { PILL_MARGIN, TAB_BAR_HEIGHT, TAB_BAR_HEIGHT_COMPACT } from '@/theme';

/** Screens that never take the bar, whatever the setting says. */
const NO_BAR = ['player', 'queue', 'lyrics', 'favorites-add', 'login'];

/** Screens that cover the MiniPlayer. `GlobalMiniPlayer` fades it out on these. */
export const NO_MINI_PLAYER = ['player', 'queue', 'lyrics', 'favorites-add'];

export function useTabBarShown(): boolean {
  const always = useSettings((s) => s.alwaysShowTabs);
  const root = useNavState((s) => s.rootSegment);
  // `undefined` is the root route resolving to the tabs on the first frame.
  const inTabs = root === '(tabs)' || root === undefined;
  if (inTabs) return true;
  return always && !NO_BAR.includes(root as string);
}

/**
 * Whether the MiniPlayer is on screen right now: something has to be playing
 * (`MiniPlayer` draws nothing without a song) and the screen has to be one
 * that doesn't cover it. Two conditions, and the bar it draws is 60 px that
 * anything floating at the bottom has to clear only while they both hold.
 */
export function useMiniPlayerShown(): boolean {
  const root = useNavState((s) => s.rootSegment);
  const hasSong = usePlayerStore((s) => currentSong(s) !== null);
  return hasSong && !NO_MINI_PLAYER.includes(root as string);
}

/**
 * A phone on its side has about 400 points of height, and a bar with each
 * name under its icon took a fifth of it, the MiniPlayer another, and a list
 * was left one row (#131). Below this height the names go beside the icons
 * and the bar is shorter; upright phones, tablets and car screens never get
 * here.
 */
const COMPACT_BELOW = 500;

/** Whether the navigation bar is the short one (see `COMPACT_BELOW`). */
export function useCompactTabBar(): boolean {
  return useWindowDimensions().height < COMPACT_BELOW;
}

/** The navigation bar's height, not counting the bottom safe area. */
export function useTabBarHeight(): number {
  return useCompactTabBar() ? TAB_BAR_HEIGHT_COMPACT : TAB_BAR_HEIGHT;
}

/** What is below the bar: the safe area, and at least the margin of a pill. */
export function useTabBarBottom(): number {
  const insets = useSafeAreaInsets();
  const pills = useSettings((s) => s.navbarPills);
  return pills ? Math.max(insets.bottom, PILL_MARGIN) : insets.bottom;
}
