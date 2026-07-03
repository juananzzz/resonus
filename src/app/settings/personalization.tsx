/** Ajustes › Aspecto: idioma, etiquetas de calidad, listas y (pronto) tema. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SelectList, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
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
  const showSongDuration = useSettings((s) => s.showSongDuration);
  const setShowSongDuration = useSettings((s) => s.setShowSongDuration);
  const showArtistPhoto = useSettings((s) => s.showArtistPhoto);
  const setShowArtistPhoto = useSettings((s) => s.setShowArtistPhoto);
  const playerColorBackground = useSettings((s) => s.playerColorBackground);
  const setPlayerColorBackground = useSettings((s) => s.setPlayerColorBackground);
  const showHistoryButton = useSettings((s) => s.showHistoryButton);
  const setShowHistoryButton = useSettings((s) => s.setShowHistoryButton);
  const showProfileButton = useSettings((s) => s.showProfileButton);
  const setShowProfileButton = useSettings((s) => s.setShowProfileButton);
  const showOutputButton = useSettings((s) => s.showOutputButton);
  const setShowOutputButton = useSettings((s) => s.setShowOutputButton);
  const hapticsEnabled = useSettings((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettings((s) => s.setHapticsEnabled);

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
        <SelectList
          options={AUDIO_QUALITY_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.label) }))}
          value={showAudioQuality}
          onChange={setShowAudioQuality}
        />
        <Text style={settingsStyles.hint}>
          {t('Displays the audio format, bitrate, and Lossless / Hi-Res labels next to each song.')}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Song lists')}</Text>
        <SelectList
          options={LIST_STYLES.map((opt) => ({ value: opt.value, label: t(opt.label) }))}
          value={showListArtwork}
          onChange={setShowListArtwork}
        />
        <Text style={settingsStyles.hint}>
          {t('Show the album artwork next to each song in playlists and favorites.')}
        </Text>
        <SwitchList
          options={[
            { label: t('Song duration'), value: showSongDuration, onChange: setShowSongDuration },
          ]}
        />
        <Text style={settingsStyles.hint}>
          {t('Show the length of each song in lists.')}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Albums')}</Text>
        <SwitchList
          options={[
            { label: t('Artist photo'), value: showArtistPhoto, onChange: setShowArtistPhoto },
          ]}
        />
        <Text style={settingsStyles.hint}>
          {t('Show a round artist photo next to the name on album screens.')}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Player')}</Text>
        <SwitchList
          options={[
            {
              label: t('Colored background'),
              value: playerColorBackground,
              onChange: setPlayerColorBackground,
            },
          ]}
        />
        <Text style={settingsStyles.hint}>
          {t('Tint the player background with the cover color.')}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Buttons')}</Text>
        <SwitchList
          options={[
            { label: t('History'), value: showHistoryButton, onChange: setShowHistoryButton },
            { label: t('Profile'), value: showProfileButton, onChange: setShowProfileButton },
            { label: t('Devices'), value: showOutputButton, onChange: setShowOutputButton },
          ]}
        />
        <Text style={settingsStyles.hint}>
          {t("Hide the buttons you don't use for a cleaner interface.")}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Interaction')}</Text>
        <SwitchList
          options={[
            { label: t('Vibration'), value: hapticsEnabled, onChange: setHapticsEnabled },
          ]}
        />
        <Text style={settingsStyles.hint}>
          {t('A subtle vibration when using the controls.')}
        </Text>

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
