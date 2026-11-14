/**
 * Every playlist on the server, as a section of the Library tab.
 *
 * This is the whole list the server answers with: the ones you made, plus the
 * ones a Subsonic server hands back because other people left them public. A
 * playlist you made is yours, and the heart here keeps it the way the other
 * sections do; reaching the server's own is why this section is in the tab that
 * holds the catalogue rather than only with your things.
 *
 * The order and the rows-or-cards choice are the playlists' own settings, kept
 * separate from the other sections'. Sharing them would mean pressing the view
 * button in one section silently rearranging another, which is the same reason
 * browsing all albums does not share its layout with the favourites.
 *
 * No pins. What is pinned is a thing you did to your own library, and this
 * side is the server's.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import { COVER, coverArtUrl, getPlaylists, type Playlist } from '@/api/data';
import { BrowseToolbar } from '@/components/BrowseToolbar';
import { useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { SearchBox } from '@/components/SearchBox';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { PlaylistCard } from '@/components/PlaylistCard';
import { useDownloadedPlaylists } from '@/hooks/useDownloadedPlaylists';
import { useGridColumns } from '@/hooks/useGridColumns';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { usePlaylistStars } from '@/hooks/usePlaylistStars';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { songsLabel, useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { SORT_LABELS, byCodepoint, matches, normQ, sortItems } from '@/lib/librarySort';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { useLastPlayed } from '@/store/lastPlayed';
import { useMediaMenu } from '@/store/mediaMenu';
import { useSettings, type LibrarySort } from '@/store/settings';
import { colors, fontSize, spacing, themed } from '@/theme';

/** The gap between cards, and what a card is left with once they are taken. */
const GAP = spacing.md;

function cardWidth(columns: number): number {
  return (Dimensions.get('window').width - spacing.lg * 2 - GAP * (columns - 1)) / columns;
}

/** The orders a playlist list can be read in, in the order they are offered. */
const SORTS: { key: LibrarySort; label: string }[] = (
  Object.keys(SORT_LABELS) as LibrarySort[]
).map((key) => ({ key, label: SORT_LABELS[key] }));

/**
 * `downloaded` keeps the playlists with every song on the phone (#310).
 *
 * `favorited` keeps them to the ones carrying a star, which only exists where
 *  the server can say it: Navidrome keeps playlist stars out of the Subsonic
 *  answers, so the state is read back through its own API (see
 *  `usePlaylistStars`) and the tab draws no heart where that read is not
 *  available.
 *
 * `onToggleDownloaded` and `onToggleFavorite` are the presses the Library tab
 *  makes in this section's sort row; the heart's state is the section's own
 *  (saved per section), the Downloaded one is the tab's.
 */
