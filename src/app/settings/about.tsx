/** Ajustes › Acerca de: versión y enlace al repositorio. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Field, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { colors } from '@/theme';

const REPO_URL = 'https://github.com/juananzzz/resonus';

export default function AboutSettings() {
  const t = useT();
  return (
    <SettingsPage title={t('About')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <View style={settingsStyles.card}>
          <Field label={t('Version')} value="Resonus 0.1.2 (beta)" />
          <View style={settingsStyles.divider} />
          <Pressable style={settingsStyles.linkRow} onPress={() => Linking.openURL(REPO_URL)}>
            <Ionicons name="logo-github" size={22} color={colors.text} />
            <Text style={settingsStyles.rowText}>{t('View on GitHub')}</Text>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </ScrollView>
    </SettingsPage>
  );
}
