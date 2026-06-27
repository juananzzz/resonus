/** Ajustes › Pantalla: idioma de la interfaz y calidad de audio. */
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings, AUDIO_QUALITY_OPTIONS, type Language } from '@/store/settings';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

export default function DisplaySettings() {
  const t = useT();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const showAudioQuality = useSettings((s) => s.showAudioQuality);
  const setShowAudioQuality = useSettings((s) => s.setShowAudioQuality);

  return (
    <SettingsPage title={t('Display')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionTitle}>{t('Language')}</Text>
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

        <Text style={settingsStyles.sectionTitle}>{t('Format & quality')}</Text>
        <Text style={settingsStyles.hint}>
          {t('Displays the audio format, bitrate, and Lossless / Hi-Res labels next to each song.')}
        </Text>
        <View style={settingsStyles.chips}>
          {AUDIO_QUALITY_OPTIONS.map((opt) => {
            const active = opt.value === showAudioQuality;
            return (
              <Pressable
                key={opt.value}
                style={[settingsStyles.chip, active && settingsStyles.chipActive]}
                onPress={() => setShowAudioQuality(opt.value)}
              >
                <Text style={[settingsStyles.chipText, active && settingsStyles.chipTextActive]}>
                  {t(opt.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SettingsPage>
  );
}
