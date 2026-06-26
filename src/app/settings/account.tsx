/** Ajustes › Cuenta: datos del servidor y cierre de sesión. */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Field, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/theme';

export default function AccountSettings() {
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const logout = useAuthStore((s) => s.logout);

  return (
    <SettingsPage title={t('Cuenta')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionTitle}>{t('Servidor')}</Text>
        <View style={settingsStyles.card}>
          <Field label="URL" value={auth?.serverUrl ?? '—'} />
          <View style={settingsStyles.divider} />
          <Field label={t('Usuario')} value={auth?.username ?? '—'} />
        </View>

        <Pressable style={settingsStyles.logout} onPress={() => logout()}>
          <Ionicons name="log-out-outline" size={22} color={colors.danger} />
          <Text style={settingsStyles.logoutText}>{t('Cerrar sesión')}</Text>
        </Pressable>
      </ScrollView>
    </SettingsPage>
  );
}
