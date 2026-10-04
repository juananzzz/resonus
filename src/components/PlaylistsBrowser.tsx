/**
 * Every playlist on the server, as a section of the Explore tab.
 *
 * The same list is already the first segment of "Your library", and this is
 * deliberately a second way in rather than a move: a playlist you made is
 * yours and belongs over there, but a Subsonic server also hands back the ones
 * other people made public, and reaching those from the tab that holds the
 * catalogue is what this is for.
 *
 * The order and the rows-or-cards choice are its own settings, not the ones
 * "Your library" keeps. Sharing them would mean pressing the view button here
 * silently rearranged the list over there, which is the same reason browsing
 * all albums does not share its layout with the favourites.
 *
 * No pins. What is pinned is a thing you did to your own library, and this
 * side is the server's.
 */
import Icon from '@/components/Icon';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { COVER, getPlaylists, type Playlist } from '@/api/data';
import { BrowseToolbar } from '@/components/BrowseToolbar';
import { useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { PlaylistCard } from '@/components/PlaylistCard';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useGridColumns } from '@/hooks/useGridColumns';
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
import { colors, fontSize, radius, spacing, themed } from '@/theme';

/** The gap between cards, and what a card is left with once they are taken. */
const GAP = spacing.md;

function cardWidth(columns: number): number {
  return (Dimensions.get('window').width - spacing.lg * 2 - GAP * (columns - 1)) / columns;
}

/** The same three "Your library" offers, in its order. */
const SORTS: { key: LibrarySort; label: string }[] = (
  Object.keys(SORT_LABELS) as LibrarySort[]
).map((key) => ({ key, label: SORT_LABELS[key] }));

export function PlaylistsBrowser({ embedded, actionRef, searchOpen }: BrowserProps) {
  const { coverArtUrl } = useCoverUrls();
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

  // Assigned in an effect and not while rendering: the React compiler's lint
  // rule marks a ref written during render (see the Explore tab).
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

  // Memoised, and before the early returns below, because hooks cannot be
  // conditional. Without it the whole list is filtered and sorted again on
  // every render, which includes every keystroke in the box above (#50).
  const shown = useMemo(() => {
    const q = normQ(query.trim());
    return sortItems(
      (data ?? []).filter((p) => matches(q, p.name)),
      sort,
      (p) => p.name,
      sort === 'recent'
        ? (p) => times[`/playlist/${p.id}`] ?? 0
        : (p) => Date.parse(p.created ?? '') || 0,
      // Code point so "+"-prefixed playlists pin to the top like on the server.
      byCodepoint,
    );
  }, [data, query, sort, times]);

  const body = isLoading ? (
    <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
  ) : isError ? (
    <Message text={t("Couldn't load playlists.")} onRetry={() => refetch()} />
  ) : shown.length === 0 ? (
    <EmptyState icon="list-outline" title={query.trim() ? t('No results') : t('No playlists yet')} />
  ) : (
    <FlatList
      {...listPerf}
      // Remounts when the shape of the list changes: FlatList keeps its
      // measurements otherwise, and rows measured as cards scroll wrong.
      key={`${layout}-${columns}`}
      data={shown}
      keyExtractor={(item: Playlist) => item.id}
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
          <View style={styles.searchBar}>
            <Icon name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              placeholder={t('Find a playlist')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
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
        </View>
      ) : null}

      {/* No play pair: the list is playlists, and "play all of them" is not a
          thing anyone asked for. Same shape as browsing all artists. */}
      <BrowseToolbar options={SORTS} value={sort} onChange={setSort} />

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
  input: { flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: 0 },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  grid: { paddingHorizontal: spacing.lg, gap: GAP },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
}));
