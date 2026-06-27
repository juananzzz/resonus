/** Modo sin conexión: setup inicial para elegir el origen de la música. */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ensureAudioPermission,
  pickFolder,
} from '@/lib/localLibrary';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';

export default function OfflineScreen() {
  const t = useT();
  const logout = useAuthStore((s) => s.logout);
  const setSource = useAuthStore((s) => s.setOfflineSource);
  const toast = useToast((s) => s.show);

  async function chooseDevice() {
    const ok = await ensureAudioPermission();
    if (!ok) {
      toast(t('We need permission to read your device music.'));
      return;
    }
    void setSource({ mode: 'device' });
  }

  async function chooseFolder() {
    const uri = await pickFolder();
    if (uri) void setSource({ mode: 'folder', uri });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('Offline mode')}</Text>
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('Exit')}
          onPress={() => logout()}
        >
          <Ionicons name="exit-outline" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.setup}>
        <Text style={styles.setupTitle}>{t('Where should we get your music?')}</Text>

        <Pressable style={styles.option} onPress={chooseFolder}>
          <Ionicons name="folder-outline" size={28} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>{t('Choose a folder (recommended)')}</Text>
            <Text style={styles.optionSub}>{t('Only the music in the folder you choose.')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <Pressable style={styles.option} onPress={chooseDevice}>
          <Ionicons name="phone-portrait-outline" size={28} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>{t('Scan the whole phone')}</Text>
            <Text style={styles.optionSub}>{t('All the music on your device.')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  heading: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800' },
  setup: { paddingHorizontal: spacing.lg, gap: spacing.md, marginTop: spacing.lg },
  setupTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  optionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  optionSub: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
});
