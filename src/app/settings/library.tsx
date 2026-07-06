/** Ajustes › Biblioteca: escaneo, espacio de descargas y limpieza de caché. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rescanLocal } from '@/api/data';
import { getScanStatus, startScan } from '@/api/backend';
import { Dialog } from '@/components/Dialog';
import { Field, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { songsLabel, useT } from '@/i18n';
import { ensureAudioPermission, pickFolder } from '@/lib/localLibrary';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing } from '@/theme';

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export default function LibrarySettings() {
  useSettings((s) => s.accentColor); // re-render al cambiar el acento
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const source = useAuthStore((s) => s.offlineSource);
  const setSource = useAuthStore((s) => s.setOfflineSource);
  const toast = useToast((s) => s.show);
  const insets = useSafeAreaInsets();
  const lang = useSettings((s) => s.language);
  const files = useDownloads((s) => s.files);
  const usageBytes = useDownloads((s) => s.usageBytes);
  const clearAll = useDownloads((s) => s.clearAll);
  const [rescanning, setRescanning] = useState(false);
  const [changing, setChanging] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const count = Object.keys(files).length;

  useEffect(() => {
    let active = true;
    usageBytes().then((n) => {
      if (active) setUsage(n);
    });
    return () => {
      active = false;
    };
  }, [usageBytes, count]);

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
    // Mientras el servidor escanea, el contador se refresca solo.
    refetchInterval: (query) => (query.state.data?.scanning ? 2000 : false),
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
    <SettingsPage title={offline ? t('Local music') : t('Library')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {offline ? (
          <>
            <Field
              label={t('Source')}
              value={source?.mode === 'folder' ? t('Folder') : t('Device')}
            />
            <SettingRow
              icon="refresh"
              label={rescanning ? t('Rescanning your music…') : t('Rescan')}
              onPress={rescanNow}
            />
            <SettingRow icon="swap-horizontal" label={t('Change source')} onPress={() => setChanging(true)} />
          </>
        ) : (
          <>
            <Field
              label={t('Scan status')}
              value={scan?.scanning ? t('Scanning…') : t('{n} items', { n: scan?.count ?? 0 })}
            />
            <SettingRow icon="refresh" label={t('Scan now')} onPress={scanNow} />
            <Field
              label={t('Storage used')}
              value={usage == null ? '…' : `${formatBytes(usage)} · ${songsLabel(count, lang)}`}
            />
            {count > 0 ? (
              <SettingRow
                icon="trash-outline"
                label={t('Delete all downloads')}
                destructive
                onPress={() => setConfirmDelete(true)}
              />
            ) : null}
          </>
        )}

        <SettingRow icon="trash-outline" label={t('Clear cache')} onPress={clearCache} />
      </ScrollView>

      <Dialog
        visible={confirmDelete}
        title={t('Delete all downloads?')}
        message={t('All downloaded music will be removed from this device.')}
        confirmLabel={t('Delete')}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await clearAll();
          setUsage(0);
          toast(t('Downloads deleted'));
        }}
      />

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
