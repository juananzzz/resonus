/** Ajustes › Cuenta: datos del servidor y cierre de sesión. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Field, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

export default function AccountSettings() {
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const logout = useAuthStore((s) => s.logout);

  return (
    <SettingsPage title={t('Account')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {offline ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Offline mode')}</Text>
            <View style={settingsStyles.card}>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: fontSize.md,
                  paddingVertical: spacing.lg,
                }}
              >
                {t('You are playing music stored on your device.')}
              </Text>
            </View>
            <Pressable style={settingsStyles.logout} onPress={() => logout()}>
              <Ionicons name="exit-outline" size={22} color={colors.danger} />
              <Text style={settingsStyles.logoutText}>{t('Exit')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Server')}</Text>
            <View style={settingsStyles.card}>
              <Field label={t('URL')} value={auth?.serverUrl ?? '—'} />
              <View style={settingsStyles.divider} />
              <Field label={t('Username')} value={auth?.username ?? '—'} />
            </View>
            <Pressable style={settingsStyles.logout} onPress={() => logout()}>
              <Ionicons name="log-out-outline" size={22} color={colors.danger} />
              <Text style={settingsStyles.logoutText}>{t('Sign out')}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SettingsPage>
  );
}
