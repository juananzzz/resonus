/**
 * Browse all server albums, with sort, search and infinite scroll.
 *
 * A screen of its own and, `embedded`, the Albums section of the Library tab
 * (see `BrowseFrame`).
 *
 * `favorited` is that section's heart: the same screen, held to what carries a
 * star. It changes everything the orders and the box would otherwise do, so it
 * gets its own keys and its own offered sorts — the starred answer is one full
 * list, which is what makes the filter here exact instead of a server call.
 */
import Icon from '@/components/Icon';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Pressable,
  Text,
  View,
} from 'react-native';
import { FlatList as GHFlatList, RefreshControl } from 'react-native-gesture-handler';

import { getAlbumList, searchAlbums, type Album, type AlbumListType } from '@/api/data';
import * as Local from '@/lib/localQueries';
import { byLibraryName, matches, withPins } from '@/lib/librarySort';
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
import { SearchBox } from '@/components/SearchBox';
import { useAlbumAvailability } from '@/hooks/useAlbumAvailability';
import { useBrowseSort } from '@/hooks/useBrowseSort';
import { useGridColumns } from '@/hooks/useGridColumns';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useStarredList } from '@/hooks/useStarredList';
import { usePins } from '@/store/pins';

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

// The same orders as Artists, plus album artist, which Artists has no use for
// (its A-Z is that) and other clients offer (#327).
const SORTS: { key: AlbumListType; label: string }[] = [
  { key: 'recent', label: 'Recently played' },
  { key: 'frequent', label: 'Most played::albums' },
  { key: 'newest', label: 'Recently added' },
  { key: 'byYear', label: 'New releases' },
  { key: 'alphabeticalByName', label: 'A-Z' },
  { key: 'alphabeticalByArtist', label: 'Album artist' },
  { key: 'random', label: 'Shuffle' },
];

/** What the route may ask to open on, when it knows (see Home's shelves). */
function sortFromParam(value: string | undefined): AlbumListType | undefined {
  return SORTS.some((s) => s.key === value) ? (value as AlbumListType) : undefined;
}

/**
 * The orders a favorited list offers. The starred answer arrives complete and
 * unsorted, so there is nothing here that could be re-ordered by when it was
 * played, how often, or when it came out: the server did that work for the
 * lists above, and it says nothing about favorites. Alphabetical, album artist
 * and shuffled read the rows themselves, so they answer for any of them.
 */
const FAVORITE_SORTS: AlbumListType[] = ['alphabeticalByName', 'alphabeticalByArtist', 'random'];

export default function BrowseAlbumsScreen() {
  return <AlbumsBrowser />;
}

/**
 * `downloaded` lists what the downloads catalog holds, online too (#310). An
 *  album with one song saved is in it, and opens whole.
 *
 * `favorited` keeps the list to what carries a star, which is the same screen
 *  one filter deeper: the rows, the layout and the box stay, the data behind
 *  them is the starred answer rather than a window on the catalogue, and the
 *  personal rules that belong to favorites (pins first, offline dimming, the
 *  ↓ of what is on the phone) come along with it.
 *
 * `onToggleDownloaded` and `onToggleFavorite` are the two presses the tab makes
 *  in the section's own sort row: the row draws the icons, and the state they
 *  belong to is the tab's, so this hands the press down rather than holding a
 *  copy of it. A section reached as a screen of its own passes neither, and
 *  draws neither icon.
 */
