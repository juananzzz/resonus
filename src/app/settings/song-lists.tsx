/**
 * Settings › Appearance › Song lists: what a song shows wherever it is listed.
 *
 * Its own screen, like the quick grid and the home sections. Eight switches
 * with a line of explanation each is a screenful, and it sat in the middle of
 * Appearance, between the language and the navigation bar, so everything under
 * it was a scroll away for anyone who had not come looking for this.
 */
import { ScrollView } from 'react-native';

import { SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

export default function SongListsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
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

  return (
    <SettingsPage title={t('Song lists')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={[
            {
              label: t('Show artwork'),
              description: t('Show the album artwork next to each song in playlists and favorites.'),
              value: showListArtwork,
              onChange: setShowListArtwork,
            },
            {
              label: t('Show song duration'),
              value: showSongDuration,
              onChange: setShowSongDuration,
            },
            {
              label: t('Show rating'),
              description: t("Show each song's star rating in lists."),
              value: showListRating,
              onChange: setShowListRating,
            },
            {
              label: t('Show explicit tag'),
              description: t(
                'Mark songs and albums tagged as explicit with an E, in lists, on the player and in album headers.',
              ),
              value: showExplicitTag,
              onChange: setShowExplicitTag,
            },
            {
              label: t('Show description'),
              description: t('Show playlist and album descriptions under their names.'),
              value: showPlaylistDescription,
              onChange: setShowPlaylistDescription,
            },
            {
              label: t('Show artist photo'),
              description: t('Show a round artist photo next to the name on album screens.'),
              value: showArtistPhoto,
              onChange: setShowArtistPhoto,
            },
            {
              label: t('Show disc titles'),
              description: t('Separate discs with a header on multi-disc albums.'),
              value: showDiscHeaders,
              onChange: setShowDiscHeaders,
            },
            {
              label: t('Show genres'),
              description: t("Show the album's genres as chips; tap one to browse it."),
              value: showGenreChips,
              onChange: setShowGenreChips,
            },
          ]}
        />
      </ScrollView>
    </SettingsPage>
  );
}
