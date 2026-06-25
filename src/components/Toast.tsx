/** Mensaje breve tipo píldora en la parte inferior (estilo Spotify). */
import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing } from '@/theme';

export function Toast() {
  const message = useToast((s) => s.message);
  const hide = useToast((s) => s.hide);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(hide, 2600);
    return () => clearTimeout(id);
  }, [message, hide]);

  if (!message) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.pill, { bottom: insets.bottom + 96 }]}
      pointerEvents="none"
    >
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: '#2E2E2E',
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  text: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
});