export function AlbumsBrowser({
  embedded,
  actionRef,
  searchOpen,
  downloaded,
  favorited,
  onToggleDownloaded,
  onToggleFavorite,
}:
  BrowserProps) {
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
    favorited ? 'favoriteAlbums' : downloaded ? 'downloadedAlbums' : 'browseAlbums',
    favorited ? FAVORITE_SORTS : SORTS.map((s) => s.key),
    favorited ? 'alphabeticalByName' : downloaded ? 'newest' : 'recent',
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
      // The heart's list is the one below, not a window on the catalogue.
      enabled: canFetch && !favorited,
      // «Recently played» changes with every listen: refreshes on returning to
      // the screen so it feels alive (other orders change little and keep the
      // global staleTime of 5 min).
      // Downloads change with no word to this list, and asking costs no network.
      refetchOnMount: downloaded || sort === 'recent' ? 'always' : undefined,
    });

  // The section's heart, and the same `['starred']` entry the hearts on every
  //  other screen read from: one request, and the star/unstar invalidation
  //  repaints the list and the row marks together. With the heart off the
  //  request never goes out.
  const starredQ = useStarredList(favorited);

  // Favorites are the personal half of this screen, so they keep the rules the
  //  rows there were drawn under: what you pinned stays pinned whatever the
  //  order says, what cannot be played offline is dimmed (or, in hide mode, not
  //  drawn at all), and what is whole on the phone still carries its ↓.
  const pins = usePins((s) => s.pins);
  const hideUnavailable = useSettings((s) => s.hideUnavailableOffline);
  const availability = useAlbumAvailability(favorited);

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
    // The heart already holds the whole answer, so its box filters that list
    // right here: asking the server for favorites' favorites would be a second
    // request for something the one above already says.
    enabled: canFetch && debounced.length > 0 && !favorited,
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

  /**
   * The favorited list, worked out once: memoised ahead of the early returns
   *  below, since hooks cannot be conditional, and because every keystroke in
   *  the box above re-runs it. Filtering here is exact — the starred answer is
   *  the whole list, not the window the one above paginates — which is also
   *  why the box does not wait for the debounce: nothing is asked of the
   *  server, so a letter lands as you type it.
   */
  const favoriteAlbums = useMemo(
    () => {
      if (!favorited) return null;
      const q = query.trim();
      const list = (starredQ.data?.albums ?? []).filter(
        (a) =>
          !(hideUnavailable && availability.unavailable(a)) && (!q || matches(q, a.name, a.artist)),
      );
      const sorted =
        sort === 'random'
          ? (() => {
              const arr = list.slice();
              for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
              }
              return arr;
            })()
          : list.sort(
              sort === 'alphabeticalByArtist'
                ? (a, b) =>
                    byLibraryName(a.artist ?? '', b.artist ?? '') ||
                    byLibraryName(a.name, b.name)
                : (a, b) => byLibraryName(a.name, b.name),
            );
      return withPins(sorted, (a) => `album:${a.id}`, pins);
    },
    [favorited, starredQ.data, query, sort, hideUnavailable, availability, pins],
  );

  // When searching, the search results rule: the typed text, not the debounce,
  // so the full list doesn't flash back for an instant between keystrokes.
  const isSearch = query.trim().length > 0;
  const albums =
    favorited ? (favoriteAlbums ?? []) : isSearch ? (results ?? []) : (data?.pages.flat() ?? []);
  // While the debounce hasn't fired the query is still off, so it's not
  // "loading" but there are also no results: without this «No results» would
  // flash between keystrokes. In favorites nothing is waiting, so there is
  // nothing to flash.
  const searchPending =
    !favorited && isSearch && (searchLoading || debounced !== query.trim());
  // Whichever of the two lists is the one on screen answers for its own load.
  const loading = favorited ? starredQ.isLoading : isLoading;
  const failed = favorited ? starredQ.isError : isError;

  // Pulling the list down asks it again, and asks whichever list the screen is
  //  holding: the heart swapped which one that is, and refreshing the other
  //  would be a request for something you are not looking at.
  const pull = usePullRefresh(
    favorited ? starredQ.refetch : isSearch ? refetchSearch : refetch,
    "Couldn't refresh the albums",
  );

  // Embedded, the button that opens this menu is drawn by the Library tab, in
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
          <SearchBox
            style={{ flex: 1 }}
            placeholder={t('Find an album')}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearching(true)}
            autoFocus={embedded}
          />
          {/* Only on its own screen. In the tab the magnifier has turned into
              an X, and a second way out beside the box is one too many. */}
          {searching && !embedded ? (
            <Pressable hitSlop={8} accessibilityRole="button" onPress={clearSearch}>
              <Text style={styles.searchCancel}>{t('Cancel')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* The order is not the list's while the server answers a search: it
          returns by relevance, so the sheet would offer orders the answer is
          not in. The two filters still hold the answer, so their presses stay
          where the finger already found them. */}
      <BrowseToolbar
        ordering={!isSearch}
        options={
          favorited
            ? SORTS.filter((s) => FAVORITE_SORTS.includes(s.key))
            : SORTS
        }
        value={sort}
        onChange={setSort}
        download={onToggleDownloaded ? { on: !!downloaded, toggle: onToggleDownloaded } : undefined}
        favorite={onToggleFavorite ? { on: !!favorited, toggle: onToggleFavorite } : undefined}
      />

      {(isSearch ? searchPending : loading) ? (
        grid ? (
          <AlbumCardsSkeleton width={card} count={8} />
        ) : (
          <AlbumRowsSkeleton />
        )
      ) : isSearch && searchError ? (
        <Message text={t("Couldn't load albums.")} onRetry={() => refetchSearch()} />
      ) : failed ? (
        <Message
          text={t("Couldn't load albums.")}
          onRetry={() => void (favorited ? starredQ.refetch() : refetch())}
        />
      ) : (
        <GHFlatList
        {...listPerf}
          ref={listRef}
          data={albums}
          // Pulling the list down asks again for whatever list is on screen
          //  (see `usePullRefresh`): the favourites answer is one request, the
          //  browse window re-asks for the pages you had loaded.
          refreshControl={
            <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />
          }
          // Remount the list when changing sort or layout: otherwise FlatList
          // reuses rows and gets stuck with stale ones (numColumns also doesn't
          // support hot-swapping). The heart and the Downloaded filter are in
          //  here too: each swaps the whole list behind the rows, so the rows
          //  have to be measured again. Neither belongs in the section's own
          //  key up in the tab — remounting there is what takes what you typed
          //  in the search box with it.
          key={`${downloaded}-${favorited}-${sort}-${layout}-${columns}`}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          {...(grid
            ? { numColumns: columns, columnWrapperStyle: { gap: GAP }, contentContainerStyle: [styles.list, { paddingBottom: bottomPad }] }
            : { contentContainerStyle: [styles.rowList, { paddingBottom: bottomPad }] })}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }: { item: Album }) =>
            grid ? (
              <AlbumCard
                album={item}
                width={card}
                pinned={!!pins[`album:${item.id}`]}
                dimmed={availability.unavailable(item)}
                badge={availability.downloaded(item)}
              />
            ) : (
              <AlbumRow
                album={item}
                pinned={!!pins[`album:${item.id}`]}
                dimmed={availability.unavailable(item)}
                downloaded={availability.downloaded(item)}
              />
            )
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
            ) : favorited ? (
              <EmptyState
                icon="heart-outline"
                title={t('No favorite albums')}
                subtitle={t('Favorite albums to see them here.')}
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
