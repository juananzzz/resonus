/** Ajustes › Aspecto: idioma, reproductor, listas e interfaz. */
import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import {
  AUDIO_QUALITY_OPTIONS,
  LANGUAGE_NAMES,
  useSettings,
} from '@/store/settings';

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

  return (
    <SettingsPage title={t('Appearance')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SettingRow
          label={t('Language')}
          description={LANGUAGE_NAMES[language]}
          chevron
          onPress={() => router.push('/settings/language')}
        />

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
        />

        <SelectList
          label={t('Quality labels')}
          description={t('Format, bitrate and Lossless / Hi-Res.')}
          options={AUDIO_QUALITY_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.label) }))}
          value={showAudioQuality}
          onChange={setShowAudioQuality}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Interface')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show artist photo'),
              description: t('Show a round artist photo next to the name on album screens.'),
              value: showArtistPhoto,
              onChange: setShowArtistPhoto,
            },
            {
              label: t('Show history button'),
              description: t('The clock button on Home.'),
              value: showHistoryButton,
              onChange: setShowHistoryButton,
            },
            {
              label: t('Show profile button'),
              description: t('Your avatar on Home.'),
              value: showProfileButton,
              onChange: setShowProfileButton,
            },
          ]}
        />
      </ScrollView>
    </SettingsPage>
  );
}
