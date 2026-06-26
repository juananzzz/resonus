/** Ajustes: servidor, reproducción, almacenamiento, acerca de y sesión. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getScanStatus, startScan } from '@/api/subsonic';
import { useT } from '@/i18n';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { BITRATE_OPTIONS, useSettings, type Language } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

const REPO_URL = 'https://github.com/juananzzz/resonus';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const logout = useAuthStore((s) => s.logout);
  const maxBitRate = useSettings((s) => s.maxBitRate);
  const setMaxBitRate = useSettings((s) => s.setMaxBitRate);
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const toast = useToast((s) => s.show);
  const t = useT();

  const { data: scan, refetch: refetchScan } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: () => getScanStatus(auth!),
    enabled: !!auth,
  });

  async function clearCache() {
    queryClient.clear();
    await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]).catch(() => {});
    toast(t('Caché limpiada'));
  }

  async function scanNow() {
    if (!auth) return;
    try {
      await startScan(auth);
      toast(t('Escaneo iniciado'));
      setTimeout(() => refetchScan(), 1500);
    } catch {
      toast(t('No se pudo iniciar el escaneo'));
    }
  }

  const soon = () => toast(t('Próximamente 🚧'));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('Ajustes')}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>{t('Servidor')}</Text>
        <View style={styles.card}>
          <Field label="URL" value={auth?.serverUrl ?? '—'} />
          <View style={styles.divider} />
          <Field label={t('Usuario')} value={auth?.username ?? '—'} />
        </View>

        <Text style={styles.sectionTitle}>{t('Biblioteca')}</Text>
        <View style={styles.card}>
          <Field
            label={t('Estado del escaneo')}
            value={
              scan?.scanning
                ? t('Escaneando…')
                : t('{n} elementos', { n: scan?.count ?? 0 })
            }
          />
          <View style={styles.divider} />
          <Pressable style={styles.linkRow} onPress={scanNow}>
            <Ionicons name="refresh" size={22} color={colors.text} />
            <Text style={styles.rowText}>{t('Escanear ahora')}</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{t('Calidad de streaming')}</Text>
        <View style={styles.chips}>
          {BITRATE_OPTIONS.map((opt) => {
            const active = opt.value === maxBitRate;
            return (
              <Pressable
                key={opt.value}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => {
                  setMaxBitRate(opt.value);
                  toast(t('Calidad: {label}', { label: opt.label }));
                }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>
          {t('«Original» usa la máxima calidad; bajar el bitrate ahorra datos.')}
        </Text>

        <Text style={styles.sectionTitle}>{t('Reproducción')}</Text>
        <Pressable style={styles.rowButton} onPress={soon}>
          <Ionicons name="git-compare-outline" size={22} color={colors.text} />
          <Text style={styles.rowText}>{t('Crossfade')}</Text>
          <Text style={styles.soonTag}>{t('Pronto')}</Text>
        </Pressable>
        <Pressable style={styles.rowButton} onPress={soon}>
          <Ionicons name="options-outline" size={22} color={colors.text} />
          <Text style={styles.rowText}>{t('Ecualizador')}</Text>
          <Text style={styles.soonTag}>{t('Pronto')}</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>{t('Idioma')}</Text>
        <View style={styles.chips}>
          {LANGUAGES.map((opt) => {
            const active = opt.value === language;
            return (
              <Pressable
                key={opt.value}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setLanguage(opt.value)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>{t('Almacenamiento')}</Text>
        <Pressable style={styles.rowButton} onPress={clearCache}>
          <Ionicons name="trash-outline" size={22} color={colors.text} />
          <Text style={styles.rowText}>{t('Limpiar caché')}</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>{t('Acerca de')}</Text>
        <View style={styles.card}>
          <Field label="Versión" value="Resonus 1.0.0" />
          <View style={styles.divider} />
          <Pressable style={styles.linkRow} onPress={() => Linking.openURL(REPO_URL)}>
            <Ionicons name="logo-github" size={22} color={colors.text} />
            <Text style={styles.rowText}>{t('Ver en GitHub')}</Text>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        <Pressable style={styles.logout} onPress={() => logout()}>
          <Ionicons name="log-out-outline" size={22} color={colors.danger} />
          <Text style={styles.logoutText}>{t('Cerrar sesión')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: SCREEN_BOTTOM_PADDING },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  field: { paddingVertical: spacing.md },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs, marginBottom: 2 },
  fieldValue: { color: colors.text, fontSize: fontSize.md },
  divider: { height: 1, backgroundColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  chipTextActive: { color: '#000' },
  hint: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.xs },
  rowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  rowText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  soonTag: { color: colors.textMuted, fontSize: fontSize.xs },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },
  logoutText: { color: colors.danger, fontSize: fontSize.md, fontWeight: '600' },
});
