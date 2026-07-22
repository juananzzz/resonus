/** Language picker — list with a radio on the active language. */
import { Linking, ScrollView, Text } from 'react-native';

import { SelectList, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { LANGUAGES } from '@/i18n/languages';
import { useSettings } from '@/store/settings';

// Repo de las traducciones. El bloque de ayuda va en inglés a propósito: lo
// leen sobre todo quienes no encuentran su idioma, así que el inglés es lo más
// universal.
const TRANSLATIONS_URL = 'https://github.com/juananzzz/resonus/tree/main/src/i18n/locales';

// Derivado de la fuente única: la fila que se añade allí aparece sola aquí.
const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ value: l.code, label: l.name }));

export default function LanguageSettings() {
  const t = useT();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);

  return (
    <SettingsPage title={t('Language')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SelectList
          options={[...LANGUAGE_OPTIONS].sort((a, b) => a.label.localeCompare(b.label))}
          value={language}
          onChange={setLanguage}
          collapsible={false}
        />

        <Text style={settingsStyles.sectionTitle}>Translations</Text>
        <Text style={settingsStyles.sectionDescription}>
          Don&apos;t see your language, or want to improve an existing one? You can help by
          contributing a translation on GitHub. Pull requests are welcome.
        </Text>
        <SettingRow
          icon="globe-outline"
          label="Help translate"
          onPress={() => Linking.openURL(TRANSLATIONS_URL)}
        />
      </ScrollView>
    </SettingsPage>
  );
}
