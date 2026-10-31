/** Settings › Player › Lyrics: where lyrics come from and how they look. */
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  SettingsScroll,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import {
  type CardBackground,
  LYRICS_PROVIDER_NAMES,
  type LyricsAlign,
  type LyricsSize,
  type LyricsSource,
  type LyricsWeight,
  type ScreenBackground,
  useSettings,
} from '@/store/settings';
import { useTheme } from '@/theme';

export default function LyricsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const router = useRouter();
  const lyricsSource = useSettings((s) => s.lyricsSource);
  const setLyricsSource = useSettings((s) => s.setLyricsSource);
  const lyricsProviders = useSettings((s) => s.lyricsProviders);
  const lyricsSize = useSettings((s) => s.lyricsSize);
  const setLyricsSize = useSettings((s) => s.setLyricsSize);
  const lyricsWeight = useSettings((s) => s.lyricsWeight);
  const setLyricsWeight = useSettings((s) => s.setLyricsWeight);
  const lyricsAlign = useSettings((s) => s.lyricsAlign);
  const setLyricsAlign = useSettings((s) => s.setLyricsAlign);
  const blurInactiveLyrics = useSettings((s) => s.blurInactiveLyrics);
  const setBlurInactiveLyrics = useSettings((s) => s.setBlurInactiveLyrics);
  const lyricsBackground = useSettings((s) => s.lyricsBackground);
  const setLyricsBackground = useSettings((s) => s.setLyricsBackground);
  const lyricsCardBackground = useSettings((s) => s.lyricsCardBackground);
  const setLyricsCardBackground = useSettings((s) => s.setLyricsCardBackground);
  const showLyricsCard = useSettings((s) => s.showLyricsCard);
  const setShowLyricsCard = useSettings((s) => s.setShowLyricsCard);

  return (
    <SettingsPage title={t('Lyrics')}>
      <SettingsScroll>
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
          {/* Hidden with the search off, when there is nobody to ask. */}
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
          {showLyricsCard ? (
            <SelectList<CardBackground>
              label={t('Lyrics card background')}
              options={[
                { value: 'none', label: t('Plain') },
                { value: 'color', label: t('Cover color') },
              ]}
              value={lyricsCardBackground}
              onChange={setLyricsCardBackground}
            />
          ) : null}
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
        </SettingsGroup>
      </SettingsScroll>
    </SettingsPage>
  );
}
