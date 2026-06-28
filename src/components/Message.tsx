/** Mensaje centrado para estados de error o vacío, con reintento opcional. */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';

export function Message({
  text,
  onRetry,
}: {
  text: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{text}</Text>
      {onRetry ? (
        <Pressable style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>{t('Retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    marginTop: spacing.xxl,
  },
  text: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  buttonText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
});
