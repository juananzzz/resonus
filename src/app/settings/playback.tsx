/**
 * Settings › Quality & playback: streaming bitrate, crossfade and autoplay.
 *
 * Offline, what is server-side stays where it is and is greyed out instead of
 * being taken away, so looking for a setting never ends in an empty screen
 * (#114). In the local profile it is taken away: there is no server that will
 * come back to make it work, and half a screen of permanent grey is not a
 * promise, it is furniture (see `useLocalProfile`). What is left is what the
 * phone can do on its own, which is the whole Sound section and the switches
 * that have nothing to do with a server.
 *
 * Download-related settings live in Settings › Downloads, and lyrics options in
 * Settings › Player.
 */
import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsPage,
  settingsStyles,
  SliderRow,
  SwitchList,
} from '@/components/SettingsUI';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useTheme } from '@/theme';
import {
  BITRATE_OPTIONS,
  clampReplayGainPreamp,
  REPLAY_GAIN_PREAMP_LIMIT,
  TRANSCODE_FORMATS,
  useSettings,
} from '@/store/settings';

export default function PlaybackSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const router = useRouter();
  const offline = useAuthStore((s) => s.offline);
  const local = useLocalProfile();
  const maxBitRate = useSettings((s) => s.maxBitRate);
  const setMaxBitRate = useSettings((s) => s.setMaxBitRate);
  const maxBitRateCellular = useSettings((s) => s.maxBitRateCellular);
  const setMaxBitRateCellular = useSettings((s) => s.setMaxBitRateCellular);
  const streamFormat = useSettings((s) => s.streamFormat);
  const setStreamFormat = useSettings((s) => s.setStreamFormat);
  const streamFormatCellular = useSettings((s) => s.streamFormatCellular);
  const setStreamFormatCellular = useSettings((s) => s.setStreamFormatCellular);
  const autoplaySimilar = useSettings((s) => s.autoplaySimilar);
  const syncQueueFromServer = useSettings((s) => s.syncQueueFromServer);
  const setSyncQueueFromServer = useSettings((s) => s.setSyncQueueFromServer);
  const setAutoplaySimilar = useSettings((s) => s.setAutoplaySimilar);
  const crossfadeSec = useSettings((s) => s.crossfadeSec);
  const setCrossfadeSec = useSettings((s) => s.setCrossfadeSec);
  const preloadUpcoming = useSettings((s) => s.preloadUpcoming);
  const preferDownloads = useSettings((s) => s.preferDownloads);
  const setPreferDownloads = useSettings((s) => s.setPreferDownloads);
  const setPreloadUpcoming = useSettings((s) => s.setPreloadUpcoming);
  const replayGain = useSettings((s) => s.replayGain);
  const setReplayGain = useSettings((s) => s.setReplayGain);
  const replayGainPreampDb = useSettings((s) => s.replayGainPreampDb);
  const setReplayGainPreampDb = useSettings((s) => s.setReplayGainPreampDb);
  const keepScreenAwake = useSettings((s) => s.keepScreenAwake);
  const batteryWarning = useSettings((s) => s.batteryWarning);
  const setBatteryWarning = useSettings((s) => s.setBatteryWarning);
  const setKeepScreenAwake = useSettings((s) => s.setKeepScreenAwake);

  // Only "Original" is a word; the rest are a number and a unit that read the
  // same in every language.
  const bitrateOptions = BITRATE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.value === 0 ? t('Original') : opt.label,
  }));
  const codecOptions = TRANSCODE_FORMATS.map((v) => ({
    value: v,
    label: v === '' ? t('Server default') : v.toUpperCase(),
  }));

  return (
    <SettingsPage title={t('Quality & playback')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {/* Nothing here exists without a server to stream from, so the local
            profile does not get the section at all: it is the one profile where
            these will never do anything (see `useLocalProfile`). Everything
            below it stands on its own and stays. */}
        {local ? null : (
          <>
            {/* The first title sticks to the header (no section margin). */}
            <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Streaming')}</Text>
            {/* Offline there is no stream, so none of this does anything. It is
                greyed out rather than taken away: a setting that is not where you
                left it sends you hunting through every other screen before you work
                out it was never there (#114). What each one says still holds for
                when the connection is back. A line saying as much used to stand
                here; a whole section in grey already says it, and being told twice
                reads like being talked down to (raised by @ztx-lyghters). */}
            {/* First, because it is the question of whether any of the quality
                settings below apply to a song at all. It used to sit under them,
                which read fine while they were four plain rows; under a heading it
                would have looked like one more mobile data setting. */}
            <SelectList
              label={t('Play downloaded songs from the phone')}
              description={t(
                'A downloaded song normally plays from the file, which costs no data. Choose otherwise if your downloads are smaller copies and you would rather stream the good one when you can. Without a connection the file is always used.',
              )}
              options={[
                { value: 'always', label: t('Always') },
                { value: 'cellular', label: t('On mobile data only') },
                { value: 'original', label: t('Only if it is the original file') },
                { value: 'never', label: t('Never') },
              ]}
              value={preferDownloads}
              onChange={setPreferDownloads}
              disabled={offline}
            />
            <SwitchList
              options={[
                {
                  label: t('Preload upcoming tracks'),
                  description: t('Request the next few tracks ahead of time so they start instantly. Helps with proxy servers like Octo-Fiesta or slow sources that fetch tracks on demand.'),
                  value: preloadUpcoming,
                  onChange: setPreloadUpcoming,
                  disabled: offline,
                },
              ]}
            />
            {/* One set per network, each under a heading of its own, instead of
                four rows in a row telling them apart by what is in brackets. The
                brackets stay: read on its own, out of the group it is under, a row
                still has to say which network it is about. Last in the section, so
                nothing after them falls under a heading it has nothing to do
                with. */}
            <Text style={settingsStyles.groupTitle}>Wi-Fi</Text>
            <SelectList
              label={t('Streaming quality (Wi-Fi)')}
              description={t(
                '“Original” is the file exactly as it is on the server, with nothing transcoded. A lower bitrate saves data and may cost audible quality.',
              )}
              options={bitrateOptions}
              value={maxBitRate}
              onChange={setMaxBitRate}
              disabled={offline}
            />
            {/* Each codec right under its own quality: the codec only applies
                where a bitrate is set. At "Original" nothing is transcoded, so the
                codec of that network has nothing to do and is greyed out rather
                than silently ignored (#72). */}
            <SelectList
              label={t('Streaming codec (Wi-Fi)')}
              description={
                maxBitRate > 0
                  ? t('Codec to transcode to. Your server must support it.')
                  : t('Codec to transcode to. At “Original” quality nothing is transcoded.')
              }
              options={codecOptions}
              value={streamFormat}
              onChange={setStreamFormat}
              disabled={offline || maxBitRate === 0}
              // "Not used" is about the quality above being "Original", which is
              // still worth saying offline; being offline is not, or every row in
              // the section would repeat the line already above it.
              disabledLabel={maxBitRate === 0 ? t('Not used') : undefined}
            />
            <Text style={settingsStyles.groupTitle}>{t('Mobile data')}</Text>
            {/* No descriptions in this group on purpose: they would be the same two
                paragraphs as above, in the same section. The Wi-Fi pair explains
                both. */}
            <SelectList
              label={t('Streaming quality (mobile data)')}
              options={bitrateOptions}
              value={maxBitRateCellular}
              onChange={setMaxBitRateCellular}
              disabled={offline}
            />
            <SelectList
              label={t('Streaming codec (mobile data)')}
              options={codecOptions}
              value={streamFormatCellular}
              onChange={setStreamFormatCellular}
              disabled={offline || maxBitRateCellular === 0}
              disabledLabel={maxBitRateCellular === 0 ? t('Not used') : undefined}
            />
          </>
        )}

        {/* First on the screen when the streaming section is gone, and a
            heading that sticks to the header wants no margin above it. */}
        <Text style={[settingsStyles.sectionTitle, local && { marginTop: 0 }]}>{t('Sound')}</Text>
        <SliderRow
          label={t('Crossfade')}
          description={t('Songs blend into each other when one ends.')}
          value={crossfadeSec}
          max={12}
          formatValue={(v) => (v === 0 ? t('No') : `${v} s`)}
          onChange={setCrossfadeSec}
        />
        <SelectList
          label={t('Normalize volume')}
          description={t("Evens out loudness between songs using your files' ReplayGain tags.")}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'auto', label: t('Automatic') },
            { value: 'track', label: t('By track') },
            { value: 'album', label: t('By album') },
          ]}
          value={replayGain}
          onChange={setReplayGain}
        />
        {/* Only with normalization on: with nothing normalizing, there is no
            level to move and the slider would do nothing at all. No description
            either: it sits right under the one that explains normalizing, and a
            paragraph that tall makes the row jump while the slider moves. */}
        {replayGain === 'off' ? null : (
          <SliderRow
            label={t('Pre-amp')}
            value={replayGainPreampDb}
            min={-REPLAY_GAIN_PREAMP_LIMIT}
            max={REPLAY_GAIN_PREAMP_LIMIT}
            step={0.5}
            formatValue={(v) => `${v > 0 ? '+' : ''}${clampReplayGainPreamp(v).toFixed(1)} dB`}
            // The slider covers the whole range in half dB steps; the tenths
            // that a finger can't land on are what the pad is for.
            fineTune={{ step: 0.1, doneLabel: t('Done') }}
            onChange={setReplayGainPreampDb}
          />
        )}
        <SettingRow
          label={t('Equalizer')}
          description={t('Tune the sound band by band.')}
          chevron
          onPress={() => router.push('/settings/equalizer')}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Playback')}</Text>
        <SwitchList
          options={[
            // What comes next is the server's idea of similar: offline there is
            // nothing to ask, and in the local profile there is nobody to ask.
            ...(local
              ? []
              : [
                  {
                    label: t('Autoplay'),
                    description: t('Keep playing similar songs when your queue ends. A mix you start yourself always does, even with this off.'),
                    value: autoplaySimilar,
                    onChange: setAutoplaySimilar,
                    disabled: offline,
                  },
                ]),
            // Server only: the queue on the server is the server's, and a
            // local profile does not have one.
            ...(local
              ? []
              : [
                  {
                    label: t('Pick up the queue from other players'),
                    description: t(
                      'When you open the app with nothing playing, take the queue another player left on the server if it is newer than this one. The ⋯ of the queue screen asks for it at any time.',
                    ),
                    value: syncQueueFromServer,
                    onChange: setSyncQueueFromServer,
                    disabled: offline,
                  },
                ]),
            {
              label: t('Keep screen on'),
              description: t('The screen never turns off while the app is visible.'),
              value: keepScreenAwake,
              onChange: setKeepScreenAwake,
            },
            {
              label: t('Warn about battery optimization'),
              description: t('Check on startup whether Android is restricting the app, which is what usually stops playback in the background.'),
              value: batteryWarning,
              onChange: setBatteryWarning,
            },
          ]}
        />

        {/* Its own screen: two sliders and a line of explanation is more than
            fits under a heading here, and it is a thing somebody sets once
            rather than one of the switches they come to this screen for. Last
            thing under Playback, where it belongs: a row after a heading it
            has nothing to do with reads as one of that heading's settings. */}
        <SettingRow
          label={t('Scrobbling')}
          description={t('When a song counts as played.')}
          chevron
          onPress={() => router.push('/settings/scrobbling')}
        />

        {/* Its own screen too, and next to Scrobbling rather than under a
            heading of its own: a switch, a choice and something to delete is a
            section, and a library with no books in it had to scroll past all
            three of them. Under Playback rather than Scrobbling, where this
            arrived: nothing there is reported to anybody, it is a position kept
            on the phone, and the rules for when a listen counts have nothing to
            say about it. */}
        <SettingRow
          label={t('Audiobooks')}
          description={t('Remembering where you left a book.')}
          chevron
          onPress={() => router.push('/settings/audiobooks')}
        />
      </ScrollView>
    </SettingsPage>
  );
}
