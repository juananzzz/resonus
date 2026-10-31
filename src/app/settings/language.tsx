/** Language picker — list with a radio on the active language. */
import { Linking, Text } from 'react-native';

import { SettingsScroll, SelectList, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { LANGUAGES } from '@/i18n/languages';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

// How to contribute a translation, rather than the folder of locale files: the
// guide explains what to do with them. The help block is in English on purpose:
// it's mostly read by those who don't find their language, so English is the
// most universal.
const TRANSLATIONS_URL = 'https://github.com/juananzzz/resonus/blob/main/TRANSLATING.md';

// Derived from the single source: a row added there appears here by itself.
// Sorted once, and by a fixed collation: with no locale given, `localeCompare`
// follows the app's own language, which changes as soon as one is picked. In
// Russian, Cyrillic sorts before Latin, so choosing Русский jumped it and
// Українська to the top of the list under the finger.
const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ value: l.code, label: l.name })).sort((a, b) =>
  a.label.localeCompare(b.label, 'en'),
);

export default function LanguageSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);

  return (
    <SettingsPage title={t('Language')}>
      <SettingsScroll>
        <SelectList
          options={LANGUAGE_OPTIONS}
          value={language}
          onChange={setLanguage}
          collapsible={false}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Translations')}</Text>
        <Text style={settingsStyles.sectionDescription}>
          {/* English on purpose, in every language: it is addressed to whoever
              could translate the app, and a translator reads English. */}
          {"Don't see your language, or want to improve an existing one? You can help by contributing a translation on GitHub. Pull requests are welcome."}
        </Text>
        <SettingRow
          icon="globe-outline"
          label={t('Help translate')}
          onPress={() => Linking.openURL(TRANSLATIONS_URL)}
        />
      </SettingsScroll>
    </SettingsPage>
  );
}
