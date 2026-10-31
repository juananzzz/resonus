/**
 * Browse all server albums, with sort, search and infinite scroll.
 *
 * A screen of its own and, `embedded`, the Albums section of the Explore tab
 * (see `BrowseFrame`).
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
import { FlatList as GHFlatList } from 'react-native-gesture-handler';

import { getAlbumList, searchAlbums, type Album, type AlbumListType } from '@/api/data';
import * as Local from '@/lib/localQueries';
import { AlbumCard } from '@/components/AlbumCard';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { AlbumRow } from '@/components/AlbumRow';
import { AlbumRowsSkeleton } from '@/components/AlbumRowsSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import {
  colors,
  fontSize,
  radius,
  restyled,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
  tracking,
} from '@/theme';
import { listPerf } from '@/lib/listPerf';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame, useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { BrowseToolbar } from '@/components/BrowseToolbar';
import { useBrowseSort } from '@/hooks/useBrowseSort';
import { useGridColumns } from '@/hooks/useGridColumns';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';

const PAGE = 30;
const GAP = spacing.sm;

/** Card width at a given density (#109). */
function cardWidth(columns: number): number {
  return (Dimensions.get('window').width - spacing.lg * 2 - GAP * (columns - 1)) / columns;
}

/** Bar height: the box (44) plus its gap to the row below. */
const SEARCH_H = 44 + spacing.md;

/**
 * Result limit. The normal list paginates, but search results don't: you
 * should type more, not scroll more. 50 is plenty to find an album without
 * asking the server for hundreds nobody will look at.
 */
const SEARCH_COUNT = 50;

/** Delay before querying the server: without this it'd be one request per keystroke. */
const DEBOUNCE_MS = 300;

// Same orders, in the same order, as Artists: they're sibling screens and
// seeing them listed differently felt jarring. 'alphabeticalByArtist' was dropped
// for this reason, by symmetry: it has no equivalent in Artists, where sorting
// by artist is exactly what A-Z already does.
const SORTS: { key: AlbumListType; label: string }[] = [
  { key: 'recent', label: 'Recently played' },
  { key: 'frequent', label: 'Most played::albums' },
  { key: 'newest', label: 'Recently added' },
  { key: 'byYear', label: 'New releases' },
  { key: 'alphabeticalByName', label: 'A-Z' },
  { key: 'random', label: 'Shuffle' },
];

/** What the route may ask to open on, when it knows (see Home's shelves). */
function sortFromParam(value: string | undefined): AlbumListType | undefined {
  return SORTS.some((s) => s.key === value) ? (value as AlbumListType) : undefined;
}

export default function BrowseAlbumsScreen() {
  return <AlbumsBrowser />;
}

/**
 * `downloaded` lists what the downloads catalog holds, online too (#310). An
 * album with one song saved is in it, and opens whole.
 */
