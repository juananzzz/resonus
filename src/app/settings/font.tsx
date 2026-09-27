/** Font picker — list with radio on the active one, plus custom font. */
import * as DocumentPicker from 'expo-document-picker';
import * as Font from 'expo-font';
import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';

import { SettingRow, SelectList, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { importCustomFont, removeCustomFontFiles } from '@/lib/customFont';
import { APP_FONT_LABELS, type AppFont, useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

export default function FontSettings() {
  useTheme();
  const t = useT();
  const appFont = useSettings((s) => s.appFont);
  const setAppFont = useSettings((s) => s.setAppFont);
  const customFontFamily = useSettings((s) => s.customFontFamily);
  const customFontUri = useSettings((s) => s.customFontUri);
  const setCustomFont = useSettings((s) => s.setCustomFont);
  const [picking, setPicking] = useState(false);

  const options: { value: AppFont; label: string }[] = (
    (Object.keys(APP_FONT_LABELS) as AppFont[]).filter((v) => v !== 'custom')
  ).map((value) => ({
    value,
    label: value === 'system' ? `${APP_FONT_LABELS.system} (${t('default')})` : APP_FONT_LABELS[value],
  }));

  async function pickFont() {
    if (picking) return;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['font/ttf', 'font/otf', 'application/x-font-ttf', 'application/x-font-otf',
          'application/font-sfnt', 'application/x-openfont', 'font/opentype',
          'font/sfnt', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const { family, file } = await importCustomFont(asset.uri, asset.name);
      setCustomFont(family, file);
      setAppFont('custom');
    } catch {
      Alert.alert(t("Couldn't load the font"), t('Make sure the file is a valid .ttf or .otf font.'));
    } finally {
      setPicking(false);
    }
  }

  function removeCustomFont() {
    setCustomFont(null, null);
    setAppFont('system');
    void removeCustomFontFiles();
  }

  // Only "Active" when it really is: a font that failed to load (a missing
  // file, say) leaves the app on the system font.
  const customActive = appFont === 'custom' && !!customFontFamily && Font.isLoaded(customFontFamily);

  return (
    <SettingsPage title={t('Font')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SelectList options={options} value={appFont} onChange={setAppFont} collapsible={false} />
        <SettingRow
          label={APP_FONT_LABELS.custom}
          description={
            customActive
              ? customFontUri?.split('/').pop() ?? t('Loaded')
              : t('Load a .ttf or .otf file')
          }
          icon="color-filter-outline"
          right={customActive ? t('Active') : undefined}
          onPress={pickFont}
        />
        {appFont === 'custom' && customFontFamily ? (
          <SettingRow
            label={t('Remove custom font')}
            destructive
            onPress={removeCustomFont}
          />
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
