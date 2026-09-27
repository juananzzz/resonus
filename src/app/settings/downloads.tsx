/**
 * Settings › Downloads: quality, Wi-Fi only, used space (with visual
 * disk bar, Spotify-style) and full clear. Brings together what previously
 * lived split between "Quality & playback" and "Library". Offline, everything
 * about downloading is greyed out rather than taken away (#114): it needs a
 * server, but it is still where you left it. Used space and delete keep
 * working, since freeing space needs no network.
 */
import { Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Dialog } from '@/components/Dialog';
import {
  SelectList,
  SettingRow,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { albumsLabel, playlistsLabel, songsLabel, useT } from '@/i18n';
import { appStorageParts, appStorageTotal, type StorageParts } from '@/lib/appStorage';
import { formatBytes } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useLibraryMirror, type MirrorStats } from '@/store/libraryMirror';
import {
  BITRATE_OPTIONS,
  DOWNLOAD_CONCURRENCY_OPTIONS,
  SONG_CACHE_LIMITS_GB,
  TRANSCODE_FORMATS,
  useSettings,
} from '@/store/settings';
import { cacheBytes, useSongCache } from '@/store/songCache';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

/** Disk space (total and free), or null if the system doesn't expose it. */
function diskSpace(): { total: number; free: number } | null {
  try {
    const total = Paths.totalDiskSpace;
    const free = Paths.availableDiskSpace;
    if (total > 0 && free >= 0) return { total, free };
  } catch {
    // a platform that does not support it, say
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
/** The offline copy's share of the bar. Not the accent, which is the music
 *  itself, and not the grey of what belongs to other apps. */
const OFFLINE_COLOR = '#4a6fa5';
/** The song cache's share: music too, but none of it kept on purpose. */
const CACHE_COLOR = '#8a6bb0';
/** Below this, naming a folder says less than the line costs to read. It is
 *  still counted in the bar; it just isn't worth a line of its own. */
const LISTED_MIN = 100 * 1024;

export default function DownloadsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const router = useRouter();
  const toast = useToast((s) => s.show);
  const offline = useAuthStore((s) => s.offline);
  const lang = useSettings((s) => s.language);
  // From the store, not `colors.accent`: without subscription the space bar
  // would keep the previous accent while the screen stays mounted.
  const { accent } = useTheme();
  const downloadBitRate = useSettings((s) => s.downloadBitRate);
  const setDownloadBitRate = useSettings((s) => s.setDownloadBitRate);
  const downloadFormat = useSettings((s) => s.downloadFormat);
  const setDownloadFormat = useSettings((s) => s.setDownloadFormat);
  const downloadLosslessOnly = useSettings((s) => s.downloadLosslessOnly);
  const setDownloadLosslessOnly = useSettings((s) => s.setDownloadLosslessOnly);
  const downloadConcurrency = useSettings((s) => s.downloadConcurrency);
  const setDownloadConcurrency = useSettings((s) => s.setDownloadConcurrency);
  const downloadWifiOnly = useSettings((s) => s.downloadWifiOnly);
  const setDownloadWifiOnly = useSettings((s) => s.setDownloadWifiOnly);
  const autoOfflineSwitch = useSettings((s) => s.autoOfflineSwitch);
  const setAutoOfflineSwitch = useSettings((s) => s.setAutoOfflineSwitch);
  const hideUnavailableOffline = useSettings((s) => s.hideUnavailableOffline);
  const setHideUnavailableOffline = useSettings((s) => s.setHideUnavailableOffline);
  const songCache = useSettings((s) => s.songCache);
  const setSongCache = useSettings((s) => s.setSongCache);
  const songCacheLimitGb = useSettings((s) => s.songCacheLimitGb);
  const setSongCacheLimitGb = useSettings((s) => s.setSongCacheLimitGb);
  const cacheEntries = useSongCache((s) => s.entries);
  const cacheCount = Object.keys(cacheEntries).length;
  const cacheUsed = cacheBytes(cacheEntries);
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
  // Everything else the app keeps that is neither the music nor the mirror.
  const [parts, setParts] = useState<StorageParts | null>(null);

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
        if (!active) return;
        setMirror(s);
        // After the first numbers are on screen, not before: measuring those
        // folders is a walk over every file in them, and it holds the JS
        // thread while it runs (#50).
        setParts(appStorageParts());
      });
    usageBytes().then((n) => {
      if (active) setUsage(n);
    });
    return () => {
      active = false;
    };
  }, [usageBytes]);

  return (
    <SettingsPage title={t('Downloads & offline')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {/* The first title sticks to the header (no section margin). */}
        <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Downloading')}</Text>
        {/* Nothing can be downloaded without a server, so offline these are
            greyed out rather than taken away: what they say still holds for the
            next download, and a setting that moves house is one you hunt for
            through every other screen (#114). A line saying as much used to
            stand here; a whole section in grey already says it, and being told
            twice reads like being talked down to (raised by @ztx-lyghters). */}
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
          disabled={offline}
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
          disabled={offline || downloadBitRate === 0}
          disabledLabel={downloadBitRate === 0 ? t('Not used') : undefined}
        />
        <SwitchList
          options={[
            {
              label: t('Transcode lossless files only'),
              description: t(
                'MP3, AAC, Opus and other lossy files are downloaded as they are. Only files like FLAC are transcoded.',
              ),
              value: downloadLosslessOnly,
              onChange: setDownloadLosslessOnly,
              disabled: offline || downloadBitRate === 0,
            },
          ]}
        />
        <SelectList
          label={t('Simultaneous downloads')}
          description={t('Songs fetched at the same time. Fewer is gentler on the server, network and your phone.')}
          options={DOWNLOAD_CONCURRENCY_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
          value={downloadConcurrency}
          onChange={setDownloadConcurrency}
          disabled={offline}
        />
        <SwitchList
          options={[
            {
              label: t('Download over Wi-Fi only'),
              description: t('Block downloads on mobile data.'),
              value: downloadWifiOnly,
              onChange: setDownloadWifiOnly,
              disabled: offline,
            },
          ]}
        />
        <Text style={settingsStyles.sectionTitle}>{t('Song cache')}</Text>
        <SwitchList
          options={[
            {
              label: t('Cache songs you play'),
              description: t(
                'Songs you stream are kept on this phone and play from it next time, with or without a connection. The next song in the queue is fetched ahead, so it is not streamed at all. When the cache is full, the songs played longest ago make room.',
              ),
              value: songCache,
              onChange: setSongCache,
            },
          ]}
        />
        <SelectList
          label={t('Cache size')}
          options={SONG_CACHE_LIMITS_GB.map((gb) => ({ value: gb, label: `${gb} GB` }))}
          value={songCacheLimitGb}
          onChange={(gb) => {
            setSongCacheLimitGb(gb);
            void useSongCache.getState().trim();
          }}
          disabled={!songCache}
        />
        {/* Also with the cache off, while it still holds something: that is
            where it is emptied. */}
        {songCache || cacheCount > 0 ? (
          <SettingRow
            label={t('Cached songs')}
            right={`${formatBytes(cacheUsed)} · ${songsLabel(cacheCount, lang)}`}
            chevron
            onPress={() => router.push('/settings/cache')}
          />
        ) : null}
        <Text style={settingsStyles.sectionTitle}>{t('Offline')}</Text>
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
                "In offline mode, hide songs that aren't downloaded instead of showing them greyed out.",
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
          // What the app keeps to work without a connection, which is not the
          // music: the copy of the library and the covers saved with it. It has
          // its own share of the bar because it grows on its own as you browse,
          // and until it was drawn nobody could see it at all.
          const offline =
            (mirror ? mirror.bytes + mirror.coverBytes : 0) +
            (parts ? appStorageTotal(parts) : 0);
          const other = Math.max(0, disk.total - disk.free - usage - offline - cacheUsed);
          // Fractions with a visible minimum: small downloads on a large disk
          // should appear as a sliver, not disappear.
          const frac = (n: number) => Math.max(n > 0 ? 0.012 : 0, n / disk.total);
          return (
            <>
              <View style={styles.bar}>
                <View style={{ flex: frac(other), backgroundColor: OTHER_COLOR }} />
                <View style={{ flex: frac(usage), backgroundColor: accent }} />
                <View style={{ flex: frac(cacheUsed), backgroundColor: CACHE_COLOR }} />
                <View style={{ flex: frac(offline), backgroundColor: OFFLINE_COLOR }} />
                <View style={{ flex: frac(disk.free), backgroundColor: colors.surfaceHighlight }} />
              </View>
              <View style={styles.legend}>
                <LegendItem color={OTHER_COLOR} label={t('Other')} value={formatBytes(other)} />
                <LegendItem
                  color={accent}
                  label={t('Downloads')}
                  value={`${formatBytes(usage)} (${songsLabel(count, lang)})`}
                />
                {cacheUsed > 0 ? (
                  <LegendItem
                    color={CACHE_COLOR}
                    label={t('Song cache')}
                    value={formatBytes(cacheUsed)}
                  />
                ) : null}
                <LegendItem
                  color={OFFLINE_COLOR}
                  label={t('Offline library')}
                  value={mirror ? formatBytes(offline) : '…'}
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
        {/* What that share of the bar is made of, item by item. They grow for
            different reasons and at different rates, so one number for all of
            them would say where the space went without saying why. What weighs
            nothing is left out rather than listed as zero. */}
        <Text style={styles.mirrorLine}>
          {t('Library metadata copy')} ·{' '}
          {mirror
            ? `${formatBytes(mirror.bytes)} · ${albumsLabel(mirror.albums, lang)} · ${playlistsLabel(mirror.playlists, lang)}`
            : '…'}
        </Text>
        {mirror && mirror.coverBytes > 0 ? (
          <Text style={styles.mirrorLine}>
            {t('Cover art')} · {formatBytes(mirror.coverBytes)}
          </Text>
        ) : null}
        {parts
          ? (
              [
                ['lyrics', t('Lyrics')],
                ['localLibrary', t('Local library index')],
                ['playlistCovers', t('Playlist covers')],
                ['legacyRadioCovers', t('Radio station art')],
                ['outbox', t('Pending changes')],
              ] as [keyof StorageParts, string][]
            )
              .filter(([key]) => parts[key] >= LISTED_MIN)
              .map(([key, label]) => (
                <Text key={key} style={styles.mirrorLine}>
                  {label} · {formatBytes(parts[key])}
                </Text>
              ))
          : null}
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

const styles = themed((colors) => ({
  bar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radius.pill,
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
  legendDot: { width: 8, height: 8, borderRadius: radius.pill },
  legendText: { color: colors.textSecondary, fontSize: fontSize.xs },
}));
