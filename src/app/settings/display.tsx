/** Ajustes › Pantalla: idioma de la interfaz y calidad de audio. */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings, AUDIO_QUALITY_OPTIONS, type Language } from '@/store/settings';
import { colors, fontSize, radius, spacing } from '@/theme';

const LANG_LABEL: Record<Language, string> = { es: 'Español', en: 'English' };

const LIST_STYLES: { value: boolean; label: string }[] = [
  { value: true, label: 'With artwork' },
  { value: false, label: 'Compact' },
];

export default function DisplaySettings() {
  const router = useRouter();
  const t = useT();
  const language = useSettings((s) => s.language);
  const showAudioQuality = useSettings((s) => s.showAudioQuality);
  const setShowAudioQuality = useSettings((s) => s.setShowAudioQuality);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const setShowListArtwork = useSettings((s) => s.setShowListArtwork);

  return (
    <SettingsPage title={t('Display')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionTitle}>{t('Language')}</Text>
        <Pressable
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            padding: spacing.lg,
            opacity: pressed ? 0.6 : 1,
          })}
          onPress={() => router.push('/settings/language')}
        >
          <Text style={{ color: colors.text, fontSize: fontSize.md, flex: 1 }}>
            {LANG_LABEL[language]}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

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

        <Text style={settingsStyles.sectionTitle}>{t('Song lists')}</Text>
        <Text style={settingsStyles.hint}>
          {t('Show the album artwork next to each song in playlists and favorites.')}
        </Text>
        <View style={settingsStyles.chips}>
          {LIST_STYLES.map((opt) => {
            const active = opt.value === showListArtwork;
            return (
              <Pressable
                key={String(opt.value)}
                style={[settingsStyles.chip, active && settingsStyles.chipActive]}
                onPress={() => setShowListArtwork(opt.value)}
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
