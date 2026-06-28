/** Ajustes › Aspecto: idioma, etiquetas de calidad, listas y (pronto) tema. */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import {
  AUDIO_QUALITY_OPTIONS,
  LANGUAGE_NAMES,
  useSettings,
} from '@/store/settings';
import { colors, fontSize, radius, spacing } from '@/theme';

const LIST_STYLES: { value: boolean; label: string }[] = [
  { value: true, label: 'With artwork' },
  { value: false, label: 'Compact' },
];

export default function AppearanceSettings() {
  const router = useRouter();
  const t = useT();
  const language = useSettings((s) => s.language);
  const showAudioQuality = useSettings((s) => s.showAudioQuality);
  const setShowAudioQuality = useSettings((s) => s.setShowAudioQuality);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const setShowListArtwork = useSettings((s) => s.setShowListArtwork);

  return (
    <SettingsPage title={t('Appearance')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionTitle}>{t('Language')}</Text>
        <Pressable
          style={({ pressed }) => [styles.linkCard, pressed && { opacity: 0.6 }]}
          onPress={() => router.push('/settings/language')}
        >
          <Text style={styles.linkText}>{LANGUAGE_NAMES[language]}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

        <Text style={settingsStyles.sectionTitle}>{t('Quality labels')}</Text>
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

        <Text style={settingsStyles.sectionTitle}>{t('Theme')}</Text>
        <View style={styles.soonCard}>
          <Ionicons name="color-palette-outline" size={40} color={colors.textMuted} />
          <Text style={styles.soonText}>{t('Choose your theme, accent color and more.')}</Text>
          <View style={styles.soonPill}>
            <Text style={styles.soonPillText}>{t('Coming soon')}</Text>
          </View>
        </View>
      </ScrollView>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  linkText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  soonCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  soonText: { color: colors.textSecondary, fontSize: fontSize.md, textAlign: 'center' },
  soonPill: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  soonPillText: { color: '#000', fontSize: fontSize.sm, fontWeight: '600' },
});
