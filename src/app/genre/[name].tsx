/**
 * A genre: its albums (grid or list) and its songs, with infinite scroll.
 *
 * Both views matter because genre tags live per FILE: an album tagged "Rock"
 * can hold songs tagged otherwise, and a song of this genre can sit inside an
 * album that isn't. Albums alone would only ever show half the picture.
 */
import Icon from '@/components/Icon';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import {
  genreAlbumDir,
  genreAlbumSorts,
  genreSongDir,
  genreSongSorts,
  getAlbumsByGenre,
  getGenres,
  getSongsByGenre,
  type AlbumListSort,
} from '@/api/data';
import { type Song } from '@/api/subsonic';
import { playShuffle } from '@/lib/playShuffle';
import { AlbumCard } from '@/components/AlbumCard';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { AlbumRow } from '@/components/AlbumRow';
import { AlbumRowsSkeleton } from '@/components/AlbumRowsSkeleton';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { SelectionBar } from '@/components/SelectionBar';
import { SheetModal } from '@/components/SheetModal';
import { TrackRow } from '@/components/TrackRow';
import { useAccent } from '@/hooks/useAccent';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { useSelectionMenu } from '@/hooks/useSelectionMenu';
import { useServerSort } from '@/hooks/useServerSort';
import { albumsLabel, songsLabel, useT } from '@/i18n';
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
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';
import { useGridColumns } from '@/hooks/useGridColumns';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { BackChevron } from '@/components/BackChevron';

const PAGE = 30;
const SONG_PAGE = 50;
const GAP = spacing.sm;

/** Card width at a given density (#109). */
function cardWidth(columns: number): number {
  return (Dimensions.get('window').width - spacing.lg * 2 - GAP * (columns - 1)) / columns;
}

/** Songs fetched when pressing play: the same cap as the library shuffle, for
 *  the same reason (a queue of thousands is unusable). */
const PLAY_SIZE = 200;

/** Page size and ceiling when reading a whole genre to download it. */
const GATHER_PAGE = 200;
const GATHER_CAP = 5000;

