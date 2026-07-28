/**
 * Settings › Quality & playback: streaming bitrate, crossfade and autoplay. In
 * offline mode only settings that apply locally are shown (crossfade, normalize,
 * keep screen on); the rest is server-side. Download-related settings live in
 * Settings › Downloads, and lyrics options in Settings › Player.
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
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { BITRATE_OPTIONS, TRANSCODE_FORMATS, useSettings } from '@/store/settings';

export default function PlaybackSettings() {
  const t = useT();
  const router = useRouter();
  const offline = useAuthStore((s) => s.offline);
  const maxBitRate = useSettings((s) => s.maxBitRate);
  const setMaxBitRate = useSettings((s) => s.setMaxBitRate);
  const maxBitRateCellular = useSettings((s) => s.maxBitRateCellular);
  const setMaxBitRateCellular = useSettings((s) => s.setMaxBitRateCellular);
  const streamFormat = useSettings((s) => s.streamFormat);
  const setStreamFormat = useSettings((s) => s.setStreamFormat);
  const autoplaySimilar = useSettings((s) => s.autoplaySimilar);
  const setAutoplaySimilar = useSettings((s) => s.setAutoplaySimilar);
  const crossfadeSec = useSettings((s) => s.crossfadeSec);
  const setCrossfadeSec = useSettings((s) => s.setCrossfadeSec);
  const gapless = useSettings((s) => s.gapless);
  const setGapless = useSettings((s) => s.setGapless);
  const preloadUpcoming = useSettings((s) => s.preloadUpcoming);
  const setPreloadUpcoming = useSettings((s) => s.setPreloadUpcoming);
  const replayGain = useSettings((s) => s.replayGain);
  const setReplayGain = useSettings((s) => s.setReplayGain);
  const keepScreenAwake = useSettings((s) => s.keepScreenAwake);
  const batteryWarning = useSettings((s) => s.batteryWarning);
  const setBatteryWarning = useSettings((s) => s.setBatteryWarning);
  const setKeepScreenAwake = useSettings((s) => s.setKeepScreenAwake);

  const bitrateOptions = BITRATE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }));
  const codecOptions = TRANSCODE_FORMATS.map((v) => ({
    value: v,
    label: v === '' ? t('Server default') : v.toUpperCase(),
  }));

  return (
    <SettingsPage title={t('Quality & playback')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {offline ? null : (
          <>
            {/* The first title sticks to the header (no section margin). */}
            <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Streaming')}</Text>
            <SelectList
              label={t('Streaming codec')}
              description={t('Codec to transcode to. Only used at a set bitrate (not “Original”), and your server must support it.')}
              options={codecOptions}
              value={streamFormat}
              onChange={setStreamFormat}
            />
            <SelectList
              label={t('Streaming quality (Wi-Fi)')}
              description={t('“Original” uses the highest quality; a lower bitrate saves data.')}
              options={bitrateOptions}
              value={maxBitRate}
              onChange={setMaxBitRate}
            />
            <SelectList
              label={t('Streaming quality (mobile data)')}
              options={bitrateOptions}
              value={maxBitRateCellular}
              onChange={setMaxBitRateCellular}
            />
            <SwitchList
              options={[
                {
                  label: t('Preload upcoming tracks'),
                  description: t('Request the next few tracks ahead of time so they start instantly. Helps with proxy servers like Octo-Fiesta or slow sources that fetch tracks on demand.'),
                  value: preloadUpcoming,
                  onChange: setPreloadUpcoming,
                },
              ]}
            />
          </>
        )}

        {/* In offline there's no Streaming section: this becomes the first title. */}
        <Text style={[settingsStyles.sectionTitle, offline && { marginTop: 0 }]}>
          {t('Sound')}
        </Text>
        {/* Above crossfade, and saying so: the two decide the same moment, and
            with crossfade set it's the one that runs. */}
        <SwitchList
          options={[
            {
              label: t('Gapless playback'),
              description: t('No silence between songs: the next one is prepared while the current one plays. Crossfade, if set, takes over.'),
              value: gapless,
              onChange: setGapless,
            },
          ]}
        />
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
        <SettingRow
          label={t('Equalizer')}
          description={t('Tune the sound band by band.')}
          chevron
          onPress={() => router.push('/settings/equalizer')}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Playback')}</Text>
        <SwitchList
          options={[
            ...(offline
              ? []
              : [
                  {
                    label: t('Autoplay'),
                    description: t('Keep playing similar songs when your queue ends. A mix you start yourself always does, even with this off.'),
                    value: autoplaySimilar,
                    onChange: setAutoplaySimilar,
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


      </ScrollView>
    </SettingsPage>
  );
}
