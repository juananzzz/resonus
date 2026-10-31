/**
 * Settings › Appearance › Lists & albums: what song lists and album pages show.
 *
 * Its own screen, like the quick grid and the home sections. Eight switches
 * with a line of explanation each is a screenful, and it sat in the middle of
 * Appearance, between the language and the navigation bar, so everything under
 * it was a scroll away for anyone who had not come looking for this.
 */
import { ScrollView, Text } from 'react-native';

import {
  SelectList,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useSettings, type SwipeAction } from '@/store/settings';
import { useTheme } from '@/theme';

export default function SongListsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
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
    <SettingsPage title={t('Lists & albums')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {/* The first title sticks to the header (no section margin). */}
        <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Lists')}</Text>
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
      </ScrollView>
    </SettingsPage>
  );
}
