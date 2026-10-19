/** Brief pill-shaped message at the bottom (Spotify style). */
import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { motion } from '@/theme/motion';

import { useFloatingBottom } from '@/hooks/useScreenBottomPadding';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed } from '@/theme';

export function Toast() {
  const message = useToast((s) => s.message);
  const actionLabel = useToast((s) => s.actionLabel);
  const runAction = useToast((s) => s.runAction);
  const hide = useToast((s) => s.hide);
  // Clear of the mini player while there is one, and of the navigation bar
  // where there is one. The constant this replaces was 24 px short of the mini
  // player with that bar on, so the message sat partly behind it; the same
  // height the multi-select bar uses, so the two never disagree.
  const bottom = useFloatingBottom();

  useEffect(() => {
    if (!message) return;
    // With an action ("Undo") we give more time to react.
    const id = setTimeout(hide, actionLabel ? 4000 : 2600);
    return () => clearTimeout(id);
  }, [message, actionLabel, hide]);

  if (!message) return null;

  return (
    <Animated.View
      // Leaves the way it came, on the same axis: entering drops it in from
      // above, so exiting fades it back up instead of just blinking out.
      entering={FadeInDown.duration(motion.duration.fade)}
      exiting={FadeOutUp.duration(motion.duration.exit)}
      style={[styles.pill, actionLabel ? styles.pillRow : null, { bottom }]}
      // Without an action the toast is purely informational and shouldn't steal touches.
      pointerEvents={actionLabel ? 'box-none' : 'none'}
    >
      <Text style={[styles.text, actionLabel ? styles.textLeft : null]} numberOfLines={2}>
        {message}
      </Text>
      {actionLabel ? (
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          onPress={() => {
            runAction?.();
            hide();
          }}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          {/* The accent as picked, not the theme's: the pill is dark in both
              appearances, and the light theme darkens the accent for white. */}
          <Text style={[styles.action, { color: colors.accentVivid }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = themed((colors) => ({
  pill: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.snackbar,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  pillRow: { flexDirection: 'row', gap: spacing.lg },
  text: { color: colors.onSnackbar, fontSize: fontSize.sm, fontWeight: '500' },
  textLeft: { flex: 1 },
  action: { fontSize: fontSize.sm, fontWeight: '600' },
}));
