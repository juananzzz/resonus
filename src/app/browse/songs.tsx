/**
 * Browse the library's songs: the sibling of browsing albums and artists, with
 * the same header, the same search, the same toolbar and the same choice of
 * rows or a grid. Holding one starts selecting, which the other
 * two have no use for and a screen made for gathering songs does (#77).
 *
 * Which orders it offers is `songListSorts`'s to say, because the answer is the
 * server's: Jellyfin, Navidrome (through its own API) and a local library sort
 * songs by anything. A plain Subsonic server sorts none: there the rest are
 * arrived at through the albums it does know how to sort, and A-Z is the one
 * that has no stand-in. No pill here promises an order that won't come.
 *
 * Finding one song among many is the search bar's job, not the list's: a
 * six-figure library is not something anybody scrolls, and pulling it down to
 * sort it on the phone is not something a phone can do.
 */
import Icon from '@/components/Icon';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
// The list must use gesture-handler so the row swipe-to-queue doesn't fight
// the vertical scroll (with RN's FlatList the gesture is flaky).
import { FlatList as GHFlatList } from 'react-native-gesture-handler';

import { getSongList, searchSongs, songListSorts } from '@/api/data';
import { type Song, type SongListSort } from '@/api/subsonic';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { AlbumRowsSkeleton } from '@/components/AlbumRowsSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { SelectionBar } from '@/components/SelectionBar';
import { SongCard } from '@/components/SongCard';
import { TrackRow } from '@/components/TrackRow';
import { useAccent } from '@/hooks/useAccent';
import { useBrowseSort } from '@/hooks/useBrowseSort';
import { useSelectionMenu } from '@/hooks/useSelectionMenu';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { currentSong, usePlayerStore } from '@/store/player';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { usePlayHistory } from '@/store/playHistory';
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
import { useGridColumns } from '@/hooks/useGridColumns';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame, useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { BrowseToolbar } from '@/components/BrowseToolbar';

const PAGE = 50;

// The same measurements as browsing albums: both are full-screen grids of
// covers and cards of different sizes between them would look like an accident.
// That is why they start at the same density and each keeps its own after
// that: whoever changes one of them is looking at that one (#109).
const GAP = spacing.sm;

/** Card width at a given density (#109). */
function cardWidth(columns: number): number {
  return (Dimensions.get('window').width - spacing.lg * 2 - GAP * (columns - 1)) / columns;
}

/** Bar height: the box (44) plus its gap to the row below. */
const SEARCH_H = 44 + spacing.md;

/**
 * Result limit. The normal list paginates, but search results don't: you should
 * type more, not scroll more. The same 50 browsing albums settled on.
 */
const SEARCH_COUNT = 50;

/** Delay before querying the server: without this it'd be one request per keystroke. */
const DEBOUNCE_MS = 300;

const SORT_LABEL: Record<SongListSort, string> = {
  server: 'Default',
  recent: 'Recently played',
  alpha: 'A-Z',
  added: 'Recently added',
  frequent: 'Most played::songs',
  random: 'Shuffle',
};

export default function BrowseSongsScreen() {
  return <SongsBrowser />;
}

