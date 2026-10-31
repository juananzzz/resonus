/** Settings › Player: looks and extras for the playback screen. */
import type { AnimatedArtworkMode } from '@/lib/artworkLayout';
import { useRouter } from 'expo-router';
import { Platform, ScrollView, Text } from 'react-native';

import { canBlurBars } from '@/components/BarBlur';
import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
  SwitchList,
  TextRow,
} from '@/components/SettingsUI';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useTheme } from '@/theme';
import {
  type CardBackground,
  LYRICS_PROVIDER_NAMES,
  type CoverDoubleTapAction,
  type CoverTapAction,
  type LyricsAlign,
  type LyricsSize,
  type LyricsWeight,
  type MiniPlayerButtons,
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
  const animatedArtworkMode = useSettings((s) => s.animatedArtworkMode);
  const setAnimatedArtworkMode = useSettings((s) => s.setAnimatedArtworkMode);
  const animatedCoverVideo = useSettings((s) => s.animatedCoverVideo);
  const setAnimatedCoverVideo = useSettings((s) => s.setAnimatedCoverVideo);
  const animatedArtworkFps = useSettings((s) => s.animatedArtworkFps);
  const setAnimatedArtworkFps = useSettings((s) => s.setAnimatedArtworkFps);
  const animatedArtworkEndpoint = useSettings((s) => s.animatedArtworkEndpoint);
  const motionArtworkWifiOnly = useSettings((s) => s.motionArtworkWifiOnly);
  const setMotionArtworkWifiOnly = useSettings((s) => s.setMotionArtworkWifiOnly);
  const animatedCovers = useSettings((s) => s.animatedCovers);
  const setAnimatedCovers = useSettings((s) => s.setAnimatedCovers);
  const setAnimatedArtworkEndpoint = useSettings((s) => s.setAnimatedArtworkEndpoint);
  const miniPlayerColorBackground = useSettings((s) => s.miniPlayerColorBackground);
  const playerFullBleed = useSettings((s) => s.playerFullBleed);
  const setPlayerFullBleed = useSettings((s) => s.setPlayerFullBleed);
  const albumFullBleed = useSettings((s) => s.albumFullBleed);
  const setAlbumFullBleed = useSettings((s) => s.setAlbumFullBleed);
  const miniPlayerPills = useSettings((s) => s.miniPlayerPills);
  const setMiniPlayerPills = useSettings((s) => s.setMiniPlayerPills);
  const blurMiniPlayer = useSettings((s) => s.blurMiniPlayer);
  const miniPlayerProgress = useSettings((s) => s.miniPlayerProgress);
  const setMiniPlayerProgress = useSettings((s) => s.setMiniPlayerProgress);
  const miniPlayerButtons = useSettings((s) => s.miniPlayerButtons);
  const setMiniPlayerButtons = useSettings((s) => s.setMiniPlayerButtons);
  const lyricsSize = useSettings((s) => s.lyricsSize);
  const setLyricsSize = useSettings((s) => s.setLyricsSize);
  const lyricsWeight = useSettings((s) => s.lyricsWeight);
  const setLyricsWeight = useSettings((s) => s.setLyricsWeight);
  const lyricsAlign = useSettings((s) => s.lyricsAlign);
  const setLyricsAlign = useSettings((s) => s.setLyricsAlign);
  const blurInactiveLyrics = useSettings((s) => s.blurInactiveLyrics);
  const setBlurInactiveLyrics = useSettings((s) => s.setBlurInactiveLyrics);
  const setBlurMiniPlayer = useSettings((s) => s.setBlurMiniPlayer);
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
  const lyricsProviders = useSettings((s) => s.lyricsProviders);
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
        <SettingsGroup>
          <SwitchList options={[
            {
              label: t('Full-bleed album artwork'),
              value: albumFullBleed,
              onChange: setAlbumFullBleed,
            },
            {
              label: t('Full-bleed Now Playing artwork'),
              description: t('For static covers. Choose animated artwork separately below.'),
              value: playerFullBleed,
              onChange: setPlayerFullBleed,
            },
          ]} />
        </SettingsGroup>
        <SelectList<ScreenBackground>
          label={t('Player background')}
          options={[
            { value: 'none', label: t('Plain') },
            { value: 'color', label: t('Cover color') },
            { value: 'cover', label: t('Blurred cover') },
          ]}
          value={playerBackground}
          onChange={setPlayerBackground}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Mini player')}</Text>
        <SettingsGroup>
          <SwitchList
            options={[
              {
                label: t('Colored mini player'),
                value: miniPlayerColorBackground,
                onChange: setMiniPlayerColorBackground,
              },
              // Android draws the blur from Android 12 on (see `BarBlur`).
              ...(canBlurBars
                ? [
                    {
                      label: t('Mini player blur'),
                      value: blurMiniPlayer,
                      onChange: setBlurMiniPlayer,
                    },
                  ]
                : []),
              {
                label: t('Pill-shaped mini player'),
                value: miniPlayerPills,
                onChange: setMiniPlayerPills,
              },
              {
                label: t('Show progress bar'),
                value: miniPlayerProgress,
                onChange: setMiniPlayerProgress,
              },
            ]}
          />
          <SelectList<MiniPlayerButtons>
            label={t('Buttons next to play')}
            options={[
              { value: 'favorite', label: t('Favorite') },
              { value: 'next', label: t('Next') },
              { value: 'previousNext', label: t('Previous and next') },
              { value: 'none', label: t('None') },
            ]}
            value={miniPlayerButtons}
            onChange={setMiniPlayerButtons}
          />
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Cover art')}</Text>
        <SettingsGroup>
          <SwitchList
            options={[
              {
                label: t('Fit cover art'),
                value: fitCoverArt,
                onChange: setFitCoverArt,
              },
            ]}
          />
          <SelectList<CoverTapAction>
            label={t('On cover tap')}
            options={coverTapOptions(t)}
            value={coverTapAction}
            onChange={setCoverTapAction}
          />
          <SelectList<CoverDoubleTapAction>
            label={t('On cover double tap')}
            options={coverTapOptions(t)}
            value={coverDoubleTapAction}
            onChange={setCoverDoubleTapAction}
          />
        </SettingsGroup>

        {/* Their own section, the source first: what decides whether there is
            a clip at all comes before where it is shown (#263). */}
        <Text style={settingsStyles.sectionTitle}>{t('Animated covers')}</Text>
        <SettingsGroup>
          {/* The one switch for all of it. Off, the rest is hidden and kept: the
              server's address is not something to type again. */}
          <SwitchList
            options={[
              {
                label: t('Motion artwork on Wi-Fi only'),
                description: t('Use static covers and artist images on mobile data.'),
                value: motionArtworkWifiOnly,
                onChange: setMotionArtworkWifiOnly,
              },
              {
                label: t('Show animated covers'),
                value: animatedCovers,
                onChange: setAnimatedCovers,
              },
            ]}
          />
          {animatedCovers ? (
          <>
          <TextRow
            label={t('Animated artwork endpoint')}
            value={animatedArtworkEndpoint}
            placeholder="https://artwork.example.com"
            maxLength={200}
            keyboardType="url"
            autoCapitalize="none"
            // Stored raw: trimming trailing slashes here would eat the `//`
            // of `https://` while typing. The fetch normalizes before asking.
            onChange={setAnimatedArtworkEndpoint}
          />
          {/* Where, not whether: it also places a GIF or WebP cover from the
              server, with no endpoint at all. */}
          <SelectList<AnimatedArtworkMode>
            label={t('Animated artwork')}
            options={[
              { value: 'cover', label: t('In the cover') },
              { value: 'background', label: t('As the background') },
              { value: 'fullBleed', label: t('Full bleed') },
            ]}
            value={animatedArtworkMode}
            onChange={setAnimatedArtworkMode}
          />
          {/* iOS only: there the lock screen has a clip of its own, so the one
              in the app can go while that one stays. On Android an empty
              server is the same thing. */}
          {Platform.OS === 'ios' && animatedArtworkEndpoint ? (
            <>
              <SwitchList
                options={[
                  {
                    label: t('Clips in the app too'),
                    value: animatedCoverVideo,
                    onChange: setAnimatedCoverVideo,
                  },
                ]}
              />
              <SelectList<number>
                label={t('Animated cover frame rate')}
                options={[
                  { value: 30, label: t('30 fps') },
                  { value: 60, label: t('60 fps') },
                ]}
                value={animatedArtworkFps}
                onChange={setAnimatedArtworkFps}
              />
            </>
          ) : null}
          </>
          ) : null}
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Elements')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show album & year'),
              value: showAlbumInfo,
              onChange: setShowAlbumInfo,
            },
            {
              label: t('Show quality label'),
              value: showAudioQuality,
              onChange: setShowAudioQuality,
            },
            ...(canRate
              ? [
                  {
                    label: t('Show rating'),
                    value: showRating,
                    onChange: setShowRating,
                  },
                ]
              : []),
            {
              label: t('Scroll long titles'),
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
              value: showPlayedInQueue,
              onChange: setShowPlayedInQueue,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Buttons')}</Text>
        <SettingsGroup>
          <SettingRow
            label={t('Bottom row')}
            chevron
            onPress={() => router.push('/settings/player-buttons')}
          />
          <SwitchList
            options={[
              {
                label: t('Swap favorite and menu'),
                value: swapPlayerButtons,
                onChange: setSwapPlayerButtons,
              },
            ]}
          />
          <SelectList
            label={t('Skip buttons')}
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
                value: keepPausedOnSkip,
                onChange: setKeepPausedOnSkip,
              },
            ]}
          />
          <SelectList<PreviousButtonMode>
            label={t('Previous button')}
            options={[
              { value: 'restart', label: t('Restart, then previous track') },
              { value: 'always', label: t('Always previous track') },
            ]}
            value={previousButtonMode}
            onChange={setPreviousButtonMode}
          />
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Lyrics')}</Text>
        <SettingsGroup>
          <SelectList<LyricsSource>
            label={t('Lyrics source')}
            options={[
              { value: 'local', label: t('Prefer local lyrics') },
              { value: 'online', label: t('Prefer online search') },
              { value: 'off', label: t('Disable online search') },
            ]}
            value={lyricsSource}
            onChange={setLyricsSource}
          />
          {/* Which services online search asks and in what order, on a screen
              of their own like the bottom row's buttons. Hidden with the
              search off, when there is nobody to ask. */}
          {lyricsSource !== 'off' ? (
            <SettingRow
              label={t('Providers')}
              right={
                lyricsProviders
                  .filter((p) => p.enabled)
                  .map((p) => LYRICS_PROVIDER_NAMES[p.key])
                  .join(', ') || t('None')
              }
              chevron
              onPress={() => router.push('/settings/lyrics-providers')}
            />
          ) : null}
          <SelectList<LyricsSize>
            label={t('Lyrics size')}
            options={[
              { value: 'small', label: t('Small') },
              { value: 'normal', label: t('Normal') },
              { value: 'large', label: t('Large') },
            ]}
            value={lyricsSize}
            onChange={setLyricsSize}
          />
          <SelectList<LyricsWeight>
            label={t('Lyrics weight')}
            options={[
              { value: '300', label: t('Light font weight') },
              { value: '400', label: t('Regular font weight') },
              { value: '500', label: t('Medium font weight') },
              { value: '600', label: t('Semi-bold font weight') },
              { value: '700', label: t('Bold font weight') },
            ]}
            value={lyricsWeight}
            onChange={setLyricsWeight}
          />
          <SelectList<LyricsAlign>
            label={t('Lyrics alignment')}
            options={[
              { value: 'left', label: t('Left') },
              { value: 'center', label: t('Centered') },
            ]}
            value={lyricsAlign}
            onChange={setLyricsAlign}
          />
          <SwitchList
            options={[
              ...(Platform.OS === 'android'
                ? [
                    {
                      label: t('Blur inactive lyrics'),
                      value: blurInactiveLyrics,
                      onChange: setBlurInactiveLyrics,
                    },
                  ]
                : []),
              {
                label: t('Show lyrics card'),
                value: showLyricsCard,
                onChange: setShowLyricsCard,
              },
            ]}
          />
          <SelectList<ScreenBackground>
            label={t('Lyrics background')}
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
            options={[
              { value: 'none', label: t('Plain') },
              { value: 'color', label: t('Cover color') },
            ]}
            value={lyricsCardBackground}
            onChange={setLyricsCardBackground}
          />
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  );
}
