/** Ajustes › Pantalla: idioma de la interfaz. */
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings, type Language } from '@/store/settings';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

export default function DisplaySettings() {
  const t = useT();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);

  return (
    <SettingsPage title={t('Pantalla')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionTitle}>{t('Idioma')}</Text>
        <View style={settingsStyles.chips}>
          {LANGUAGES.map((opt) => {
            const active = opt.value === language;
            return (
              <Pressable
                key={opt.value}
                style={[settingsStyles.chip, active && settingsStyles.chipActive]}
                onPress={() => setLanguage(opt.value)}
              >
                <Text style={[settingsStyles.chipText, active && settingsStyles.chipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SettingsPage>
  );
}
