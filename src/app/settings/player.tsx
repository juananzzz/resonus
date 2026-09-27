/** Settings › Player: looks and extras for the playback screen. */
import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { SelectList, SettingRow, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useTheme } from '@/theme';
import {
  type CardBackground,
  type CoverDoubleTapAction,
  type CoverTapAction,
  type LyricsSource,
  type ScreenBackground,
  type PreviousButtonMode,
  useSettings,
} from '@/store/settings';

/**
 * The cover's actions, the same list for one tap and for two.
 *
 * Which of them belongs on which tap is the listener's call: play/pause on the
 * single and the lyrics on the double is as reasonable as the other way round.
 */
function coverTapOptions(t: ReturnType<typeof useT>): { value: CoverTapAction; label: string }[] {
  return [
    { value: 'none', label: t('Nothing') },
    { value: 'screen', label: t('Open lyrics screen') },
    { value: 'inline', label: t('Show lyrics on the cover') },
    { value: 'album', label: t('Go to album') },
    { value: 'playPause', label: t('Play or pause') },
    { value: 'favorite', label: t('Add to favorites') },
  ];
}

export default function PlayerSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const router = useRouter();
  // Rating is a Subsonic thing: needs a server account and doesn't apply to
  // Jellyfin. It does work offline (queued in the outbox and uploaded on
  // reconnect), so its toggle is also shown offline, same as in the player.
  const hasAccount = useAuthStore((s) => !!s.auth);
  const local = useLocalProfile();
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const canRate = hasAccount && serverType !== 'jellyfin';
  const showAudioQuality = useSettings((s) => s.showAudioQuality);
  const setShowAudioQuality = useSettings((s) => s.setShowAudioQuality);
  const showRating = useSettings((s) => s.showRating);
  const setShowRating = useSettings((s) => s.setShowRating);
  const showAlbumInfo = useSettings((s) => s.showAlbumInfo);
  const setShowAlbumInfo = useSettings((s) => s.setShowAlbumInfo);
  const swapPlayerButtons = useSettings((s) => s.swapPlayerButtons);
  const setSwapPlayerButtons = useSettings((s) => s.setSwapPlayerButtons);
  const showPlayedInQueue = useSettings((s) => s.showPlayedInQueue);
  const setShowPlayedInQueue = useSettings((s) => s.setShowPlayedInQueue);
  const playerBackground = useSettings((s) => s.playerBackground);
  const setPlayerBackground = useSettings((s) => s.setPlayerBackground);
  const fitCoverArt = useSettings((s) => s.fitCoverArt);
  const setFitCoverArt = useSettings((s) => s.setFitCoverArt);
  const animatedCoverBackground = useSettings((s) => s.animatedCoverBackground);
  const setAnimatedCoverBackground = useSettings((s) => s.setAnimatedCoverBackground);
  const miniPlayerColorBackground = useSettings((s) => s.miniPlayerColorBackground);
  const setMiniPlayerColorBackground = useSettings((s) => s.setMiniPlayerColorBackground);
  const lyricsBackground = useSettings((s) => s.lyricsBackground);
  const setLyricsBackground = useSettings((s) => s.setLyricsBackground);
  const lyricsCardBackground = useSettings((s) => s.lyricsCardBackground);
  const setLyricsCardBackground = useSettings((s) => s.setLyricsCardBackground);
  const showLyricsCard = useSettings((s) => s.showLyricsCard);
  const setShowLyricsCard = useSettings((s) => s.setShowLyricsCard);
  const showArtistCard = useSettings((s) => s.showArtistCard);
  const setShowArtistCard = useSettings((s) => s.setShowArtistCard);
  const coverTapAction = useSettings((s) => s.coverTapAction);
  const coverDoubleTapAction = useSettings((s) => s.coverDoubleTapAction);
  const setCoverDoubleTapAction = useSettings((s) => s.setCoverDoubleTapAction);
  const setCoverTapAction = useSettings((s) => s.setCoverTapAction);
  const lyricsSource = useSettings((s) => s.lyricsSource);
  const setLyricsSource = useSettings((s) => s.setLyricsSource);
  const marqueeTitles = useSettings((s) => s.marqueeTitles);
  const setMarqueeTitles = useSettings((s) => s.setMarqueeTitles);
  const seekButtonsSec = useSettings((s) => s.seekButtonsSec);
  const setSeekButtonsSec = useSettings((s) => s.setSeekButtonsSec);
  const previousButtonMode = useSettings((s) => s.previousButtonMode);
  const setPreviousButtonMode = useSettings((s) => s.setPreviousButtonMode);
  const keepPausedOnSkip = useSettings((s) => s.keepPausedOnSkip);
  const setKeepPausedOnSkip = useSettings((s) => s.setKeepPausedOnSkip);

  return (
    <SettingsPage title={t('Player')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {/* The first title sticks to the header (no section margin). */}
        <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Background')}</Text>
        <SelectList<ScreenBackground>
          label={t('Player background')}
          description={t('What fills the space behind the player.')}
          options={[
            { value: 'none', label: t('Plain') },
            { value: 'color', label: t('Cover color') },
            { value: 'cover', label: t('Blurred cover') },
          ]}
          value={playerBackground}
          onChange={setPlayerBackground}
        />
        <SwitchList
          options={[
            {
              label: t('Colored mini player'),
              description: t('Tint the mini player with the cover color.'),
              value: miniPlayerColorBackground,
              onChange: setMiniPlayerColorBackground,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Cover art')}</Text>
        <SwitchList
          options={[
            {
              label: t('Fit cover art'),
              description: t('Show the whole artwork instead of cropping it to a square.'),
              value: fitCoverArt,
              onChange: setFitCoverArt,
            },
            {
              label: t('Animated cover background'),
              description: t(
                'An animated cover fills the player behind the controls, with a still copy of it beside the title.',
              ),
              value: animatedCoverBackground,
              onChange: setAnimatedCoverBackground,
            },
          ]}
        />
        <SelectList<CoverTapAction>
          label={t('On cover tap')}
          description={t('What tapping the cover art in the player does.')}
          options={coverTapOptions(t)}
          value={coverTapAction}
          onChange={setCoverTapAction}
        />
        <SelectList<CoverDoubleTapAction>
          label={t('On cover double tap')}
          description={t(
            'A second action for the same artwork, for a hand that is not looking. With this on, a single tap waits a moment to see whether a second one is coming.',
          )}
          options={coverTapOptions(t)}
          value={coverDoubleTapAction}
          onChange={setCoverDoubleTapAction}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Elements')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show album & year'),
              description: t('Show the album name and release year next to the artist.'),
              value: showAlbumInfo,
              onChange: setShowAlbumInfo,
            },
            {
              label: t('Show quality label'),
              description: t('Show format and bitrate in the player.'),
              value: showAudioQuality,
              onChange: setShowAudioQuality,
            },
            ...(canRate
              ? [
                  {
                    label: t('Show rating'),
                    description: t('Show a star rating bar to rate the current song.'),
                    value: showRating,
                    onChange: setShowRating,
                  },
                ]
              : []),
            {
              label: t('Scroll long titles'),
              description: t("Song and artist names that don't fit scroll across."),
              value: marqueeTitles,
              onChange: setMarqueeTitles,
            },
            // The biography comes from the server, and the local profile has
            // none to come: the row goes rather than staying dead.
            ...(local
              ? []
              : [
                  {
                    label: t('Show artist card'),
                    description: t("The artist's photo and biography, below the player controls."),
                    value: showArtistCard,
                    onChange: setShowArtistCard,
                  },
                ]),
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Queue')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show previous tracks'),
              description: t(
                'Keep the tracks before the current one in the queue, dimmed. Tap one to go back.',
              ),
              value: showPlayedInQueue,
              onChange: setShowPlayedInQueue,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Buttons')}</Text>
        <SettingRow
          label={t('Bottom row')}
          description={t('Which buttons are under the controls, and in what order.')}
          chevron
          onPress={() => router.push('/settings/player-buttons')}
        />
        <SwitchList
          options={[
            {
              label: t('Swap favorite and menu'),
              description: t(
                'Put the ⋯ menu next to the title and the heart in the top bar, easier to reach one-handed.',
              ),
              value: swapPlayerButtons,
              onChange: setSwapPlayerButtons,
            },
          ]}
        />
        <SelectList
          label={t('Skip buttons')}
          description={t('Jump back or forward next to the play button.')}
          options={[
            { value: 0, label: t('No') },
            { value: 5, label: '5 s' },
            { value: 10, label: '10 s' },
            { value: 30, label: '30 s' },
          ]}
          value={seekButtonsSec}
          onChange={setSeekButtonsSec}
        />
        {/* With the skip buttons rather than with the queue: it is about what
            ⏭ and ⏮ do, and about the swipe across the cover, which is the same
            thing with a finger. */}
        <SwitchList
          options={[
            {
              label: t('Keep paused when skipping'),
              description: t(
                'Skipping while paused shows the next song without playing it. Tapping a song in the queue still plays it.',
              ),
              value: keepPausedOnSkip,
              onChange: setKeepPausedOnSkip,
            },
          ]}
        />
        <SelectList<PreviousButtonMode>
          label={t('Previous button')}
          description={t('What the previous button does partway through a song.')}
          options={[
            { value: 'restart', label: t('Restart, then previous track') },
            { value: 'always', label: t('Always previous track') },
          ]}
          value={previousButtonMode}
          onChange={setPreviousButtonMode}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Lyrics')}</Text>
        <SelectList<LyricsSource>
          label={t('Lyrics source')}
          description={t(
            'Where to get lyrics from. Online search uses LRCLIB (sends the artist and title).',
          )}
          options={[
            { value: 'local', label: t('Prefer local lyrics') },
            { value: 'online', label: t('Prefer online search') },
            { value: 'off', label: t('Disable online search') },
          ]}
          value={lyricsSource}
          onChange={setLyricsSource}
        />
        <SwitchList
          options={[
            {
              label: t('Show lyrics card'),
              description: t('The lyrics card below the player controls.'),
              value: showLyricsCard,
              onChange: setShowLyricsCard,
            },
          ]}
        />
        <SelectList<ScreenBackground>
          label={t('Lyrics background')}
          description={t('What fills the space behind the lyrics screen.')}
          options={[
            { value: 'none', label: t('Plain') },
            { value: 'color', label: t('Cover color') },
            { value: 'cover', label: t('Blurred cover') },
          ]}
          value={lyricsBackground}
          onChange={setLyricsBackground}
        />
        <SelectList<CardBackground>
          label={t('Lyrics card background')}
          description={t('The card that peeks below the player controls.')}
          options={[
            { value: 'none', label: t('Plain') },
            { value: 'color', label: t('Cover color') },
          ]}
          value={lyricsCardBackground}
          onChange={setLyricsCardBackground}
        />
      </ScrollView>
    </SettingsPage>
  );
}
