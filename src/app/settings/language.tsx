/** Language picker — list with checkmark on the active language. */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings, type Language } from '@/store/settings';
import { colors, fontSize, radius, spacing } from '@/theme';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

export default function LanguageSettings() {
  const t = useT();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);

  return (
    <SettingsPage title={t('Language')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' }}>
          {LANGUAGES.map((opt, i) => {
            const active = opt.value === language;
            return (
              <Pressable
                key={opt.value}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  opacity: pressed ? 0.6 : 1,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: colors.border,
                })}
                onPress={() => setLanguage(opt.value)}
              >
                <Text style={{ color: colors.text, fontSize: fontSize.md, flex: 1 }}>
                  {opt.label}
                </Text>
                {active ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                ) : (
                  <View style={{ width: 22 }} />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SettingsPage>
  );
}