export function AlbumsBrowser({
  embedded,
  actionRef,
  searchOpen,
  downloaded,
}: BrowserProps & { downloaded?: boolean }) {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const t = useT();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  /**
   * Arrived at from a Home shelf, this says which one: "Most played albums"
   * opens the same albums under the same heading rather than dropping you at
   * the top of a list you then have to sort yourself. Only the initial value —
   * each visit is its own screen, so there is nothing here to keep in step.
   */
  const { sort: sortParam } = useLocalSearchParams<{ sort?: string }>();
  const [sort, setSort] = useBrowseSort<AlbumListType>(
    downloaded ? 'downloadedAlbums' : 'browseAlbums',
    SORTS.map((s) => s.key),
    downloaded ? 'newest' : 'recent',
    sortFromParam(sortParam),
  );
  const layout = useSettings((s) => s.browseAlbumsLayout);
  const setLayout = useSettings((s) => s.setBrowseAlbumsLayout);
  const grid = layout === 'grid';
  // Rows or cards, and how many across, in one menu (#109).
  const { columns, openGridMenu, gridSheet } = useGridColumns('browseAlbums', {
    value: layout,
    set: setLayout,
  });
  const card = cardWidth(columns);

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: [downloaded ? 'downloadedAlbums' : 'browseAlbums', sort],
      queryFn: ({ pageParam }) =>
        (downloaded ? Local.getAlbumList : getAlbumList)(sort, PAGE, pageParam),
      initialPageParam: 0,
      getNextPageParam: (last, pages) =>
        last.length === PAGE ? pages.length * PAGE : undefined,
      enabled: canFetch,
      // «Recently played» changes with every listen: refreshes on returning to
      // the screen so it feels alive (other orders change little and keep the
      // global staleTime of 5 min).
      // Downloads change with no word to this list, and asking costs no network.
      refetchOnMount: downloaded || sort === 'recent' ? 'always' : undefined,
    });

  // ── Pull-down search ───────────────────────────────────────────────────
  // Same gesture and same bar as browsing artists, but internally it's not a
  // filter: there `getArtists` brings the full index, so client-side filtering
  // is exact. Here the list paginates PAGE by PAGE, and filtering what's loaded
  // would only look at already-scrolled pages — it would seem to work and
  // leave half the library out. So it asks the server.
  const listRef = useRef<GHFlatList<Album>>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  // The text is ahead of what's being queried: you type letter by letter and
  // each one would fire a request.
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
    queryKey: [downloaded ? 'searchDownloadedAlbums' : 'searchAlbums', debounced],
    queryFn: () => (downloaded ? Local.searchAlbums : searchAlbums)(debounced, SEARCH_COUNT),
    enabled: canFetch && debounced.length > 0,
  });

  function clearSearch() {
    Keyboard.dismiss();
    setQuery('');
    setSearching(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  // Embedded, whether the box is there is the tab's answer; on this screen it
  // simply is.
  const showSearch = useSearchBox(embedded, searchOpen, clearSearch);

  // When searching, the search results rule: the typed text, not the debounce,
  // so the full list doesn't flash back for an instant between keystrokes.
  const isSearch = query.trim().length > 0;
  const albums = isSearch ? (results ?? []) : (data?.pages.flat() ?? []);
  // While the debounce hasn't fired the query is still off, so it's not
  // "loading" but there are also no results: without this «No results» would
  // flash between keystrokes.
  const searchPending = isSearch && (searchLoading || debounced !== query.trim());

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
      <Icon name={grid ? 'grid-outline' : 'list'} size={20} color={colors.textSecondary} />
    </Pressable>
  );

  return (
    <BrowseFrame embedded={embedded}>
      {embedded ? null : (
        <View style={styles.header}>
          <BackChevron />
          <Text style={styles.title}>{t('Albums')}</Text>
          {/* Takes the same width as the back chevron so the title stays
              centered; there used to be an empty slot of the same width here. */}
          <View style={styles.headerAction}>{viewButton}</View>
        </View>
      )}

      {/* Always there on its own screen: finding an album is what it is for.
          In the tab the magnifier asks for it (see `useSearchBox`). */}
      {showSearch ? (
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Icon name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              placeholder={t('Find an album')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearching(true)}
              returnKeyType="search"
              // Embedded it was opened on purpose, so the keyboard is what
              // comes next; on the screen it would cover the list on arrival.
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
          {/* Only on its own screen. In the tab the magnifier has turned into
              an X, and a second way out beside the box is one too many. */}
          {searching && !embedded ? (
            <Pressable hitSlop={8} accessibilityRole="button" onPress={clearSearch}>
              <Text style={styles.searchCancel}>{t('Cancel')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Gone while searching: the server returns by relevance, so ordering
          results isn't in its hands, and what "play everything" would start is
          not what you were looking for either. */}
      {isSearch ? null : (
        <BrowseToolbar
          options={SORTS}
          value={sort}
          onChange={setSort}
          // It plays the server's library, which is not this list.
          play={downloaded ? undefined : { source: t('Library'), href: '/browse/albums' }}
        />
      )}

      {(isSearch ? searchPending : isLoading) ? (
        grid ? (
          <AlbumCardsSkeleton width={card} count={8} />
        ) : (
          <AlbumRowsSkeleton />
        )
      ) : isSearch && searchError ? (
        <Message text={t("Couldn't load albums.")} onRetry={() => refetchSearch()} />
      ) : isError ? (
        <Message text={t("Couldn't load albums.")} onRetry={() => refetch()} />
      ) : (
        <GHFlatList
        {...listPerf}
          ref={listRef}
          data={albums}
          // Remount the list when changing sort or layout: otherwise FlatList
          // reuses rows and gets stuck with stale ones (numColumns also doesn't
          // support hot-swapping).
          key={`${sort}-${layout}-${columns}`}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          {...(grid
            ? { numColumns: columns, columnWrapperStyle: { gap: GAP }, contentContainerStyle: [styles.list, { paddingBottom: bottomPad }] }
            : { contentContainerStyle: [styles.rowList, { paddingBottom: bottomPad }] })}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }: { item: Album }) =>
            grid ? <AlbumCard album={item} width={card} /> : <AlbumRow album={item} />
          }
          // Results don't paginate: they're a cap, not a window. Requesting the
          // next page at the end would bring in the normal list instead.
          onEndReached={() => !isSearch && hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            !isSearch && isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
            ) : null
          }
          ListEmptyComponent={
            isSearch ? (
              <EmptyState
                icon="search-outline"
                title={t('No results')}
                subtitle={t('No results for “{q}”', { q: query.trim() })}
              />
            ) : downloaded && sort !== 'frequent' && sort !== 'recent' ? (
              <EmptyState icon="download-outline" title={t('Nothing here is downloaded')} />
            ) : sort === 'frequent' || sort === 'recent' ? (
              <EmptyState
                icon="play-outline"
                title={t('Nothing played yet')}
                subtitle={
                  sort === 'recent'
                    ? t('Your recently played albums will show up here.')
                    : t('Your most played albums will show up here.')
                }
              />
            ) : (
              <EmptyState
                icon="disc-outline"
                title={t('No albums yet')}
                subtitle={t('Your library looks empty.')}
              />
            )
          }
        />
      )}
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
  headerAction: { width: 26, alignItems: 'flex-end' },

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
    // A capsule with Round, a rounded rectangle with Pointier.
    borderRadius: restyled(radius.pill, radius.md),
  },
  input: { flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: 0 },
  searchCancel: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: GAP,
  },
  // In rows the gap between cards is tight: the Library ones breathe with
  // spacing.lg and these are the same.
  rowList: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.lg,
  },
}));
