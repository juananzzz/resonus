/**
 * Every song by one artist, as a list (#139 asked for it next to "Popular").
 *
 * "Popular" is what the server thinks is worth hearing first, twenty tracks of
 * it. This is the rest: everything the artist has here, in one place, to be
 * sorted, played, shuffled, downloaded or picked through. No search box: a
 * genre's list has none either, and the two are meant to be the same screen
 * with different contents.
 *
 * Where the songs come from is the interesting part. No server has an endpoint
 * for "every song by this artist" that all four of them share, but every one
 * of them can list an artist's albums, and each album brings its songs. So the
 * list is built the way the artist screen already builds it to download a
 * discography: album by album, through the query cache, so an album opened a
 * minute ago costs nothing. Bounded, complete, and the same on every backend,
 * which is what a genre's songs could never be.
 *
 * Laid out like a genre rather than like a playlist: a compact heading, what
 * it is underneath, and the row of actions the album and playlist screens
 * have. It is a list somebody arrived at, not a record with a cover.
 *
 * And because the whole list ends up here rather than arriving a page at a
 * time, it sorts like a playlist does — the menu with a direction, and
 * "Downloaded" among the fields, neither of which a paged list can honestly
 * offer.
 */
import Icon from '@/components/Icon';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { getAlbum, getAppearsOn, getArtist, type Song } from '@/api/data';
import { BackChevron } from '@/components/BackChevron';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { SelectionBar } from '@/components/SelectionBar';
import { SheetModal } from '@/components/SheetModal';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackRow } from '@/components/TrackRow';
import { useAccent } from '@/hooks/useAccent';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { useSelectionMenu } from '@/hooks/useSelectionMenu';
import { useSongSort } from '@/hooks/useSongSort';
import { songsLabel, useT } from '@/i18n';
import { splitArtistAlbums } from '@/lib/artistAlbums';
import { formatTotalDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
  tracking,
} from '@/theme';

