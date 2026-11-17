/** Browse all artists on the server, with quick filter. */
/* A screen of its own and, `embedded`, the Artists section of the Library tab
 *  (see `BrowseFrame`). */
import Icon from '@/components/Icon';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Pressable,
  Text,
  View,
} from 'react-native';
import { FlatList as GHFlatList, RefreshControl } from 'react-native-gesture-handler';

import { getAlbumList, getArtists, type Album, type Artist } from '@/api/data';
import * as Local from '@/lib/localQueries';
import { byArtistSortName } from '@/lib/librarySort';
import { ArtistCard } from '@/components/ArtistCard';
import { ArtistGridSkeleton } from '@/components/ArtistGridSkeleton';
import { ArtistListSkeleton } from '@/components/ArtistListSkeleton';
import { ArtistRow } from '@/components/ArtistRow';
import { useStarredList } from '@/hooks/useStarredList';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { useBrowseSort } from '@/hooks/useBrowseSort';
import { useHistoryTimes } from '@/hooks/useHistoryTimes';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useLastPlayed } from '@/store/lastPlayed';
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
import { useGridColumns } from '@/hooks/useGridColumns';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';

// Three across is what this screen starts as (`GRID_DEFAULT_COLUMNS`), like
// the Library grid: circles come out to ~121dp, nearly the 130dp Home uses for
// artists. Two (the album grid) would go to 186dp and only fit four per screen,
// which with 500 artists is endless scrolling. An album is recognized by its
// cover and deserves size; an artist is recognized by their face much sooner.
// It is where the screen starts and no longer where it has to stay (#109).
const GAP = spacing.sm;

/** Card width at a given density (#109). */
function cardWidth(columns: number): number {
  return (Dimensions.get('window').width - spacing.lg * 2 - GAP * (columns - 1)) / columns;
}

/**
 * Client-side sorting: `getArtists()` brings the full index at once and
 * alphabetical, and Subsonic offers no other order for artists (unlike
 * albums, where the server sorts). Since they're all here already, sorting
 * is free.
 */
type ArtistSort = 'alpha' | 'recent' | 'newest' | 'frequent' | 'random';

// The same orders the album screen offers (without 'Artist', which doesn't
// make sense here): they're sibling screens and seeing them listed differently
// felt jarring.
const SORTS: { key: ArtistSort; label: string }[] = [
  { key: 'recent', label: 'Recently played' },
  { key: 'frequent', label: 'Most played' },
  { key: 'newest', label: 'Recently added' },
  { key: 'alpha', label: 'A-Z' },
  { key: 'random', label: 'Shuffle' },
];

/** How many albums are checked to infer frequent / recently added artists. */
const FREQUENT_POOL = 50;

/** Bar height: the box (44) plus its gap to the row below. */
const SEARCH_H = 44 + spacing.md;

export default function BrowseArtistsScreen() {
  return <ArtistsBrowser />;
}

/**
 * `downloaded` lists the artists with music on the phone, online too (#310).
 *
 * `favorited` narrows that to the ones carrying a star. The list here is the
 *  full index the server already hands over in one go, so favorites are an
 *  intersection with the ids the star list holds rather than a second request:
 *  the index's own rows are what keeps the album count under each name.
 *
 * `onToggleDownloaded` and `onToggleFavorite` are the presses the Library tab
 *  makes in this section's sort row; the state they belong to is the tab's, so
 *  the press is handed down rather than copied here.
 */
