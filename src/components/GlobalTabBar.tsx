/**
 * The navigation bar, for the whole app (#96).
 *
 * A stack can get deep: an artist, one of its albums, another artist off a
 * track, a genre from there, and Home is five taps back. With "Always show the
 * navigation bar" on, this puts every tab within one tap of anywhere, and that
 * tap also clears the stack it was covering.
 *
 * It is the only bar there is. The tabs navigator draws none of its own
 * (`tabBar={() => null}` in the tabs layout) and this is rendered next to the
 * Stack, like `GlobalMiniPlayer`: one bar that never unmounts, rather than two
 * that hand over to each other. Two would have to be kept looking identical by
 * hand, and the handover showed as a blink of empty space in the middle of
 * every back animation.
 *
 * Icons of 25 in a 31×28 box, 5 of padding around each tab, labels of 10.
 */
import Icon from '@/components/Icon';
import { useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { BarBlur, useBarBlur } from '@/components/BarBlur';

import { useTabBarShown } from '@/hooks/useTabBar';
import { motion } from '@/theme/motion';
import { useT } from '@/i18n';
import { rememberTab, reselectTab, tabOrigin, TABS } from '@/lib/tabOrigin';
import { useSettings } from '@/store/settings';
import { colors, TAB_BAR_HEIGHT, themed } from '@/theme';

const ICONS: Record<string, 'home' | 'search' | 'library' | 'albums' | 'settings'> = {
  index: 'home',
  search: 'search',
  library: 'library',
  explore: 'albums',
  options: 'settings',
};

export function GlobalTabBar() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const segments = useSegments() as string[];
  const shown = useTabBarShown();
  // It is also the bar of the tab screens (the tabs navigator draws none):
  // the blur only works from out here (`BarBlur`). The setting only decides
  // where else it shows.
  const blur = useBarBlur();
  const bottomTabs = useSettings((s) => s.bottomTabs);
  const root = segments[0];
  const inTabs = root === '(tabs)' || root === undefined;
  // Where a stack opened from here would belong; the back arrow reads the same
  // thing to know where to let you out (see `tabOrigin`).
  if (inTabs) rememberTab(segments[1]);
  const origin = tabOrigin();
  const current = inTabs ? origin : null;
  /**
   * Going, rather than gone.
   *
   * This bar is drawn after the Stack, so it is over everything, the player
   * included — which is why it has to take itself off screen for the screens
   * that cover the app. It used to do that the instant the route changed,
   * while the modal still had its ~165 ms of animation to run: the strip it
   * had been covering was left showing the list rows underneath, and the way
   * into the player began with a hole.
   *
   * Fading rather than timing the disappearance to the animation. A fixed wait
   * is wrong in both directions and only one of them is recoverable: too short
   * leaves the hole again, too long puts the navigation bar on top of the
   * player. Fading, being early or late by a few frames costs a little more or
   * a little less of something already almost transparent.
   */
  const fade = useSharedValue(shown ? 1 : 0);
  // The blur redraws every frame it is on screen, invisible or not, so it goes
  // once the bar has faded out.
  const [blurOn, setBlurOn] = useState(shown);
  if (shown && !blurOn) setBlurOn(true);
  useEffect(() => {
    // Straight back on the way in: coming out of the player the bar was there
    // before and belongs there again, and until the modal finishes dismissing
    // nobody can see it anyway.
    fade.value = shown
      ? 1
      : withTiming(0, { duration: motion.duration.exit }, (done) => {
          if (done) scheduleOnRN(setBlurOn, false);
        });
  }, [shown, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  /** Leaves for a tab, dropping the screens piled on top of it. */
  const go = (href: string) => {
    // `canDismiss`, not `canGoBack`: inside the tabs there is history to go
    // back to but no stack to pop, and asking for it anyway is the navigator
    // warning about POP_TO_TOP going unhandled.
    if (router.canDismiss()) router.dismissAll();
    router.navigate(href);
  };

  return (
    <Animated.View
      // Nothing to press once it is on its way out, so a tap meant for the
      // screen taking over does not land on a bar that is no longer there.
      pointerEvents={shown ? 'auto' : 'none'}
      style={[
        styles.bar,
        { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom },
        blur ? null : styles.solid,
        fadeStyle,
      ]}
    >
      {blur && blurOn ? <BarBlur /> : null}
      {/* Where the glass starts, when something bright passes under it. */}
      {blur ? <View pointerEvents="none" style={styles.edge} /> : null}
      {/* The user's order, and only the ones they kept (Settings › Appearance
          › Navigation bar). `TABS` stays the catalogue: it is what says where
          each one goes and what it is called. */}
      {bottomTabs
        .filter((t) => t.enabled)
        .map(({ key }) => TABS.find((x) => x.segment === key))
        .filter((tab): tab is (typeof TABS)[number] => !!tab)
        .map((tab) => {
        // On a tab screen the bar says which one you are on. Off the tabs
        // nothing is current, and the tab the stack came from is only marked
        // enough to keep the bar from looking dead.
        const here = current === tab.segment;
        const from = !inTabs && origin === tab.segment;
        const color = here || from ? colors.text : colors.textSecondary;
        return (
          <Pressable
            key={tab.href}
            style={styles.item}
            accessibilityRole="button"
            accessibilityState={{ selected: here }}
            accessibilityLabel={t(tab.label)}
            onPress={() => {
              // Already here: this is the second press, which is a screen's to
              // answer (Search puts the cursor in its box). Still navigates,
              // since there may be a stack on top to drop.
              if (here) reselectTab(tab.segment);
              go(tab.href);
            }}
          >
            <View style={styles.iconBox}>
              <Icon
                name={here || from ? ICONS[tab.segment] : `${ICONS[tab.segment]}-outline`}
                size={25}
                color={color}
              />
            </View>
            <Text style={[styles.label, { color }]} numberOfLines={1}>
              {t(tab.label)}
            </Text>
          </Pressable>
          );
        })}
    </Animated.View>
  );
}

const styles = themed((colors) => ({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    // What the tabs layout used to pass as `tabBarStyle`.
    paddingTop: 6,
  },
  solid: { backgroundColor: colors.background },
  edge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.highlight,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', padding: 5 },
  iconBox: { width: 31, height: 28, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10 },
}));
