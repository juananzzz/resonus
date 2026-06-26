/** Ajustes: lista de categorías estilo Spotify. Cada una abre su sub-pantalla. */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

type Section = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
};

const SECTIONS: Section[] = [
  { key: 'account', icon: 'person-circle-outline', title: 'Cuenta', subtitle: 'Servidor · Cerrar sesión' },
  { key: 'library', icon: 'server-outline', title: 'Biblioteca', subtitle: 'Escaneo · Limpiar caché' },
  {
    key: 'playback',
    icon: 'musical-notes-outline',
    title: 'Calidad y reproducción',
    subtitle: 'Calidad · Crossfade · Ecualizador',
  },
  { key: 'display', icon: 'phone-portrait-outline', title: 'Pantalla', subtitle: 'Idioma' },
  { key: 'about', icon: 'information-circle-outline', title: 'Acerca de', subtitle: 'Versión · GitHub' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const t = useT();
  const logout = useAuthStore((s) => s.logout);
  const offline = useAuthStore((s) => s.offline);

  // En offline no hay cuenta de servidor; la sección "Biblioteca" pasa a ser
  // la música local (origen + volver a escanear).
  const visible = (offline ? SECTIONS.filter((s) => s.key !== 'account') : SECTIONS).map((s) =>
    offline && s.key === 'library'
      ? { ...s, title: 'Música local', subtitle: 'Origen · Volver a escanear' }
      : s,
  );

  return (
    <SafeAreaView style={settingsStyles.safe} edges={['top']}>
      <ScreenHeader title={t('Ajustes')} />
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {visible.map((s) => (
          <Pressable
            key={s.key}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            onPress={() => router.push(`/settings/${s.key}`)}
          >
            <Ionicons name={s.icon} size={26} color={colors.text} />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>{t(s.title)}</Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                {t(s.subtitle)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        ))}

        <Pressable style={settingsStyles.logout} onPress={() => logout()}>
          <Ionicons name={offline ? 'exit-outline' : 'log-out-outline'} size={22} color={colors.danger} />
          <Text style={settingsStyles.logoutText}>{offline ? t('Salir del modo sin conexión') : t('Cerrar sesión')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  rowSubtitle: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
});
