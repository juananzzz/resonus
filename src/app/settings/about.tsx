/** Ajustes › Acerca de: versión, repositorio, reportar bugs y comunidad. */
import Constants from 'expo-constants';
import { Linking, ScrollView } from 'react-native';

import { Field, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';

const REPO_URL = 'https://github.com/juananzzz/resonus';
const DISCORD_URL = 'https://discord.gg/hpDfszr8r';

export default function AboutSettings() {
  const t = useT();
  return (
    <SettingsPage title={t('About')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Field
          label={t('Version')}
          value={`Resonus v${Constants.expoConfig?.version ?? '?'}`}
        />
        <SettingRow
          icon="logo-github"
          label="GitHub"
          description="juananzzz/resonus"
          onPress={() => Linking.openURL(REPO_URL)}
        />
        <SettingRow
          icon="bug-outline"
          label={t('Report a bug')}
          onPress={() => Linking.openURL(`${REPO_URL}/issues/new`)}
        />
        <SettingRow
          icon="sparkles-outline"
          label={t("What's new")}
          onPress={() => Linking.openURL(`${REPO_URL}/releases`)}
        />
        <SettingRow
          icon="logo-discord"
          label="Discord"
          onPress={() => Linking.openURL(DISCORD_URL)}
        />
      </ScrollView>
    </SettingsPage>
  );
}