export function ArtistsBrowser({
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
  const [query, setQuery] = useState('');
  /** Same as the Albums and Songs screens: a Home shelf can say which order it
   *  was showing, and anything unrecognised is ignored. */
  const { sort: sortParam } = useLocalSearchParams<{ sort?: string }>();
  const [sort, setSort] = useBrowseSort<ArtistSort>(
    downloaded ? 'downloadedArtists' : 'browseArtists',
    SORTS.map((s) => s.key),
    'recent',
    SORTS.some((s) => s.key === sortParam) ? (sortParam as ArtistSort) : undefined,
  );
  const layout = useSettings((s) => s.browseArtistsLayout);
  const setLayout = useSettings((s) => s.setBrowseArtistsLayout);
  const grid = layout === 'grid';
  // Rows or cards, and how many across, in one menu (#109).
  const { columns, openGridMenu, gridSheet } = useGridColumns('browseArtists', {
    value: layout,
    set: setLayout,
  });
  const card = cardWidth(columns);

  // "Recently played" blends both sources: having opened their screen and
  // having played within any queue. Neither alone tells the full story, and
  // opening an artist without pressing play is rare enough that the order is
  // named for what the two of them are mostly made of.
  const times = useLastPlayed((s) => s.times);
  const { byArtist } = useHistoryTimes();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [downloaded ? 'downloadedArtists' : 'allArtists'],
    queryFn: () => (downloaded ? Local.getArtists : getArtists)(),
    enabled: canFetch,
    // Downloads change with no word to this list, and asking costs no network.
    refetchOnMount: downloaded ? 'always' : undefined,
  });

  // The stars, from the same `['starred']` entry every heart in the app reads.
  //  This section holds the query rather than the set (`useFavoriteIds` hands
  //  the set over straight away, which is all a row needs): pulling the
  //  favourites list down asks that same request again, and a set built here
  //  is rebuilt only when the entry behind it is invalidated.
  const starredQ = useStarredList(favorited);
  const starredArtists = useMemo(
    () => starredQ.data && new Set((starredQ.data.artists ?? []).map((a) => a.id)),
    [starredQ.data],
  );

  // Pulling the list down asks again for what the rows are drawn from: with the
  //  heart on, that is two requests — the names and the stars — and the pull
  //  only looks honest if it re-asks both.
  const pull = usePullRefresh(
    favorited ? () => Promise.all([refetch(), starredQ.refetch()]) : refetch,
    "Couldn't refresh the artists",
  );

  // The filter bar sits above the toolbar, outside the scroll: both stay put
  // while the list moves under them, so neither can live inside it.
  const listRef = useRef<GHFlatList<Artist>>(null);
  const [searching, setSearching] = useState(false);

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
   * "Most played" is deduced from your most played albums: Subsonic doesn't
   * order artists by play count, and local counters go by song id without
   * metadata, so they can't be grouped by artist. It's the same workaround
   * that `getMostPlayedSongs` already does for songs. Only fetched when
   * choosing this order.
   */
  const { data: frequentAlbums } = useQuery({
    queryKey: [downloaded ? 'downloadedAlbumList' : 'albumList', 'frequent', FREQUENT_POOL],
    queryFn: () => (downloaded ? Local.getAlbumList : getAlbumList)('frequent', FREQUENT_POOL),
    enabled: canFetch && sort === 'frequent',
  });

  // "Recently added" is deduced the same way: Subsonic doesn't give artist
  // creation date, so they're sorted by how recent their newest album is
  // (getAlbumList 'newest'). Approximate, but it's the only signal available.
  const { data: newestAlbums } = useQuery({
    queryKey: [downloaded ? 'downloadedAlbumList' : 'albumList', 'newest', FREQUENT_POOL],
    queryFn: () => (downloaded ? Local.getAlbumList : getAlbumList)('newest', FREQUENT_POOL),
    enabled: canFetch && sort === 'newest',
  });

  // Scores by how high their best album is in that list. Those not appearing
  // stay at 0 and fall to alphabetical order.
  const scoreByBestAlbum = (albums: Album[] | undefined) => {
    const m = new Map<string, number>();
    (albums ?? []).forEach((al, i) => {
      const id = al.artistId;
      if (!id) return;
      const score = FREQUENT_POOL - i;
      if ((m.get(id) ?? 0) < score) m.set(id, score);
    });
    return m;
  };
  const playedByArtist = useMemo(() => scoreByBestAlbum(frequentAlbums), [frequentAlbums]);
  const addedByArtist = useMemo(() => scoreByBestAlbum(newestAlbums), [newestAlbums]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = favorited ? (data ?? []).filter((a) => starredArtists?.has(a.id)) : (data ?? []);
    return q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all;
  }, [data, query, favorited, starredArtists]);

  // Shuffled in its own memo, NOT depending on times/byArtist: the history
  // records every song that starts, so with music playing those deps change
  // every track and the Fisher-Yates would re-execute — the grid would
  // reshuffle itself in front of the user on every song change.
  const shuffledArtists = useMemo(() => {
    if (sort !== 'random') return null;
    const arr = filtered.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [filtered, sort]);

  const artists = useMemo(() => {
    if (sort === 'random') return shuffledArtists ?? [];
    const all = filtered.slice();
    // By what the artist is filed under, "The Knife" with the K (#275).
    const byName = byArtistSortName;
    if (sort === 'alpha') return all.sort(byName);
    const score =
      sort === 'frequent'
        ? (a: Artist) => playedByArtist.get(a.id) ?? 0
        : sort === 'newest'
          ? (a: Artist) => addedByArtist.get(a.id) ?? 0
          : (a: Artist) => Math.max(times[`/artist/${a.id}`] ?? 0, byArtist.get(a.id) ?? 0);
    // Tie-break → alphabetical, so the many artists with no plays or counted
    // albums don't get an arbitrary order.
    return all.sort((a, b) => score(b) - score(a) || byName(a, b));
  }, [filtered, sort, shuffledArtists, times, byArtist, playedByArtist, addedByArtist]);

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
          <Text style={styles.title}>{t('Artists')}</Text>
          {/* Takes the same width as the back chevron so the title stays
              centered; there used to be an empty slot of the same width here. */}
          <View style={styles.headerAction}>{viewButton}</View>
        </View>
      )}

      {/* Always there on its own screen: filtering is what you come to it for.
          In the tab the magnifier asks for it (see `useSearchBox`). */}
      {showSearch ? (
        <View style={styles.searchRow}>
          <SearchBox
            style={{ flex: 1 }}
            placeholder={t('Filter artists')}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearching(true)}
            autoFocus={embedded}
          />
          {/* Only on its own screen: in the tab the X in the header is the way
              out of the bar. */}
          {searching && !embedded ? (
            <Pressable hitSlop={8} accessibilityRole="button" onPress={clearSearch}>
              <Text style={styles.searchCancel}>{t('Cancel')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* The row's right-hand corner is the two filters this list answers to:
          pressing either holds it to what is on the phone or to what carries a
          star, and both together ask both questions of one list. The ↓ is the
          tab's, the heart this section's. There is no play here at all:
          starting "every artist" is not a thing that means. */}
      <BrowseToolbar
        options={SORTS}
        value={sort}
        onChange={setSort}
        download={onToggleDownloaded ? { on: !!downloaded, toggle: onToggleDownloaded } : undefined}
        favorite={onToggleFavorite ? { on: !!favorited, toggle: onToggleFavorite } : undefined}
      />

      {isLoading || (favorited && !starredArtists) ? (
        grid ? (
          <ArtistGridSkeleton width={card} />
        ) : (
          <ArtistListSkeleton />
        )
      ) : isError ? (
        <Message text={t("Couldn't load artists.")} onRetry={() => refetch()} />
      ) : (
        <GHFlatList
        {...listPerf}
          ref={listRef}
          data={artists}
          // A pull asks again for what the rows are drawn from (see `usePullRefresh`).
          refreshControl={
            <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />
          }
          // Remount the list when changing sort or view, or when the heart or the
          //  Downloaded filter swap the set the rows are drawn from: FlatList keeps
          //  its own measurements otherwise, and numColumns cannot be hot-swapped.
          //  The filter belongs here rather than to the section's own key up in the
          //  tab, which is where what you typed in the box would go with it.
          key={`${downloaded}-${favorited}-${sort}-${layout}-${columns}`}
          keyExtractor={(item) => item.id}
          {...(grid
            ? { numColumns: columns, columnWrapperStyle: { gap: GAP }, contentContainerStyle: [styles.list, { paddingBottom: bottomPad }] }
            : { contentContainerStyle: [styles.rowList, { paddingBottom: bottomPad }] })}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }: { item: Artist }) =>
            grid ? <ArtistCard artist={item} width={card} /> : <ArtistRow artist={item} />
          }
          ListEmptyComponent={
            query.trim() ? (
              <EmptyState
                icon="search-outline"
                title={t('No results')}
                subtitle={t('No results for “{q}”', { q: query.trim() })}
              />
            ) : favorited && downloaded ? (
              <EmptyState
                icon="heart-outline"
                title={t('No downloaded favorites')}
                subtitle={t('Artists you favorited and downloaded will show up here.')}
              />
            ) : favorited ? (
              <EmptyState
                icon="heart-outline"
                title={t('No favorite artists')}
                subtitle={t('Favorite artists to see them here.')}
              />
            ) : downloaded ? (
              <EmptyState icon="download-outline" title={t('Nothing here is downloaded')} />
            ) : (
              <EmptyState
                icon="people-outline"
                title={t('No artists yet')}
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
  headerAction: { width: 26, alignItems: 'flex-end' },

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
