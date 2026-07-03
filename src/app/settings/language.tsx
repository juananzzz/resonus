/** Language picker — list with a radio on the active language. */
import { ScrollView } from 'react-native';

import { SelectList, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings, type Language } from '@/store/settings';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

export default function LanguageSettings() {
  const t = useT();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);

  return (
    <SettingsPage title={t('Language')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SelectList
          options={[...LANGUAGES].sort((a, b) => a.label.localeCompare(b.label))}
          value={language}
          onChange={setLanguage}
          collapsible={false}
        />
      </ScrollView>
    </SettingsPage>
  );
}
