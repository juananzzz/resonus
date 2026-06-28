/** Personalization placeholder — theme and accent color coming soon. */
import { Ionicons } from '@expo/vector-icons';
import { ScrollView, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';

export default function PersonalizationSettings() {
  const t = useT();

  return (
    <SettingsPage title={t('Personalization')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <View style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: spacing.xl,
          alignItems: 'center',
          gap: spacing.md,
        }}>
          <Ionicons name="color-palette-outline" size={48} color={colors.textMuted} />
          <Text style={{ color: colors.textSecondary, fontSize: fontSize.md, textAlign: 'center' }}>
            {t('Choose your theme, accent color and more.')}
          </Text>
          <View style={{
            backgroundColor: colors.accent,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            borderRadius: radius.pill,
          }}>
            <Text style={{ color: '#000', fontSize: fontSize.sm, fontWeight: '600' }}>
              {t('Coming soon')}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SettingsPage>
  );
}