export default function ArtistSongsScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  // Read at render time: the accent baked into `styles` is whatever it was when
  // this module loaded, which is the default green if that happened before the
  // saved settings came back from disk.
  const accent = useAccent();
  const bottomPad = useScreenBottomPadding();
  // Rows stop growing at a reading measure and centre themselves (#131).
  const listPad = useListPadding(spacing.lg);
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const downloadArtist = useDownloads((s) => s.downloadArtist);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const openPlaylistPicker = usePlaylistPicker((s) => s.open);
  const toast = useToast((s) => s.show);
  const menuRef = useRef<() => void>(() => {});

  // The same two queries, under the same keys, the artist screen filled on the
  // way here: arriving from its link costs nothing.
  const { data: artist } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id),
    enabled: canFetch && !!id,
  });
  const name = artist?.artist.name;
  const { data: appearsOn } = useQuery({
    queryKey: ['appearsOn', id],
    queryFn: () => getAppearsOn(id, name!),
    enabled: canFetch && !!id && !!name,
  });
  // The artist's own records, not the ones they only play on: those belong to
  // somebody else, and pulling a whole album in because this artist sings on
  // one track of it is not what "all their songs" means.
  const albums = artist ? splitArtistAlbums(artist.albums, appearsOn ?? []).own : [];

  const {
    data: songs,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    // The albums are part of what is being gathered, so a discography that
    // grew is a different answer rather than a stale one.
    queryKey: ['artistSongs', id, albums.map((a) => a.id).join(',')],
    queryFn: async () => {
      const parts = await Promise.all(
        albums.map((al) =>
          queryClient
            .fetchQuery({ queryKey: ['album', al.id], queryFn: () => getAlbum(al.id) })
            .then((d) => d.songs)
            // One album that will not load is a gap, not a failure: the rest
            // of the discography is still worth showing.
            .catch(() => [] as Song[]),
        ),
      );
      return parts.flat();
    },
    enabled: canFetch && albums.length > 0,
  });

  const all = songs ?? [];
  const {
    songs: shown,
    openSort,
    sortSheet,
  } = useSongSort(all, `artistSongs:${id}`, {
    // 'recent' is the order they were gathered in: the discography newest
    // first, each record in its own running order. Named for what that is.
    fields: ['recent', 'alpha', 'album', 'downloaded'],
    labels: { recent: 'By album' },
  });

  // ── Download ─────────────────────────────────────────────────────────────
  // The very group the artist screen's own button uses, so the two say the
  // same thing: it is one download of one discography, reached from two places.
  const download = useDownloads(useShallow((s) => groupDownloadState(s, `artist:${id}`, [])));
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const downloadMsg = useDownloadMessage(all);
  const onDownloadPress = useCallback(() => {
    if (download.status === 'active') setConfirmStop(true);
    else setConfirmDownload(true);
  }, [download.status]);

  // ── Multi-select ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const selecting = selectedIds !== null;
  const justLongPressed = useRef<string | null>(null);

  function toggleSelect(sid: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }

  function runSelection(fn: (sel: Song[]) => void) {
    const sel = shown.filter((s) => selectedIds?.has(s.id));
    setSelectedIds(null);
    if (sel.length > 0) fn(sel);
  }

  const selectionMenu = useSelectionMenu(runSelection);

  async function deleteArtistDownloads() {
    const files = useDownloads.getState().files;
    const ids = all.filter((s) => files[s.id]).map((s) => s.id);
    if (ids.length === 0) {
      toast(t('Nothing here is downloaded'));
      return;
    }
    await deleteSongs(ids);
    toast(t('{n} songs deleted', { n: ids.length }));
  }

  if (isLoading || (!artist && canFetch)) return <TrackListSkeleton />;

  if (all.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <BackChevron />
          <Text style={styles.title} numberOfLines={1}>
            {name ?? ''}
          </Text>
        </View>
        {isError ? (
          <Message text={t("Couldn't load songs.")} onRetry={() => void refetch()} />
        ) : (
          <EmptyState
            icon="musical-notes-outline"
            title={t('No songs here yet')}
            subtitle={t('Try exploring another artist.')}
          />
        )}
      </SafeAreaView>
    );
  }

  const totalSec = all.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const meta = [t('Songs'), songsLabel(all.length, lang), formatTotalDuration(totalSec)]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {selecting ? (
          <Pressable hitSlop={10} onPress={() => setSelectedIds(null)} accessibilityLabel={t('Close')}>
            <Icon name="close" size={26} color={colors.text} />
          </Pressable>
        ) : (
          <BackChevron />
        )}
        <Text style={styles.title} numberOfLines={1}>
          {selecting ? t(selectedIds.size === 1 ? '{n} selected::one' : '{n} selected', { n: selectedIds.size }) : (name ?? '')}
        </Text>
        {selecting ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Select all')}
            onPress={() =>
              setSelectedIds(
                selectedIds.size === shown.length ? new Set() : new Set(shown.map((s) => s.id)),
              )
            }
          >
            <Icon
              name="checkmark-done"
              size={24}
              color={shown.length > 0 && selectedIds.size === shown.length ? accent : colors.text}
            />
          </Pressable>
        ) : null}
      </View>

      {!selecting ? <Text style={styles.meta}>{meta}</Text> : null}

      {/* The row every list screen has, in the same order: what you do to this
          thing on the left, what starts it on the right. */}
      {!selecting ? (
        <View style={styles.actions}>
          <View style={styles.actionsLeft}>
            {!offline ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Download')}
                onPress={onDownloadPress}
                style={styles.downloadWrap}
              >
                {download.status === 'active' ? (
                  <>
                    <ActivityIndicator size="small" color={accent} />
                    <Text style={[styles.downloadProgress, { color: accent }]}>
                      {Math.round(download.progress * 100)}%
                    </Text>
                  </>
                ) : (
                  <Icon
                    name="arrow-down-circle-outline"
                    size={26}
                    color={colors.textSecondary}
                  />
                )}
              </Pressable>
            ) : null}
            {all.length > 1 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Sort')}
                onPress={openSort}
              >
                <Icon name="swap-vertical" size={24} color={colors.textSecondary} />
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('More options')}
              onPress={() => menuRef.current()}
            >
              <Icon name="ellipsis-horizontal" size={26} color={colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.playRow}>
            <Pressable
              hitSlop={10}
              accessibilityLabel={t('Shuffle')}
              onPress={() => void playQueue(shown, 0, name, `/artist/${id}`, { shuffled: true })}
            >
              <Icon name="shuffle" size={26} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              style={[styles.playButton, { backgroundColor: accent }]}
              accessibilityRole="button"
              accessibilityLabel={t('Play')}
              onPress={() => void playQueue(shown, 0, name, `/artist/${id}`)}
            >
              <Icon name="play" size={28} color={colors.onAccent} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <FlatList
        {...listPerf}
        data={shown}
        keyExtractor={(item, i) => `${item.id}-${i}`}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPad, paddingHorizontal: listPad },
        ]}
        extraData={selectedIds}
        renderItem={({ item, index }) => (
          <TrackRow
            song={item}
            isCurrent={playing?.id === item.id}
            showArtwork={showListArtwork}
            selecting={selecting}
            selected={!!selectedIds?.has(item.id)}
            onPressIn={() => {
              justLongPressed.current = null;
            }}
            onLongPress={
              selecting
                ? undefined
                : () => {
                    haptic('medium');
                    setSelectedIds(new Set([item.id]));
                    justLongPressed.current = item.id;
                  }
            }
            onPress={() => {
              if (justLongPressed.current === item.id) return;
              if (selecting) toggleSelect(item.id);
              else void playQueue(shown, index, name, `/artist/${id}`);
            }}
          />
        )}
      />

      {selecting ? (
        <SelectionBar
          count={selectedIds.size}
          actions={[
            {
              icon: 'add-circle-outline',
              label: t('Add to a playlist'),
              onPress: () => runSelection(openPlaylistPicker),
            },
            {
              icon: 'list',
              label: t('Add to queue'),
              onPress: () =>
                runSelection((sel) => {
                  // In reverse: each one goes right after the current song, so
                  // queueing them backwards leaves them in the order you see.
                  [...sel].reverse().forEach(addToQueue);
                  toast(t('Added to queue'));
                }),
            },
          ]}
          menu={[
            ...(offline
              ? []
              : [
                  {
                    icon: 'download-outline' as const,
                    label: t('Download'),
                    onPress: () =>
                      runSelection((sel) => {
                        void downloadSongs(sel);
                        toast(t('Downloading…'));
                      }),
                  },
                ]),
            ...selectionMenu.actions,
          ]}
        />
      ) : null}
      {selectionMenu.dialogs}
      {sortSheet}

      <SheetModal openRef={menuRef}>
        {(close) => (
          <>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                openPlaylistPicker(all);
              }}
            >
              <Icon name="add-circle-outline" size={22} color={colors.text} />
              <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                void deleteArtistDownloads();
              }}
            >
              {/* Last, but not in red: a download comes back with one tap, and
                  red is kept for what does not, like deleting a playlist. */}
              <Icon name="trash-outline" size={22} color={colors.text} />
              <Text style={styles.actionText}>{t('Delete downloads')}</Text>
            </Pressable>
          </>
        )}
      </SheetModal>

      <Dialog
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: name ?? '' })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void downloadArtist(id, all, albums);
        }}
      />
      <Dialog
        visible={confirmStop}
        title={t('Stop download?')}
        message={t('Songs already downloaded will be kept.')}
        confirmLabel={t('Stop')}
        destructive
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          cancelDownload(`artist:${id}`);
        }}
      />
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { flex: 1, color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  meta: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  downloadWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  downloadProgress: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '500',
    minWidth: 32,
  },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  // The same measurements as `TrackListView`, which is what an album and a
  // playlist draw. This screen was laid out from the genre one back when that
  // had a smaller button of its own, and inherited it.
  playButton: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  // Same side margin as the album and playlist song lists: `TrackRow` brings
  // no horizontal padding of its own.
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
}));
