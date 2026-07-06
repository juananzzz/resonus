/**
 * Ajustes › Theme: elegir el color de acento (se aplica al instante). Más
 * opciones de tema (claro/oscuro…) llegarán más adelante.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { ACCENT_OPTIONS, useSettings } from '@/store/settings';
import { colors, fontSize, spacing } from '@/theme';

export default function ThemeSettings() {
  const t = useT();
  const accentColor = useSettings((s) => s.accentColor);
  const setAccentColor = useSettings((s) => s.setAccentColor);

  return (
    <SettingsPage title={t('Theme')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={styles.label}>{t('Accent color')}</Text>
        <View style={styles.swatches}>
          {ACCENT_OPTIONS.map((opt) => {
            const active = opt.color.toLowerCase() === accentColor.toLowerCase();
            return (
              <Pressable
                key={opt.color}
                onPress={() => setAccentColor(opt.color)}
                accessibilityRole="button"
                accessibilityLabel={t(opt.name)}
                style={[styles.swatch, { backgroundColor: opt.color }, active && styles.swatchActive]}
              >
                {active ? <Ionicons name="checkmark" size={24} color="#000" /> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchActive: { borderWidth: 3, borderColor: colors.text },
});
