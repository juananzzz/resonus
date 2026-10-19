/** Rich empty state: icon, title, subtitle, and optional action. */
import Icon from '@/components/Icon';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { colors, fontSize, radius, spacing, themed, tracking } from '@/theme';
import { motion } from '@/theme/motion';

interface Props {
  icon: keyof typeof Icon.glyphMap;
  /** Solid instead of dimmed, for marks that must read as controls. */
  iconSolid?: boolean;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ icon, iconSolid, title, subtitle, action }: Props) {
  return (
    // Fades rather than snaps: empty is a state the screen lands in (a query
    // with no hits, a tab with nothing in it), rare enough for the bridge.
    <Animated.View
      entering={FadeIn.duration(motion.duration.fade)}
      exiting={FadeOut.duration(motion.duration.exit)}
      style={styles.container}
    >
      <View style={styles.iconWrap}>
        <Icon name={icon} size={40} color={iconSolid ? colors.text : colors.textSecondary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action ? (
        <Pressable
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.accent },
            pressed && { opacity: 0.6 },
          ]}
          onPress={action.onPress}
        >
          <Text style={styles.buttonText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = themed((colors) => ({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    marginTop: spacing.xl,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  buttonText: { color: colors.onAccent, fontSize: fontSize.sm, fontWeight: '600' },
}));
