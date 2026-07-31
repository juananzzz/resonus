/**
 * Settings › Downloads: quality, Wi-Fi only, used space (with visual
 * disk bar, Spotify-style) and full clear. Brings together what previously
 * lived split between "Quality & playback" and "Library". In offline mode the
 * reduced version remains: used space and delete (free space without network);
 * quality and Wi-Fi only apply when downloading, which requires a server.
 */
import { Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Dialog } from '@/components/Dialog';
import {
  SelectList,
  SettingRow,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { albumsLabel, playlistsLabel, songsLabel, useT } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useLibraryMirror, type MirrorStats } from '@/store/libraryMirror';
import {
  BITRATE_OPTIONS,
  DOWNLOAD_CONCURRENCY_OPTIONS,
  TRANSCODE_FORMATS,
  useSettings,
} from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing } from '@/theme';

/** Disk space (total and free), or null if the system doesn't expose it. */
function diskSpace(): { total: number; free: number } | null {
  try {
    const total = Paths.totalDiskSpace;
    const free = Paths.availableDiskSpace;
    if (total > 0 && free >= 0) return { total, free };
  } catch {
    // p. ej. plataforma sin soporte
  }
  return null;
}

/** Color dot + label with size, for the bar legend. */
function LegendItem({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>
        {label} · {value}
      </Text>
    </View>
  );
}

/** Color of the "other" segment (what the rest of the device occupies). */
const OTHER_COLOR = '#7a7a7a';

