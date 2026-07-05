/** Ajustes › Calidad y reproducción: bitrate de streaming/descarga y autoplay. */
import { ScrollView } from 'react-native';

import { SelectList, SettingsPage, settingsStyles, SliderRow, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { BITRATE_OPTIONS, useSettings } from '@/store/settings';

export default function PlaybackSettings() {
  const t = useT();
  const maxBitRate = useSettings((s) => s.maxBitRate);
  const setMaxBitRate = useSettings((s) => s.setMaxBitRate);
  const downloadBitRate = useSettings((s) => s.downloadBitRate);
  const setDownloadBitRate = useSettings((s) => s.setDownloadBitRate);
  const autoplaySimilar = useSettings((s) => s.autoplaySimilar);
  const setAutoplaySimilar = useSettings((s) => s.setAutoplaySimilar);
  const crossfadeSec = useSettings((s) => s.crossfadeSec);
  const setCrossfadeSec = useSettings((s) => s.setCrossfadeSec);
  const lyricsOnlineFallback = useSettings((s) => s.lyricsOnlineFallback);
  const setLyricsOnlineFallback = useSettings((s) => s.setLyricsOnlineFallback);

  const bitrateOptions = BITRATE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }));

  return (
    <SettingsPage title={t('Quality & playback')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SelectList
          label={t('Streaming quality')}
          description={t('“Original” uses the highest quality; a lower bitrate saves data.')}
          options={bitrateOptions}
          value={maxBitRate}
          onChange={setMaxBitRate}
        />
        <SelectList
          label={t('Download quality')}
          options={bitrateOptions}
          value={downloadBitRate}
          onChange={setDownloadBitRate}
        />
        <SliderRow
          label={t('Crossfade')}
          description={t('Songs blend into each other when one ends.')}
          value={crossfadeSec}
          max={12}
          formatValue={(v) => (v === 0 ? t('No') : `${v} s`)}
          onChange={setCrossfadeSec}
        />
        <SwitchList
          options={[
            {
              label: t('Autoplay'),
              description: t('Keep playing similar songs when your queue ends.'),
              value: autoplaySimilar,
              onChange: setAutoplaySimilar,
            },
            {
              label: t('Find lyrics online'),
              description: t(
                'When a song has no lyrics, look them up on LRCLIB (sends the artist and title).',
              ),
              value: lyricsOnlineFallback,
              onChange: setLyricsOnlineFallback,
            },
          ]}
        />
      </ScrollView>
    </SettingsPage>
  );
}
