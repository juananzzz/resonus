/** Ajustes › Aspecto: idioma, reproductor, listas e interfaz. */
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
        <Pressable
          style={({ pressed }) => [styles.linkCard, pressed && { opacity: 0.6 }]}
          onPress={() => router.push('/settings/language')}
        >
          <Text style={styles.linkLabel}>{t('Language')}</Text>
          <Text style={settingsStyles.selectRowValue}>{LANGUAGE_NAMES[language]}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

        <Text style={settingsStyles.sectionTitle}>{t('Player')}</Text>
        <SwitchList
          options={[
            {
              label: t('Colored background'),
              description: t('Tint the player background with the cover color.'),
              value: playerColorBackground,
              onChange: setPlayerColorBackground,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Song lists')}</Text>
        <SwitchList
          options={[
            {
              label: t('With artwork'),
              description: t('Show the album artwork next to each song in playlists and favorites.'),
              value: showListArtwork,
              onChange: setShowListArtwork,
            },
            {
              label: t('Song duration'),
              value: showSongDuration,
              onChange: setShowSongDuration,
            },
          ]}
        >
          <SelectList
            embedded
            label={t('Quality labels')}
            description={t('Format, bitrate and Lossless / Hi-Res.')}
            options={AUDIO_QUALITY_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.label) }))}
            value={showAudioQuality}
            onChange={setShowAudioQuality}
          />
        </SwitchList>

        <Text style={settingsStyles.sectionTitle}>{t('Interface')}</Text>
        <SwitchList
          options={[
            {
              label: t('Artist photo'),
              description: t('Show a round artist photo next to the name on album screens.'),
              value: showArtistPhoto,
              onChange: setShowArtistPhoto,
            },
            {
              label: t('History'),
              description: t('The clock button on Home.'),
              value: showHistoryButton,
              onChange: setShowHistoryButton,
            },
            {
              label: t('Profile'),
              description: t('Your avatar on Home.'),
              value: showProfileButton,
              onChange: setShowProfileButton,
            },
            {
              label: t('Devices'),
              description: t('The output button in the player.'),
              value: showOutputButton,
              onChange: setShowOutputButton,
            },
            {
              label: t('Vibration'),
              description: t('A subtle vibration when using the controls.'),
              value: hapticsEnabled,
              onChange: setHapticsEnabled,
            },
          ]}
        />

        <View style={settingsStyles.rowButton}>
          <Ionicons name="color-palette-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Theme')}</Text>
          <Text style={settingsStyles.soonTag}>{t('Soon')}</Text>
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
  linkLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: '600', flex: 1 },
});
