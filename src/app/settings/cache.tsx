/**
 * Settings › Downloads › Cached songs: what the song cache holds (#180), last
 * played first, with what each takes and when it came in. A row plays from
 * there; the bin on a row drops that song, the one in the bar drops them all.
 */
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COVER, markUnplayableOffline } from '@/api/data';
import { BackChevron } from '@/components/BackChevron';
import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { songsLabel, useT } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { listPerf } from '@/lib/listPerf';
import type { CachedSong } from '@/lib/songCacheDb';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { cacheBytes, useSongCache } from '@/store/songCache';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed, tracking, useTheme } from '@/theme';

function shortDate(at: number, lang: string): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  try {
    return d.toLocaleDateString(lang, {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' as const }),
    });
  } catch {
    return d.toLocaleDateString();
  }
}

export default function CachedSongsScreen() {
  const { songCoverUrl } = useCoverUrls();
  useTheme();
  const t = useT();
  const toast = useToast((s) => s.show);
  const lang = useSettings((s) => s.language);
  const limitGb = useSettings((s) => s.songCacheLimitGb);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const bottomPad = useScreenBottomPadding();
  const listPad = useListPadding(spacing.lg);
  const entries = useSongCache((s) => s.entries);
  const offline = useAuthStore((s) => s.offline);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [rows, setRows] = useState<CachedSong[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Read again whenever the cache changes under the screen: a song stored
  // while it is open, one evicted, one deleted from here.
  useEffect(() => {
    let active = true;
    void useSongCache
      .getState()
      .list()
      .then((list) => {
        if (active) setRows(list);
      });
    return () => {
      active = false;
    };
  }, [entries]);

  const list = (rows ?? []).filter((r) => entries[r.id]);
  const songs = markUnplayableOffline(list.map((r) => r.song), offline);
  const used = cacheBytes(entries);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.bar}>
        <BackChevron size={28} label={t('Close')} />
        <Text style={styles.barTitle}>{t('Cached songs')}</Text>
        {list.length > 0 ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Clear song cache')}
            onPress={() => setConfirmClear(true)}
          >
            <Icon name="trash-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {rows && list.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="musical-notes"
            title={t('Nothing cached yet')}
            subtitle={t('Songs you stream will show up here.')}
          />
        </View>
      ) : (
        <FlatList
          {...listPerf}
          data={list}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: listPad }}
          ListHeaderComponent={
            <Text style={styles.summary}>
              {t('{used} of {limit}', { used: formatBytes(used), limit: `${limitGb} GB` })} ·{' '}
              {songsLabel(list.length, lang)}
            </Text>
          }
          renderItem={({ item, index }) => {
            const current = playing?.id === item.id;
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                onPress={() => void playQueue(songs, index, t('Cached songs'))}
              >
                {showListArtwork ? (
                  <Cover uri={songCoverUrl(item.song, COVER.thumb)} size={48} />
                ) : null}
                <View style={styles.info}>
                  <Text
                    style={[styles.title, current && { color: colors.accent }]}
                    numberOfLines={1}
                  >
                    {item.song.title}
                  </Text>
                  {item.song.artist ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {item.song.artist}
                    </Text>
                  ) : null}
                  <Text style={styles.meta} numberOfLines={1}>
                    {formatBytes(item.bytes)} ·{' '}
                    {t('Played {date}', { date: shortDate(item.playedAt, lang) })} ·{' '}
                    {t('Cached {date}', { date: shortDate(item.cachedAt, lang) })}
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('Remove from cache')}
                  onPress={() => void useSongCache.getState().remove([item.id])}
                >
                  <Icon name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}

      <Dialog
        visible={confirmClear}
        title={t('Clear song cache?')}
        message={t('Cached songs will be removed from this device. Your downloads stay.')}
        confirmLabel={t('Clear all')}
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setConfirmClear(false);
          await useSongCache.getState().clear();
          toast(t('Song cache cleared'));
        }}
      />
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  barTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
  },
  center: { flex: 1, justifyContent: 'center' },
  summary: { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  info: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  sub: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  meta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
}));
