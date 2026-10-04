/**
 * Full artist discography, as a vertical list or a grid of covers. With
 * `?section=appears-on` it lists the albums the artist only appears on
 * instead — same screen, same layout preference, only the other row's albums.
 */
import Icon from '@/components/Icon';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COVER, getAppearsOn, getArtist, type Album } from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { splitArtistAlbums } from '@/lib/artistAlbums';
import {
  RELEASE_GROUP_TITLE,
  RELEASE_GROUPS,
  releaseGroupOf,
} from '@/lib/releaseGroups';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING, themed, useTheme, tracking } from '@/theme';
import { BackChevron } from '@/components/BackChevron';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useAlbumSort } from '@/hooks/useAlbumSort';
import { useGridColumns } from '@/hooks/useGridColumns';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';

// Same measurements as browsing albums: both are full-screen album grids and
// cards of different sizes between them would look like an accident. That is
// why they start at the same density and each keeps its own after that (#109).
const GAP = spacing.sm;

/** Card width at a given density (#109). */
function cardWidth(columns: number): number {
  return (Dimensions.get('window').width - spacing.lg * 2 - GAP * (columns - 1)) / columns;
}

export default function DiscographyScreen() {
  const { coverArtUrl } = useCoverUrls();
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  // Rows stop growing at a reading measure and centre themselves (#131).
  const listPad = useListPadding(spacing.lg);
  const { id, section, group } = useLocalSearchParams<{
    id: string;
    section?: string;
    group?: string;
  }>();
  const guestsOnly = section === 'appears-on';
  /** Which shelf of the artist screen this came from, when it came from one. */
  const only = RELEASE_GROUPS.find((g) => g === group);
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  // Its own preference, not the one from browsing albums: the button on one
  // screen shouldn't silently rearrange the other.
  const layout = useSettings((s) => s.discographyLayout);
  const setLayout = useSettings((s) => s.setDiscographyLayout);
  const grid = layout === 'grid';
  // Rows or cards, and how many across, in one menu (#109).
  const { columns, openGridMenu, gridSheet } = useGridColumns('discography', {
    value: layout,
    set: setLayout,
  });
  const card = cardWidth(columns);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id),
    enabled: canFetch && !!id,
  });
  const name = data?.artist.name;

  // Same query (and cache entry) the artist screen already filled, so arriving
  // from its "Show all" costs nothing. It's needed for the discography too:
  // the split is what keeps collaborations out of it, and without waiting for
  // it this list wouldn't hold the same albums as the row it came from.
  const {
    data: appearsOn,
    isLoading: loadingGuests,
    isError: guestsError,
    refetch: refetchGuests,
  } = useQuery({
    queryKey: ['appearsOn', id],
    queryFn: () => getAppearsOn(id, name!),
    enabled: canFetch && !!id && !!name,
  });

  const split = useMemo(
    () => splitArtistAlbums(data?.albums ?? [], appearsOn ?? []),
    [data?.albums, appearsOn],
  );
  // Kept to the kind of record the row that opened this was showing, so "Show
  // all" on the EPs answers with the EPs.
  const listed = useMemo<Album[]>(() => {
    const own = only ? split.own.filter((a) => releaseGroupOf(a) === only) : split.own;
    return guestsOnly ? split.guest : own;
  }, [split, only, guestsOnly]);
  // One preference for all of these lists rather than one per shelf: they are
  // the same screen with a different filter, and asking again for the EPs what
  // was already answered for the albums is asking twice (#147).
  const { albums, openSort, sortSheet } = useAlbumSort(listed, 'discography');
  /** What this list is, under the artist's name. */
  const what = guestsOnly
    ? t('Appears on')
    : only
      ? t(RELEASE_GROUP_TITLE[only])
      : t('Discography');
  const loading = isLoading || loadingGuests;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <BackChevron label={t('Close')} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {data?.artist.name ?? what}
          </Text>
          {/* With the artist's name up there, which of the two lists this is
              would otherwise only be told by the albums themselves. */}
          {data ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {what}
            </Text>
          ) : null}
        </View>
        {/* Beside the one that changes the view, since both are about how this
            same list is laid out. Nothing to order with a single album. */}
        {albums.length > 1 ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Sort')}
            onPress={openSort}
          >
            <Icon name="swap-vertical" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('View')}
          onPress={openGridMenu}
        >
          <Icon name={grid ? 'grid-outline' : 'list'} size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError || !data || guestsError ? (
        <Message
          text={t("Couldn't load the artist.")}
          onRetry={() => {
            void refetch();
            void refetchGuests();
          }}
        />
      ) : (
        <FlatList
          {...listPerf}
          data={albums}
          // Remount on layout change: FlatList reuses rows and gets stuck with
          // stale ones, and `numColumns` can't be hot-swapped either.
          key={`${layout}-${columns}`}
          keyExtractor={(item) => item.id}
          {...(grid
            ? {
                numColumns: columns,
                columnWrapperStyle: { gap: GAP },
                contentContainerStyle: [styles.gridList, { paddingBottom: bottomPad }],
              }
            : {
                contentContainerStyle: [
                  styles.list,
                  { paddingBottom: bottomPad, paddingHorizontal: listPad },
                ],
              })}
          renderItem={({ item }: { item: Album }) =>
            grid ? (
              <AlbumCard album={item} width={card} />
            ) : (
              <Link href={`/album/${item.id}`} asChild>
                <Pressable style={styles.row}>
                  <Cover uri={coverArtUrl(item.coverArt ?? item.id, COVER.thumb)} size={56} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.year ? <Text style={styles.rowSub}>{item.year}</Text> : null}
                  </View>
                </Pressable>
              </Link>
            )
          }
        />
      )}
      {gridSheet}
      {sortSheet}
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
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '500' },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.md,
  },
  gridList: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: GAP,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
}));