export default function GenreScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { name } = useLocalSearchParams<{ name: string }>();
  const genre = decodeURIComponent(name ?? '');
  const t = useT();
  // Read at render time: the accent baked into `styles` is whatever it was when
  // this module loaded, which is the default green if that happened before the
  // saved settings came back from disk.
  const accent = useAccent();
  const auth = useAuthStore((s) => s.auth);
  const toast = useToast((s) => s.show);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const layout = useSettings((s) => s.genreLayout);
  const setLayout = useSettings((s) => s.setGenreLayout);
  const grid = layout === 'grid';
  // Rows or cards, and how many across, are the same question about the same
  // screen, so one menu asks it (#109).
  const { columns, openGridMenu, gridSheet } = useGridColumns('genre', {
    value: layout,
    set: setLayout,
  });
  const card = cardWidth(columns);
  const [tab, setTab] = useState<'albums' | 'songs'>('albums');
  const lang = useSettings((s) => s.language);
  /** Opens the ⋯ menu: what is too rare or too destructive for the row. */
  const menuRef = useRef<() => void>(() => {});
  // Without this, tapping and hearing nothing for half a second feels broken.
  const [starting, setStarting] = useState(false);
  const offline = useAuthStore((s) => s.offline);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  // ── Order ────────────────────────────────────────────────────────────────
  // The server's, always. This list arrives a page at a time, so reordering
  // what is loaded would promise an order it cannot keep (see `useServerSort`).
  // A server with nothing to offer shows no control rather than a broken one.
  // Asked only with a session in hand: the data layer answers for the server
  // that is connected, and there isn't one yet on the way in.
  // The first order is by album here, not by whatever the server would have
  // answered, so it is named for what it does (see `ND_GENRE_DEFAULT`).
  const { sort, dir, openSort, sortSheet } = useServerSort(
    auth ? genreSongSorts(offline) : [],
    { server: 'By album', frequent: 'Most played::songs' },
    genreSongDir,
  );
  const {
    sort: albumSort,
    dir: albumDir,
    openSort: openAlbumSort,
    sortSheet: albumSortSheet,
  } = useServerSort<AlbumListSort>(
    auth ? genreAlbumSorts(offline) : [],
    { frequent: 'Most played::albums' },
    genreAlbumDir,
  );
  // One slot in the toolbar, whichever list is under it.
  const openListSort = tab === 'albums' ? openAlbumSort : openSort;

  // ── Download the genre ───────────────────────────────────────────────────
  // With `songIds` empty on purpose, like the artist's discography: this screen
  // holds a window into the genre, not all of it, so it cannot say "downloaded"
  // by comparing against disk. The button is two-valued, 'none' and 'active'.
  const download = useDownloads(useShallow((s) => groupDownloadState(s, `genre:${genre}`, [])));
  const downloadGenre = useDownloads((s) => s.downloadGenre);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  /** While reading the genre's songs off the server, before downloading any. */
  const [gathering, setGathering] = useState(false);
  /** Songs already gathered, waiting for the dialog to be answered. */
  const [pending, setPending] = useState<Song[] | null>(null);
  const downloadMsg = useDownloadMessage(pending ?? []);
  // The picker is mounted once in the root layout; screens just hand it songs.
  const openPlaylistPicker = usePlaylistPicker((s) => s.open);

  // ── Multi-select ────────────────────────────────────────────────────────
  // Same as the album and playlist lists: null = normal, a Set (even empty) =
  // selecting. See `TrackListView`, which does this over its own list.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const selecting = selectedIds !== null;
  // Id that just entered selection via long-press: the `onPress` of that same
  // gesture arrives with selection already on and would undo it.
  const justLongPressed = useRef<string | null>(null);

  function toggleSelect(id: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Runs an action with the marked songs and leaves selection mode. */
  function runSelection(fn: (sel: Song[]) => void) {
    const sel = songs.filter((s) => selectedIds?.has(s.id));
    setSelectedIds(null);
    if (sel.length > 0) fn(sel);
  }

  const selectionMenu = useSelectionMenu(runSelection);

  const href = `/genre/${encodeURIComponent(genre)}`;

  /**
   * Every song of the genre, page by page until the server runs out.
   *
   * The confirmation dialog counts real songs and estimates what they weigh,
   * which is the only thing that makes a download this size a decision rather
   * than a leap: a genre is not a playlist somebody assembled, and "Rock" can
   * be most of a library. Reading it costs a handful of requests, which is why
   * it happens on the press and not on the way in.
   *
   * The cap is there because this has to end: a library where one genre runs
   * past it is one where the answer to "download all of Rock" was never going
   * to be yes, and the dialog still says what it is about to save.
   */
  async function gatherGenreSongs(): Promise<Song[] | null> {
    setGathering(true);
    try {
      const all: Song[] = [];
      for (;;) {
        // Always the server's own order, whatever is chosen on screen. A
        // download is a set and has none, and paging through a random order
        // would hand back the same song twice and miss others: what is being
        // walked here has to hold still while it is walked.
        const page = await getSongsByGenre(genre, GATHER_PAGE, all.length);
        all.push(...page);
        if (page.length < GATHER_PAGE || all.length >= GATHER_CAP) break;
      }
      return all;
    } catch {
      toast(t("Couldn't load songs."));
      return null;
    } finally {
      setGathering(false);
    }
  }

  async function onDownloadPress() {
    if (gathering) return;
    if (download.status === 'active') {
      setConfirmStop(true);
      return;
    }
    const gathered = await gatherGenreSongs();
    if (!gathered || gathered.length === 0) {
      if (gathered) toast(t('No songs in this genre'));
      return;
    }
    setPending(gathered);
    setConfirmDownload(true);
  }

  async function addGenreToPlaylist() {
    const gathered = await gatherGenreSongs();
    if (gathered && gathered.length > 0) openPlaylistPicker(gathered);
  }

  /** Removes every downloaded song of the genre, from the same reading of it
   *  the download uses. */
  async function deleteGenreDownloads() {
    const gathered = await gatherGenreSongs();
    if (!gathered) return;
    const files = useDownloads.getState().files;
    const ids = gathered.filter((s) => files[s.id]).map((s) => s.id);
    if (ids.length === 0) {
      toast(t('Nothing here is downloaded'));
      return;
    }
    await deleteSongs(ids);
    toast(t('{n} songs deleted', { n: ids.length }));
  }

  /** Play and shuffle draw from the SAME pool (the genre's songs), one in the
   *  order on screen and the other at random, so both mean the same thing in
   *  either tab and neither has to expand album by album. */
  async function onPlay() {
    if (starting) return;
    setStarting(true);
    try {
      const songs = await getSongsByGenre(genre, PLAY_SIZE, 0, sort, dir);
      if (songs.length === 0) {
        toast(t('Nothing to shuffle yet'));
        return;
      }
      await playQueue(songs, 0, genre, href);
    } catch {
      toast(t("Couldn't load songs."));
    } finally {
      setStarting(false);
    }
  }

  async function onShuffle() {
    if (starting) return;
    setStarting(true);
    try {
      await playShuffle(genre);
    } finally {
      setStarting(false);
    }
  }

  const albumsQuery = useInfiniteQuery({
    queryKey: ['genreAlbums', genre, albumSort, albumDir],
    queryFn: ({ pageParam }) => getAlbumsByGenre(genre, PAGE, pageParam, albumSort, albumDir),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
    enabled: !!auth && !!genre && tab === 'albums',
  });

  const songsQuery = useInfiniteQuery({
    // The order is part of what is being asked for, so changing it starts the
    // paging again instead of appending a differently sorted page to the list.
    queryKey: ['genreSongs', genre, sort, dir],
    queryFn: ({ pageParam }) => getSongsByGenre(genre, SONG_PAGE, pageParam, sort, dir),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length === SONG_PAGE ? pages.length * SONG_PAGE : undefined,
    enabled: !!auth && !!genre && tab === 'songs',
  });

  const albums = albumsQuery.data?.pages.flat() ?? [];
  const songs = songsQuery.data?.pages.flat() ?? [];
  const query = tab === 'albums' ? albumsQuery : songsQuery;

  // How big this genre is, said once at the top. It comes from the same list
  // the genre cards are drawn from, so on the way in from there it is already
  // in hand; arriving from a song's genre chip costs one request, which is the
  // whole list of genres and counts.
  const { data: genres } = useQuery({
    queryKey: ['genres'],
    queryFn: getGenres,
    enabled: !!auth,
  });
  const counts = genres?.find((g) => g.value === genre);
  const meta = [
    t('Genre'),
    counts?.albumCount ? albumsLabel(counts.albumCount, lang) : null,
    counts?.songCount ? songsLabel(counts.songCount, lang) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* While selecting, the header turns into ✕ + counter + select all, the
          same swap the album and playlist lists do. */}
      <View style={styles.header}>
        {/* While selecting, the ✕ cancels the selection and nothing else: the
            long press out of here belongs to the chevron. */}
        {selecting ? (
          <Pressable hitSlop={10} onPress={() => setSelectedIds(null)} accessibilityLabel={t('Close')}>
            <Icon name="close" size={26} color={colors.text} />
          </Pressable>
        ) : (
          <BackChevron />
        )}
        <Text style={styles.title} numberOfLines={1}>
          {selecting ? t('{n} selected', { n: selectedIds.size }) : genre}
        </Text>
        {selecting ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Select all')}
            onPress={() =>
              setSelectedIds(
                selectedIds.size === songs.length ? new Set() : new Set(songs.map((s) => s.id)),
              )
            }
          >
            <Icon
              name="checkmark-done"
              size={24}
              // From the setting, like the artist's song list draws the same
              // tick. `colors.accent` would have been the right colour too,
              // since `applyAccents` hot-swaps it, but only from the next render
              // onwards and nothing makes that render happen: the hook is what
              // subscribes.
              color={songs.length > 0 && selectedIds.size === songs.length ? accent : colors.text}
            />
          </Pressable>
        ) : tab === 'albums' ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('View')}
            onPress={openGridMenu}
          >
            {/* The icon shows what you are looking at, not what one more tap
                would give you. It used to be the second, which is how a button
                that flips between two states reads; it opens a menu now, and a
                menu is opened from a thing that says where you are. */}
            <Icon name={grid ? 'grid-outline' : 'list'} size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* What the genre is, in the terms the rest of the app uses for a list.
          Without it the screen was a title and nothing else: no way to tell two
          albums from four hundred, which is the first thing worth knowing here
          and the thing that makes "download this" a decision instead of a
          leap. */}
      {!selecting && meta ? <Text style={styles.meta}>{meta}</Text> : null}

      {/* The same row an album and a playlist have, in the same order: what you
          do TO this thing on the left, what starts it on the right. It is the
          app's own arrangement and the reason to keep it here is that somebody
          who has learnt one list screen has learnt this one. Saving a genre had
          ended up hidden inside the ⋯ for a while, which is nowhere near where
          anyone would look for it. */}
      {!selecting ? (
        <View style={styles.actions}>
          <View style={styles.actionsLeft}>
            {!offline ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Download')}
                onPress={() => void onDownloadPress()}
                style={styles.downloadWrap}
              >
                {gathering ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : download.status === 'active' ? (
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
            {/* Sorts whichever list the tab is showing, which is why it sits
                here and not next to the tabs: it is an action on this genre,
                same as the two beside it. */}
            {openListSort ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Sort')}
                onPress={openListSort}
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
            <Pressable hitSlop={10} onPress={onShuffle} accessibilityLabel={t('Shuffle')}>
              <Icon name="shuffle" size={26} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              style={[styles.playButton, { backgroundColor: accent }]}
              onPress={onPlay}
              accessibilityRole="button"
              accessibilityLabel={t('Play')}
            >
              {starting ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Icon name="play" size={28} color={colors.onAccent} style={{ marginLeft: 3 }} />
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Which of the two lists you are looking at. Right up against the list
          because that is what it is about; the row above is about the genre.
          How the albums are drawn used to sit at the right-hand end of this
          row and is now in the header, where every other grid in the app keeps
          it. */}
      <View style={styles.toolbar}>
        <View style={styles.tabs}>
          {(['albums', 'songs'] as const).map((key) => (
            <Pressable
              key={key}
              style={[styles.chip, tab === key && { backgroundColor: accent }]}
              onPress={() => {
                setTab(key);
                setSelectedIds(null);
              }}
            >
              <Text style={[styles.chipText, tab === key && styles.chipTextActive]}>
                {key === 'albums' ? t('Albums') : t('Songs')}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {query.isLoading ? (
        tab === 'songs' || !grid ? (
          <AlbumRowsSkeleton />
        ) : (
          <AlbumCardsSkeleton width={card} count={8} />
        )
      ) : query.isError ? (
        <Message
          text={tab === 'albums' ? t("Couldn't load albums.") : t("Couldn't load songs.")}
          onRetry={() => query.refetch()}
        />
      ) : tab === 'songs' ? (
        <FlatList
          {...listPerf}
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          contentContainerStyle={[styles.songList, { paddingBottom: bottomPad }]}
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
                // Discards the onPress that closes the long-press: it would
                // deselect the very song you entered selection with.
                if (justLongPressed.current === item.id) return;
                if (selecting) toggleSelect(item.id);
                else void playQueue(songs, index, genre, href);
              }}
            />
          )}
          onEndReached={() => songsQuery.hasNextPage && songsQuery.fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            songsQuery.isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="musical-notes-outline"
              title={t('No songs in this genre')}
              subtitle={t('Try exploring another genre.')}
            />
          }
        />
      ) : (
        <FlatList
          {...listPerf}
          data={albums}
          // Remount on layout change: FlatList reuses rows and gets stuck with
          // stale ones, and `numColumns` can't be hot-swapped either.
          key={`${layout}-${columns}`}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          {...(grid
            ? {
                numColumns: columns,
                columnWrapperStyle: { gap: GAP },
                contentContainerStyle: [styles.list, { paddingBottom: bottomPad }],
              }
            : { contentContainerStyle: [styles.rowList, { paddingBottom: bottomPad }] })}
          renderItem={({ item }) =>
            grid ? <AlbumCard album={item} width={card} /> : <AlbumRow album={item} />
          }
          onEndReached={() => albumsQuery.hasNextPage && albumsQuery.fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            albumsQuery.isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="disc-outline"
              title={t('No albums in this genre')}
              subtitle={t('Try exploring another genre.')}
            />
          }
        />
      )}

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
      {gridSheet}
      {sortSheet}
      {albumSortSheet}

      <SheetModal openRef={menuRef}>
        {(close) => (
          <>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                void addGenreToPlaylist();
              }}
            >
              <Icon name="add-circle-outline" size={22} color={colors.text} />
              <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
            </Pressable>
            {/* Shown whatever is on disk: this screen holds a window into the
                genre, so it cannot know whether any of it is downloaded without
                reading the whole thing, and reading it to decide whether to draw
                a row is a handful of requests for nothing. It says so when
                pressed instead. */}
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                void deleteGenreDownloads();
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
        title={t('Download “{name}”?', { name: genre })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          const songs = pending;
          if (songs) void downloadGenre(genre, songs);
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
          cancelDownload(`genre:${genre}`);
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
  // Under the title and to the same margin, like the meta line of an album or
  // a playlist.
  meta: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    // Asymmetric padding on purpose: even without includeFontPadding, glyphs
    // end up ~1dp low relative to the pill center (same as the browse chips).
    paddingTop: spacing.xs - 1,
    paddingBottom: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  chipTextActive: { color: colors.onAccent },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  // The same row the album and playlist headers have, to the same margins.
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  // The spinner and the percentage sit side by side where the icon was, so the
  // row doesn't jump when a download starts.
  downloadWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  downloadProgress: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '500',
    minWidth: 32,
  },
  // Same measurements as `TrackListView`, which is what an album and a playlist
  // draw: the button an album starts with cannot be smaller here.
  playButton: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING, gap: GAP },
  rowList: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.lg,
  },
  // Same side margin as the album and playlist song lists: `TrackRow` brings
  // no horizontal padding of its own, so without this the covers sit against
  // the left edge and the ⋯ against the right one.
  songList: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
}));