export default function DownloadsSettings() {
  const t = useT();
  const toast = useToast((s) => s.show);
  const offline = useAuthStore((s) => s.offline);
  const lang = useSettings((s) => s.language);
  // From the store, not `colors.accent`: without subscription the space bar
  // would keep the previous accent while the screen stays mounted.
  const accent = useSettings((s) => s.accentColor);
  const downloadBitRate = useSettings((s) => s.downloadBitRate);
  const setDownloadBitRate = useSettings((s) => s.setDownloadBitRate);
  const downloadFormat = useSettings((s) => s.downloadFormat);
  const setDownloadFormat = useSettings((s) => s.setDownloadFormat);
  const downloadConcurrency = useSettings((s) => s.downloadConcurrency);
  const setDownloadConcurrency = useSettings((s) => s.setDownloadConcurrency);
  const downloadWifiOnly = useSettings((s) => s.downloadWifiOnly);
  const setDownloadWifiOnly = useSettings((s) => s.setDownloadWifiOnly);
  const autoOfflineSwitch = useSettings((s) => s.autoOfflineSwitch);
  const setAutoOfflineSwitch = useSettings((s) => s.setAutoOfflineSwitch);
  const hideUnavailableOffline = useSettings((s) => s.hideUnavailableOffline);
  const setHideUnavailableOffline = useSettings((s) => s.setHideUnavailableOffline);
  const files = useDownloads((s) => s.files);
  const usageBytes = useDownloads((s) => s.usageBytes);
  const clearAll = useDownloads((s) => s.clearAll);

  const [usage, setUsage] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const count = Object.keys(files).length;
  // The other thing kept for offline use, and the one nobody can see: the copy
  // of the library. Reported rather than managed — it is what turns "the app
  // feels slow" into a number someone can put in an issue (#50).
  const [mirror, setMirror] = useState<MirrorStats | null>(null);

  // Measured on entering the screen and after deleting, not on every change of
  // `count`: while something downloads that changes with each song, and it used
  // to restart the whole measurement each time, so with auto-download on it
  // never finished (#50).
  useEffect(() => {
    let active = true;
    // The mirror first, on purpose. File system calls are served by one native
    // queue, so asking for it after the downloads meant this line waiting
    // behind them, and it is the cheap one.
    void useLibraryMirror
      .getState()
      .stats()
      .then((s) => {
        if (active) setMirror(s);
      });
    usageBytes().then((n) => {
      if (active) setUsage(n);
    });
    return () => {
      active = false;
    };
  }, [usageBytes]);

  return (
    <SettingsPage title={t('Downloads')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {offline ? null : (
          <>
            {/* The first title sticks to the header (no section margin). */}
            <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>
              {t('Downloading')}
            </Text>
            {/* Quality first and the codec under it, as in Quality & playback:
                at "Original" the original file is downloaded and the codec has
                nothing to do, so it reads as a pair and is greyed out (#72). */}
            <SelectList
              label={t('Download quality')}
              description={t('Applies to new downloads only.')}
              // Only "Original" is a word; the rest are a number and a unit.
              options={BITRATE_OPTIONS.map((opt) => ({
                value: opt.value,
                label: opt.value === 0 ? t('Original') : opt.label,
              }))}
              value={downloadBitRate}
              onChange={setDownloadBitRate}
            />
            <SelectList
              label={t('Download codec')}
              description={
                downloadBitRate > 0
                  ? t('Codec to transcode to. Your server must support it.')
                  : t('Codec to transcode to. At “Original” quality nothing is transcoded.')
              }
              options={TRANSCODE_FORMATS.map((v) => ({
                value: v,
                label: v === '' ? t('Server default') : v.toUpperCase(),
              }))}
              value={downloadFormat}
              onChange={setDownloadFormat}
              disabled={downloadBitRate === 0}
              disabledLabel={t('Not used')}
            />
            <SelectList
              label={t('Simultaneous downloads')}
              description={t('Songs fetched at the same time. Fewer is gentler on the server, network and your phone.')}
              options={DOWNLOAD_CONCURRENCY_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
              value={downloadConcurrency}
              onChange={setDownloadConcurrency}
            />
            <SwitchList
              options={[
                {
                  label: t('Download over Wi-Fi only'),
                  description: t('Block downloads on mobile data.'),
                  value: downloadWifiOnly,
                  onChange: setDownloadWifiOnly,
                },
              ]}
            />
          </>
        )}
        {/* In offline there's no download section: this becomes the first title. */}
        <Text style={[settingsStyles.sectionTitle, offline && { marginTop: 0 }]}>
          {t('Offline')}
        </Text>
        <SwitchList
          options={[
            {
              label: t('Automatic offline mode'),
              description: t(
                'Switch to your downloads when the server is unreachable, and back when it returns.',
              ),
              value: autoOfflineSwitch,
              onChange: setAutoOfflineSwitch,
            },
            {
              label: t('Hide unavailable songs'),
              description: t(
                'In offline mode, hide songs that aren’t downloaded instead of showing them greyed out.',
              ),
              value: hideUnavailableOffline,
              onChange: setHideUnavailableOffline,
            },
          ]}
        />
        <Text style={settingsStyles.sectionTitle}>{t('Storage used')}</Text>
        {(() => {
          const disk = diskSpace();
          if (!disk || usage == null) {
            return <Text style={styles.legendText}>{usage == null ? '…' : `${formatBytes(usage)} · ${songsLabel(count, lang)}`}</Text>;
          }
          const other = Math.max(0, disk.total - disk.free - usage);
          // Fractions with a visible minimum: small downloads on a large disk
          // should appear as a sliver, not disappear.
          const frac = (n: number) => Math.max(n > 0 ? 0.012 : 0, n / disk.total);
          return (
            <>
              <View style={styles.bar}>
                <View style={{ flex: frac(other), backgroundColor: OTHER_COLOR }} />
                <View style={{ flex: frac(usage), backgroundColor: accent }} />
                <View style={{ flex: frac(disk.free), backgroundColor: colors.surfaceHighlight }} />
              </View>
              <View style={styles.legend}>
                <LegendItem color={OTHER_COLOR} label={t('Other')} value={formatBytes(other)} />
                <LegendItem
                  color={accent}
                  label={t('Downloads')}
                  value={`${formatBytes(usage)} (${songsLabel(count, lang)})`}
                />
                <LegendItem
                  color={colors.surfaceHighlight}
                  label={t('Free')}
                  value={formatBytes(disk.free)}
                />
              </View>
            </>
          );
        })()}
        <Text style={styles.mirrorLine}>
          {t('Library metadata copy')} ·{' '}
          {mirror
            ? `${formatBytes(mirror.bytes)} · ${albumsLabel(mirror.albums, lang)} · ${playlistsLabel(mirror.playlists, lang)}`
            : '…'}
        </Text>
        {count > 0 ? (
          <SettingRow
            icon="trash-outline"
            label={t('Delete all downloads')}
            destructive
            onPress={() => setConfirmDelete(true)}
          />
        ) : null}
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
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Same muted voice as the bar legend, with air above it: it belongs to the
  // storage section, not to the delete row it sits next to.
  mirrorLine: { color: colors.textSecondary, fontSize: fontSize.xs, marginBottom: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textSecondary, fontSize: fontSize.xs },
});