export function SongsBrowser({ embedded, actionRef, searchOpen }: BrowserProps) {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  // Rows stop growing at a reading measure and centre themselves (#131).
  const listPad = useListPadding(spacing.lg);
  const t = useT();
  // Through the hook, not straight off `colors`: it is what the light
  // appearance darkens, and what the marked pill and the card ticks repaint on.
  const accent = useAccent();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const toast = useToast((s) => s.show);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  const openPlaylistPicker = usePlaylistPicker((s) => s.open);
  // Its own preference, not the one from browsing albums: the button on one
  // screen shouldn't silently rearrange the other.
  const layout = useSettings((s) => s.browseSongsLayout);
  const setLayout = useSettings((s) => s.setBrowseSongsLayout);
  const grid = layout === 'grid';
  // Rows or cards, and how many across, in one menu (#109).
  const { columns, openGridMenu, gridSheet } = useGridColumns('browseSongs', {
    value: layout,
    set: setLayout,
  });
  const card = cardWidth(columns);
  // What this server can actually order by; the first one is what it opens on.
  const sorts = canFetch ? songListSorts(offline) : [];
  /**
   * Arrived at from a Home shelf, this says which one. Only the value it opens
   * on: each visit is its own screen, so there is nothing to keep in step. An
   * order this server cannot give is ignored rather than offered in a menu
   * where it would do nothing.
   */
  const { sort: sortParam } = useLocalSearchParams<{ sort?: string }>();
  const [sort, setSort] = useBrowseSort<SongListSort>(
    'browseSongs',
    sorts,
    sorts[0] ?? 'server',
    sorts.find((s) => s === sortParam),
  );

  // When the last song played changes, "Recently played" is a different list:
  // it is the key so the list follows along instead of sitting in the cache until
  // something else happens to clear it (playing something used to show up here
  // only after refreshing Home). The other orders don't move with a play, so
  // they don't carry it.
  const lastPlayedAt = usePlayHistory((s) => s.entries[0]?.playedAt ?? 0);
  const recentKey = sort === 'recent' ? lastPlayedAt : 0;

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['browseSongs', sort, recentKey],
      queryFn: ({ pageParam }) => getSongList(sort, PAGE, pageParam),
      initialPageParam: 0,
      getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
      enabled: canFetch,
      // "Recently played" is this phone's own play history and costs nothing to
      // rebuild, so it is rebuilt every time the screen opens. "Most played" is not:
      // the server only sorts albums, so that list is fifteen album requests,
      // and asking for them again on every visit was most of the traffic of a
      // session. It goes back to the ordinary five minutes, and the album
      // details behind it are shared with the album screens now.
      refetchOnMount: sort === 'recent' ? 'always' : undefined,
    });

  // ── Search ─────────────────────────────────────────────────────────────
  // Server-side, like browsing albums: filtering the loaded pages would look
  // like it works and quietly leave the rest of the library out.
  const listRef = useRef<GHFlatList<Song>>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const {
    data: results,
    isLoading: searchLoading,
    isError: searchError,
    refetch: refetchSearch,
  } = useQuery({
    queryKey: ['searchSongs', debounced, SEARCH_COUNT],
    queryFn: () => searchSongs(debounced, SEARCH_COUNT),
    enabled: canFetch && debounced.length > 0,
  });

  const isSearch = query.trim().length > 0;
  const songs = isSearch ? (results ?? []) : (data?.pages.flat() ?? []);
  // While the debounce hasn't fired the query is still off, so it's not
  // "loading" but there are also no results: without this «No results» would
  // flash between keystrokes.
  const searchPending = isSearch && (searchLoading || debounced !== query.trim());

  // ── Multi-select ───────────────────────────────────────────────────────
  // Same as the genre and album lists: null = normal, a Set (even empty) =
  // selecting. Building a playlist out of loose songs is what the screen was
  // asked for, and one by one through the ⋯ menu is not building anything.
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

  function clearSearch() {
    Keyboard.dismiss();
    setQuery('');
    setSearching(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  // Embedded, whether the box is there is the tab's answer; on this screen it
  // simply is.
  const showSearch = useSearchBox(embedded, searchOpen, clearSearch);

  // Embedded, the button that opens this menu is drawn by the Explore tab, in
  // its own header: this is the way down to the menu it belongs to. Kept up to
  // date after every render rather than during one, which is a rule the ref is
  // not worth breaking for — it is only read from a tap, long after this.
  useEffect(() => {
    if (actionRef) actionRef.current = openGridMenu;
  });

  const viewButton = (
    <Pressable
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('View')}
      onPress={openGridMenu}
    >
      <Icon name={grid ? 'grid-outline' : 'list'} size={22} color={colors.textSecondary} />
    </Pressable>
  );
  const selectAll = !selecting ? null : (
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
        color={songs.length > 0 && selectedIds.size === songs.length ? accent : colors.text}
      />
    </Pressable>
  );

  return (
    <BrowseFrame embedded={embedded}>
      {/* Same header as browsing albums and artists: the title centred between
          the chevron and a slot of its width. While selecting it turns into
          ✕ + counter + select all, the swap the other song lists do — and that
          swap is the one thing the embedded section keeps a header for, since
          the ✕ is the way out of it. */}
      {embedded && !selecting ? null : (
        <View style={styles.header}>
          {/* While selecting, the ✕ cancels the selection and nothing else: the
              long press out of here belongs to the chevron. */}
          {selecting ? (
            <Pressable
              hitSlop={10}
              onPress={() => setSelectedIds(null)}
              accessibilityLabel={t('Close')}
            >
              <Icon name="close" size={26} color={colors.text} />
            </Pressable>
          ) : embedded ? null : (
            <BackChevron />
          )}
          <Text style={styles.title} numberOfLines={1}>
            {selecting ? t('{n} selected', { n: selectedIds.size }) : t('Songs')}
          </Text>
          {/* Embedded, the view menu is drawn by the Explore tab and this slot
              only carries the select-all. It keeps its width either way, so the
              title stays centred. */}
          <View style={styles.headerAction}>
            {selecting ? selectAll : embedded ? null : viewButton}
          </View>
        </View>
      )}

      {/* Always there on its own screen: finding one song among many is what
          the box is for. In the tab the magnifier asks for it. */}
      {showSearch ? (
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Icon name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              placeholder={t('Find a song')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearching(true)}
              returnKeyType="search"
              autoFocus={embedded}
            />
            {query.length > 0 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Clear')}
                onPress={() => setQuery('')}
              >
                <Icon name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          {/* Only on its own screen: in the tab the X in the header is the way
              out of the bar. */}
          {searching && !embedded ? (
            <Pressable hitSlop={8} accessibilityRole="button" onPress={clearSearch}>
              <Text style={styles.searchCancel}>{t('Cancel')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Gone while searching, and while selecting: results come back by
          relevance so there is no order to show, and an action row is not what
          a selection wants over its list. */}
      {isSearch || selecting ? null : (
        <BrowseToolbar
          options={sorts.map((key) => ({ key, label: SORT_LABEL[key] }))}
          value={sort}
          onChange={(key) => {
            setSort(key);
            setSelectedIds(null);
          }}
          play={{ sort, source: t('Songs'), href: '/browse/songs' }}
        />
      )}

      {(isSearch ? searchPending : isLoading) ? (
        grid ? (
          <AlbumCardsSkeleton width={card} count={8} />
        ) : (
          <AlbumRowsSkeleton />
        )
      ) : isSearch && searchError ? (
        <Message text={t("Couldn't load songs.")} onRetry={() => refetchSearch()} />
      ) : isError ? (
        <Message text={t("Couldn't load songs.")} onRetry={() => refetch()} />
      ) : (
        <GHFlatList
          {...listPerf}
          ref={listRef}
          data={songs}
          // The random order can hand back a song that already came in an
          // earlier page, so the index goes into the key.
          keyExtractor={(item, i) => `${item.id}-${i}`}
          // Remount the list when changing sort or view: otherwise FlatList
          // reuses rows and gets stuck with stale ones (numColumns can't be
          // hot-swapped either).
          key={`${sort}-${layout}-${columns}`}
          {...(grid
            ? {
                numColumns: columns,
                columnWrapperStyle: { gap: GAP },
                contentContainerStyle: [styles.grid, { paddingBottom: bottomPad }],
              }
            : {
                contentContainerStyle: [
                  styles.list,
                  { paddingBottom: bottomPad, paddingHorizontal: listPad },
                ],
              })}
          extraData={selectedIds}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item, index }: { item: Song; index: number }) => {
            // Both views answer to the same two gestures, so switching one for
            // the other doesn't change what your fingers already know.
            const onPressIn = () => {
              justLongPressed.current = null;
            };
            const onLongPress = selecting
              ? undefined
              : () => {
                  haptic('medium');
                  setSelectedIds(new Set([item.id]));
                  justLongPressed.current = item.id;
                };
            const onPress = () => {
              // Discards the onPress that closes the long-press: it would
              // deselect the very song you entered selection with.
              if (justLongPressed.current === item.id) return;
              if (selecting) toggleSelect(item.id);
              else void playQueue(songs, index, t('Songs'), '/browse/songs');
            };
            return grid ? (
              <SongCard
                song={item}
                width={card}
                accent={accent}
                isCurrent={playing?.id === item.id}
                selecting={selecting}
                selected={!!selectedIds?.has(item.id)}
                onPressIn={onPressIn}
                onLongPress={onLongPress}
                onPress={onPress}
              />
            ) : (
              <TrackRow
                song={item}
                isCurrent={playing?.id === item.id}
                showArtwork={showListArtwork}
                selecting={selecting}
                selected={!!selectedIds?.has(item.id)}
                onPressIn={onPressIn}
                onLongPress={onLongPress}
                onPress={onPress}
              />
            );
          }}
          // Results are a cap, not a window: asking for more at the end would
          // bring the plain list back underneath them.
          onEndReached={() => !isSearch && hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            !isSearch && isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={accent} />
            ) : null
          }
          ListEmptyComponent={
            isSearch ? (
              <EmptyState
                icon="search-outline"
                title={t('No results')}
                subtitle={t('No results for “{q}”', { q: query.trim() })}
              />
            ) : sort === 'recent' || sort === 'frequent' ? (
              // These two only hold what has been played, so on a fresh account
              // they are empty and that is not the library being empty.
              <EmptyState
                icon="play-outline"
                title={t('Nothing played yet')}
                subtitle={
                  sort === 'recent'
                    ? t('Your recently played songs will show up here.')
                    : t('Your most played songs will show up here.')
                }
              />
            ) : (
              <EmptyState
                icon="musical-notes-outline"
                title={t('No songs yet')}
                subtitle={t('Your library looks empty.')}
              />
            )
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
    </BrowseFrame>
  );
}

const styles = themed((colors) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  // The same width as the back chevron, so the title stays centred.
  headerAction: { width: 26, alignItems: 'flex-end' },
  // The same row an album, a playlist and a genre have, to the same margins:
  // what you do to the list on the left, what starts it on the right.
  searchRow: {
    height: SEARCH_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    // The gap to the row below is part of the height, not an outer margin.
    paddingBottom: spacing.md,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    backgroundColor: colors.surfaceHighlight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    paddingVertical: 0,
  },
  searchCancel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  // `TrackRow` brings no horizontal padding of its own, so without this the
  // covers sit against the left edge and the ⋯ against the right one.
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  grid: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: GAP,
  },
}));
