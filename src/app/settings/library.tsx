/** Settings › Library: scanning and server libraries, or the local profile's music. */
import Icon from '@/components/Icon';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rescanLocal } from '@/api/data';
import { getScanStatus, startScan } from '@/api/backend';
import { Field, SettingRow, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { clearTemporaryData } from '@/lib/clearCache';
import { ensureAudioPermission, folderNameFromUri, pickFolder } from '@/lib/localLibrary';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { profileKeyOf, useLibraries } from '@/store/libraries';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed, useTheme, tracking } from '@/theme';

export default function LibrarySettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const source = useAuthStore((s) => s.offlineSource);
  const setSource = useAuthStore((s) => s.setOfflineSource);
  const setFolders = useAuthStore((s) => s.setOfflineFolders);
  const toast = useToast((s) => s.show);
  const insets = useSafeAreaInsets();
  // Server libraries (Navidrome multi-library): one switch per folder.
  const foldersMap = useLibraries((s) => s.folders);
  const disabledMap = useLibraries((s) => s.disabled);
  const setEnabled = useLibraries((s) => s.setEnabled);
  const profileKey = profileKeyOf(auth);
  const folders = profileKey ? foldersMap[profileKey] ?? [] : [];
  const disabled = new Set(profileKey ? disabledMap[profileKey] ?? [] : []);
  const enabledCount = folders.filter((f) => !disabled.has(f.id)).length;

  useEffect(() => {
    if (auth) void useLibraries.getState().load(auth);
  }, [auth]);

  function toggleLibrary(id: string, enabled: boolean) {
    if (!auth) return;
    // Never turn all off: at least one visible library.
    if (!enabled && enabledCount <= 1) {
      toast(t('Keep at least one library on'));
      return;
    }
    setEnabled(auth, id, enabled);
  }

  const [rescanning, setRescanning] = useState(false);
  const [changing, setChanging] = useState(false);

  async function chooseFolder() {
    const uri = await pickFolder();
    if (!uri) return;
    await setSource({ mode: 'folder', uris: [uri] });
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

  const folderUris = source?.mode === 'folder' ? source.uris : [];

  async function addFolder() {
    const uri = await pickFolder();
    if (!uri) return;
    if (folderUris.includes(uri)) {
      toast(t('That folder is already there'));
      return;
    }
    await setFolders([...folderUris, uri]);
    toast(t('Rescanning your music…'));
  }

  async function removeFolder(uri: string) {
    // The same rule as the server's libraries: a local profile with no folder
    // is a profile with no music, and the way out of that is choosing another
    // source, not emptying this list.
    if (folderUris.length <= 1) {
      toast(t('Keep at least one folder'));
      return;
    }
    await setFolders(folderUris.filter((u) => u !== uri));
    toast(t('Rescanning your music…'));
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
    // While the server is scanning, the count refreshes itself.
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
    await clearTemporaryData();
    toast(t('Temporary data cleared'));
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
            {source?.mode === 'folder' ? (
              <>
                <Text style={settingsStyles.sectionTitle}>{t('Music folders')}</Text>
                {folderUris.map((uri) => (
                  <View key={uri} style={[settingsStyles.cardBox, settingsStyles.row]}>
                    <Icon name="folder-outline" size={20} color={colors.text} />
                    <View style={settingsStyles.rowLabelBox}>
                      <Text style={settingsStyles.rowLabel} numberOfLines={1}>
                        {folderNameFromUri(uri)}
                      </Text>
                    </View>
                    <Pressable
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={t('Remove')}
                      onPress={() => removeFolder(uri)}
                    >
                      <Icon name="close" size={20} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
                <SettingRow icon="add" label={t('Add another folder')} onPress={addFolder} />
              </>
            ) : null}
            <SettingRow
              icon="refresh"
              label={rescanning ? t('Rescanning your music…') : t('Rescan')}
              onPress={rescanNow}
            />
            <SettingRow icon="swap-horizontal" label={t('Change source')} onPress={() => setChanging(true)} />
            {/* A server account has this in Downloads & offline, which the local
                profile does not get. */}
            <Text style={settingsStyles.sectionTitle}>{t('Storage')}</Text>
            <SettingRow icon="trash-outline" label={t('Clear temporary data')} onPress={clearCache} />
          </>
        ) : (
          <>
            {/* The first title sticks to the header (no section margin). */}
            <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Scan')}</Text>
            <Field
              label={t('Scan status')}
              value={scan?.scanning ? t('Scanning…') : t('{n} items', { n: scan?.count ?? 0 })}
            />
            <SettingRow icon="refresh" label={t('Scan now')} onPress={scanNow} />

            {folders.length >= 2 ? (
              <>
                <Text style={settingsStyles.sectionTitle}>{t('Libraries')}</Text>
                <Text style={settingsStyles.sectionDescription}>
                  {t('Choose which libraries appear across the app.')}
                </Text>
                <SwitchList
                  options={folders.map((f) => ({
                    label: f.name,
                    value: !disabled.has(f.id),
                    onChange: (v) => toggleLibrary(f.id, v),
                  }))}
                />
              </>
            ) : null}
          </>
        )}
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
            <Icon name="folder-outline" size={26} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={sheetStyles.optionTitle}>{t('Choose a folder (recommended)')}</Text>
              <Text style={sheetStyles.optionSub}>{t('Only the music in the folder you choose.')}</Text>
            </View>
          </Pressable>

          <Pressable style={sheetStyles.option} onPress={chooseDevice}>
            <Icon name="phone-portrait-outline" size={26} color={colors.accent} />
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

const sheetStyles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
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
  optionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  optionSub: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
}));
