/** Settings › Appearance: language, theme, font, corners and lists. */
import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useTheme, type BorderStyle } from '@/theme';
import {
  APP_FONT_LABELS,
  LANGUAGE_NAMES,
  useSettings,
  type CoverCorners,
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

  return (
    <SettingsPage title={t('Appearance')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
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
          <SettingRow
            label={t('Lists & albums')}
            chevron
            onPress={() => router.push('/settings/song-lists')}
          />
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  );
}