export function PlaylistsBrowser({
  embedded,
  actionRef,
  searchOpen,
  downloaded,
  favorited,
  onToggleDownloaded,
  onToggleFavorite,
}:
  BrowserProps & {
    downloaded?: boolean;
    favorited?: boolean;
    onToggleDownloaded?: () => void;
    onToggleFavorite?: () => void;
  }) {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const listPad = useListPadding(spacing.lg);
  const bottomPad = useScreenBottomPadding();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const openMenu = useMediaMenu((s) => s.open);
  const times = useLastPlayed((s) => s.times);
  const [query, setQuery] = useState('');
  const sort = useSettings((s) => s.browsePlaylistsSort);
  const setSort = useSettings((s) => s.setBrowsePlaylistsSort);
  const layout = useSettings((s) => s.browsePlaylistsLayout);
  const setLayout = useSettings((s) => s.setBrowsePlaylistsLayout);
  const grid = layout === 'grid';
  // Rows or cards, and how many across, in the one menu the tab's button opens.
  const { columns, openGridMenu, gridSheet } = useGridColumns('browsePlaylists', {
    value: layout,
    set: setLayout,
  });
  const card = cardWidth(columns);
  const saved = useDownloadedPlaylists();
  // The playlist stars, and `undefined` where this server cannot answer for
  //  them: no heart is drawn there, so `favorited` never arrives true.
  const stars = usePlaylistStars();

  // Assigned in an effect and not while rendering: the React compiler's lint
  // rule marks a ref written during render (see the Library tab).
  useEffect(() => {
    if (actionRef) actionRef.current = openGridMenu;
  });

  // Embedded, whether the box is there is the tab's answer.
  const showSearch = useSearchBox(embedded, searchOpen, () => setQuery(''));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canFetch,
  });

  // Pulling the list down asks the server for its playlists again. The stars
  //  have their own read, and it is written through by the heart itself (see
  //  `usePlaylistStars`), so there is nothing else here to ask for.
  const pull = usePullRefresh(refetch, "Couldn't refresh the playlists");

  // Memoised, and before the early returns below, because hooks cannot be
  // conditional. Without it the whole list is filtered and sorted again on
  // every render, which includes every keystroke in the box above (#50).
  const shown = useMemo(() => {
    const q = normQ(query.trim());
    return sortItems(
      (data ?? []).filter(
        (p) =>
          matches(q, p.name) &&
          (!downloaded || !!saved?.has(p.id)) &&
          (!favorited || !!stars?.has(p.id)),
      ),
      sort,
      (p) => p.name,
      sort === 'recent'
        ? (p) => times[`/playlist/${p.id}`] ?? 0
        : (p) => Date.parse(p.created ?? '') || 0,
      // Code point so "+"-prefixed playlists pin to the top like on the server.
      byCodepoint,
    );
  }, [data, query, sort, times, downloaded, saved, favorited, stars]);

  const body =
    isLoading || (downloaded && !saved) || (favorited && !stars) ? (
      <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
    ) : isError ? (
      <Message text={t("Couldn't load playlists.")} onRetry={() => refetch()} />
    ) : shown.length === 0 ? (
      <EmptyState
        icon={
          favorited && !query.trim()
            ? 'heart-outline'
            : downloaded && !query.trim()
              ? 'download-outline'
              : 'list-outline'
        }
        title={
          query.trim()
            ? t('No results')
            : favorited
              ? t('No favorites yet')
              : downloaded
                ? t('Nothing here is downloaded')
                : t('No playlists yet')
        }
      />
    ) : (
    <FlatList
      {...listPerf}
      // Remounts when the shape of the list changes: FlatList keeps its
      //  measurements otherwise, and rows measured as cards scroll wrong. The
      //  heart is in here since it swaps the set behind the rows.
      key={`${favorited}-${layout}-${columns}`}
      data={shown}
      keyExtractor={(item: Playlist) => item.id}
      // A pull asks the server for its playlists again (see `usePullRefresh`).
      refreshControl={
        <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />
      }
      keyboardShouldPersistTaps="handled"
      {...(grid
        ? {
            numColumns: columns,
            columnWrapperStyle: { gap: GAP },
            contentContainerStyle: [
              styles.grid,
              { paddingBottom: bottomPad, paddingHorizontal: listPad },
            ],
          }
        : {
            contentContainerStyle: [
              styles.list,
              { paddingBottom: bottomPad, paddingHorizontal: listPad },
            ],
          })}
      renderItem={({ item }) =>
        grid ? (
          <PlaylistCard playlist={item} width={card} />
        ) : (
          <Link href={`/playlist/${item.id}`} asChild>
            <Pressable
              style={styles.row}
              onLongPress={() => {
                haptic('light');
                openMenu({ kind: 'playlist', playlist: item });
              }}
            >
              <Cover uri={coverArtUrl(item.coverArt ?? item.id, COVER.thumb)} size={48} />
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.songCount != null ? (
                  <Text style={styles.rowSub}>{songsLabel(item.songCount, lang)}</Text>
                ) : null}
              </View>
            </Pressable>
          </Link>
        )
      }
    />
  );

  return (
    <View style={styles.frame}>
      {showSearch ? (
        <View style={styles.searchRow}>
          <SearchBox
            style={{ flex: 1 }}
            placeholder={t('Find a playlist')}
            value={query}
            onChangeText={setQuery}
            autoFocus={embedded}
          />
        </View>
      ) : null}

      {/* The row's right-hand corner carries the two filters: the heart is this
          section's own (saved per section), the ↓ the tab's. No play pair here:
          the list is playlists, and "play all of them" is not a thing anyone
          asked for. */}
      <BrowseToolbar
        options={SORTS}
        value={sort}
        onChange={setSort}
        download={onToggleDownloaded ? { on: !!downloaded, toggle: onToggleDownloaded } : undefined}
        favorite={onToggleFavorite ? { on: !!favorited, toggle: onToggleFavorite } : undefined}
      />

      {body}
      {gridSheet}
    </View>
  );
}

const styles = themed((colors) => ({
  frame: { flex: 1 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    // The gap to the row below is part of this, not an outer margin, so the
    // list starts where the other sections' lists do.
    paddingBottom: spacing.md,
  },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  grid: { paddingHorizontal: spacing.lg, gap: GAP },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
}));
