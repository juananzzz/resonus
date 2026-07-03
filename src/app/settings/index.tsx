/**
 * Ajustes estilo Spotify: la cuenta arriba como fila de perfil (avatar +
 * nombre + servidor), tres categorías como filas planas, el botón píldora de
 * cerrar sesión y un pie con el enlace al repositorio.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const logout = useAuthStore((s) => s.logout);
  const offline = useAuthStore((s) => s.offline);

  const initial = offline ? 'O' : (auth?.username ?? '?').charAt(0).toUpperCase();
  const name = offline ? t('Local profile') : auth?.username ?? '—';
  const detail = offline
    ? t('Music on your device')
    : auth?.serverUrl.replace(/^https?:\/\//, '') ?? '';

  // Reproducción es todo de servidor (bitrates, autoplay); en offline no pinta
  // nada. "Biblioteca" pasa a ser la música local.
  const sections = [
    ...(offline ? [] : [{ key: 'playback', title: 'Quality & playback' }]),
    { key: 'library', title: offline ? 'Local music' : 'Library' },
    { key: 'personalization', title: 'Appearance' },
    { key: 'about', title: 'About' },
  ];

  return (
    <SafeAreaView style={settingsStyles.safe} edges={['top']}>
      <ScreenHeader title={t('Settings')} />
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={settingsStyles.rowLabelBox}>
            <Text style={styles.profileName}>{name}</Text>
            <Text style={settingsStyles.rowDescription} numberOfLines={1}>
              {detail}
            </Text>
          </View>
        </View>

        {sections.map((s) => (
          <Pressable
            key={s.key}
            style={({ pressed }) => [styles.sectionRow, pressed && { opacity: 0.6 }]}
            onPress={() => router.push(`/settings/${s.key}`)}
          >
            <Text style={styles.sectionRowTitle}>{t(s.title)}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        ))}

        <Pressable style={settingsStyles.pillButton} onPress={() => logout()}>
          <Text style={settingsStyles.pillButtonText}>
            {offline ? t('Exit offline mode') : t('Sign out')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  // Mismo avatar que la cabecera de Inicio (anillo de acento) por coherencia.
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  profileName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  sectionRowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600', flex: 1 },
});
