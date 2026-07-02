/** Ajustes › Biblioteca: estado del escaneo y limpieza de caché. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rescanLocal } from '@/api/data';
import { getScanStatus, startScan } from '@/api/subsonic';
import { Field, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { ensureAudioPermission, pickFolder } from '@/lib/localLibrary';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing } from '@/theme';

export default function LibrarySettings() {
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const source = useAuthStore((s) => s.offlineSource);
  const setSource = useAuthStore((s) => s.setOfflineSource);
  const toast = useToast((s) => s.show);
  const insets = useSafeAreaInsets();
  const [rescanning, setRescanning] = useState(false);
  const [changing, setChanging] = useState(false);

  async function chooseFolder() {
    const uri = await pickFolder();
    if (!uri) return;
    await setSource({ mode: 'folder', uri });
    setChanging(false);
    toast(t('Source updated'));
  }

  async function chooseDevice() {
    const ok = await ensureAudioPermission();
    if (!ok) {
      toast(t('We need permission to read your device music.'));
      return;
    }
    await setSource({ mode: 'device' });
    setChanging(false);
    toast(t('Source updated'));
  }

  async function rescanNow() {
    if (rescanning) return;
    setRescanning(true);
    toast(t('Rescanning your music…'));
    try {
      await rescanLocal();
      queryClient.invalidateQueries();
      toast(t('Library updated'));
    } catch {
      toast(t("Couldn't rescan"));
    } finally {
      setRescanning(false);
    }
  }

  const { data: scan, refetch: refetchScan } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: () => getScanStatus(auth!),
    enabled: !!auth,
  });

  async function scanNow() {
    if (!auth) return;
    try {
      await startScan(auth);
      toast(t('Scan started'));
      setTimeout(() => refetchScan(), 1500);
    } catch {
      toast(t("Couldn't start the scan"));
    }
  }

  async function clearCache() {
    queryClient.clear();
    await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]).catch(() => {});
    toast(t('Cache cleared'));
  }

  return (
    <SettingsPage title={t('Library')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {offline ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Offline mode')}</Text>
            <View style={settingsStyles.card}>
              <Field
                label={t('Source')}
                value={source?.mode === 'folder' ? t('Folder') : t('Device')}
              />
            </View>
            <Pressable
              style={settingsStyles.rowButton}
              disabled={rescanning}
              onPress={rescanNow}
            >
              {rescanning ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="refresh" size={22} color={colors.text} />
              )}
              <Text style={settingsStyles.rowText}>{t('Rescan')}</Text>
            </Pressable>
            <Pressable
              style={settingsStyles.rowButton}
              onPress={() => setChanging(true)}
            >
              <Ionicons name="swap-horizontal" size={22} color={colors.text} />
              <Text style={settingsStyles.rowText}>{t('Change source')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Library')}</Text>
            <View style={settingsStyles.card}>
              <Field
                label={t('Scan status')}
                value={scan?.scanning ? t('Scanning…') : t('{n} items', { n: scan?.count ?? 0 })}
              />
              <View style={settingsStyles.divider} />
              <Pressable style={settingsStyles.linkRow} onPress={scanNow}>
                <Ionicons name="refresh" size={22} color={colors.text} />
                <Text style={settingsStyles.rowText}>{t('Scan now')}</Text>
              </Pressable>
            </View>
          </>
        )}

        <Text style={settingsStyles.sectionTitle}>{t('Storage')}</Text>
        <Pressable style={settingsStyles.rowButton} onPress={clearCache}>
          <Ionicons name="trash-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Clear cache')}</Text>
        </Pressable>
      </ScrollView>

      <Modal
        transparent
        animationType="fade"
        visible={changing}
        onRequestClose={() => setChanging(false)}
      >
        <Pressable style={sheetStyles.backdrop} onPress={() => setChanging(false)} />
        <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={sheetStyles.title}>{t('Where should we get your music?')}</Text>

          <Pressable style={sheetStyles.option} onPress={chooseFolder}>
            <Ionicons name="folder-outline" size={26} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={sheetStyles.optionTitle}>{t('Choose a folder (recommended)')}</Text>
              <Text style={sheetStyles.optionSub}>{t('Only the music in the folder you choose.')}</Text>
            </View>
          </Pressable>

          <Pressable style={sheetStyles.option} onPress={chooseDevice}>
            <Ionicons name="phone-portrait-outline" size={26} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={sheetStyles.optionTitle}>{t('Scan the whole phone')}</Text>
              <Text style={sheetStyles.optionSub}>{t('All the music on your device.')}</Text>
            </View>
          </Pressable>
        </View>
      </Modal>
    </SettingsPage>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  optionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  optionSub: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
});
