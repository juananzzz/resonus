/** Settings › Appearance: language, theme, font, corners, and what lists and album pages show. */
import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  SettingsScroll,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useTheme, type BorderStyle } from '@/theme';
import {
  APP_FONT_LABELS,
  LANGUAGE_NAMES,
  useSettings,
  type CoverCorners,
  type SwipeAction,
} from '@/store/settings';

export default function AppearanceSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const router = useRouter();
  const t = useT();
  const language = useSettings((s) => s.language);
  const themeMode = useSettings((s) => s.themeMode);
  const themeModeLabel = {
    system: t('System'),
    dark: t('Dark'),
    light: t('Light'),
    schedule: t('Scheduled'),
  }[themeMode];
  const appFont = useSettings((s) => s.appFont);
  const coverCorners = useSettings((s) => s.coverCorners);
  const setCoverCorners = useSettings((s) => s.setCoverCorners);
  const borderStyle = useSettings((s) => s.borderStyle);
  const setBorderStyle = useSettings((s) => s.setBorderStyle);
  // Same rule as the player's rating row: no ratings on Jellyfin or locally.
  const canRate = useAuthStore((s) => !!s.auth && s.auth.serverType !== 'jellyfin');
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const setShowListArtwork = useSettings((s) => s.setShowListArtwork);
  const showSongDuration = useSettings((s) => s.showSongDuration);
  const setShowSongDuration = useSettings((s) => s.setShowSongDuration);
  const showListRating = useSettings((s) => s.showListRating);
  const setShowListRating = useSettings((s) => s.setShowListRating);
  const showExplicitTag = useSettings((s) => s.showExplicitTag);
  const setShowExplicitTag = useSettings((s) => s.setShowExplicitTag);
  const showPlaylistDescription = useSettings((s) => s.showPlaylistDescription);
  const setShowPlaylistDescription = useSettings((s) => s.setShowPlaylistDescription);
  const showArtistPhoto = useSettings((s) => s.showArtistPhoto);
  const setShowArtistPhoto = useSettings((s) => s.setShowArtistPhoto);
  const showDiscHeaders = useSettings((s) => s.showDiscHeaders);
  const setShowDiscHeaders = useSettings((s) => s.setShowDiscHeaders);
  const showGenreChips = useSettings((s) => s.showGenreChips);
  const setShowGenreChips = useSettings((s) => s.setShowGenreChips);
  const albumFullBleed = useSettings((s) => s.albumFullBleed);
  const setAlbumFullBleed = useSettings((s) => s.setAlbumFullBleed);
  const swipeAction = useSettings((s) => s.swipeAction);
  const setSwipeAction = useSettings((s) => s.setSwipeAction);
  const swipeLeftAction = useSettings((s) => s.swipeLeftAction);
  const setSwipeLeftAction = useSettings((s) => s.setSwipeLeftAction);

  const swipeOptions: { value: SwipeAction; label: string }[] = [
    { value: 'off', label: t('Off') },
    { value: 'queue', label: t('Add to queue') },
    { value: 'next', label: t('Play next') },
    { value: 'favorite', label: t('Add to favorites') },
    { value: 'menu', label: t('More options') },
  ];

  return (
    <SettingsPage title={t('Appearance')}>
      <SettingsScroll>
        <SettingsGroup>
          <SettingRow
            label={t('Language')}
            description={LANGUAGE_NAMES[language]}
            chevron
            onPress={() => router.push('/settings/language')}
          />
          <SettingRow
            label={t('Theme')}
            description={themeModeLabel}
            chevron
            onPress={() => router.push('/settings/theme')}
          />
          <SettingRow
            label={t('Font')}
            description={APP_FONT_LABELS[appFont]}
            chevron
            onPress={() => router.push('/settings/font')}
          />
          <SelectList<CoverCorners>
            label={t('Cover corners')}
            options={[
              { value: 'square', label: t('Square') },
              { value: 'rounded', label: t('Rounded') },
              { value: 'round', label: t('More rounded') },
            ]}
            value={coverCorners}
            onChange={setCoverCorners}
          />
          <SelectList<BorderStyle>
            label={t('Corners')}
            description={t('Round corners everywhere, or flatter ones')}
            options={[
              { value: 'round', label: t('Round') },
              { value: 'pointier', label: t('Pointier') },
            ]}
            value={borderStyle}
            onChange={setBorderStyle}
          />
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Lists')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show artwork'),
              value: showListArtwork,
              onChange: setShowListArtwork,
            },
            {
              label: t('Show song duration'),
              value: showSongDuration,
              onChange: setShowSongDuration,
            },
            ...(canRate
              ? [
                  {
                    label: t('Show rating'),
                    value: showListRating,
                    onChange: setShowListRating,
                  },
                ]
              : []),
            {
              label: t('Show explicit tag'),
              value: showExplicitTag,
              onChange: setShowExplicitTag,
            },
            {
              label: t('Show description'),
              value: showPlaylistDescription,
              onChange: setShowPlaylistDescription,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Album pages')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show artist photo'),
              value: showArtistPhoto,
              onChange: setShowArtistPhoto,
            },
            {
              label: t('Show disc titles'),
              value: showDiscHeaders,
              onChange: setShowDiscHeaders,
            },
            {
              label: t('Show genres'),
              value: showGenreChips,
              onChange: setShowGenreChips,
            },
            {
              label: t('Full-bleed album artwork'),
              description: t('The cover takes the full width and fades into the page.'),
              value: albumFullBleed,
              onChange: setAlbumFullBleed,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Gestures')}</Text>
        <SettingsGroup>
          <SelectList<SwipeAction>
            label={t('Swipe right')}
            options={swipeOptions}
            value={swipeAction}
            onChange={setSwipeAction}
          />
          <SelectList<SwipeAction>
            label={t('Swipe left')}
            options={swipeOptions}
            value={swipeLeftAction}
            onChange={setSwipeLeftAction}
          />
        </SettingsGroup>
      </SettingsScroll>
    </SettingsPage>
  );
}
