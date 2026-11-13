/**
 * Server genre list, in colored cards.
 *
 * A screen of its own and, `embedded`, the Genres section of the Explore tab.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Text,
  View,
} from 'react-native';

import { type Genre } from '@/api/backend';
import { getGenres } from '@/api/data';
import { EmptyState } from '@/components/EmptyState';
import { GenreCard } from '@/components/GenreCard';
import { GenreGridSkeleton } from '@/components/GenreGridSkeleton';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import {
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
import { SearchBox } from '@/components/SearchBox';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { columnsFor, useScreenSize } from '@/hooks/useScreenSize';

/**
 * How wide a genre card wants to be, in dp. The same measure Search uses, so
 * the two grids match, and it is what decides how many go across: two on a
 * phone, more on anything wider, and re-worked out on a turn (#131).
 */
const GENRE_IDEAL = 220;

export default function GenresScreen() {
  return <GenresBrowser />;
}

export function GenresBrowser({ embedded, searchOpen }: BrowserProps) {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const columns = columnsFor(width, GENRE_IDEAL, 2, 5);
  // The cards themselves stretch to fill their column; this is for the
  // skeleton, which has to come out the same size as what it stands in for.
  const cardW = (width - spacing.lg * 2 - spacing.sm * (columns - 1)) / columns;
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const [query, setQuery] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['genres'],
    queryFn: () => getGenres(),
    enabled: !!auth,
  });

  // Embedded, whether the box is there is the tab's answer.
  const showSearch = useSearchBox(embedded, searchOpen, () => setQuery(''));

  const genres = useMemo(() => {
    const all = [...(data ?? [])].sort((a, b) => a.value.localeCompare(b.value));
    const q = query.trim().toLowerCase();
    return q ? all.filter((g) => g.value.toLowerCase().includes(q)) : all;
  }, [data, query]);

  // Stable, with the cards memoised: a new one per render redrew every card.
  const renderGenre = useCallback(
    ({ item }: { item: Genre }) => <GenreCard name={item.value} albumCount={item.albumCount} />,
    [],
  );

  return (
    <BrowseFrame embedded={embedded}>
      {embedded ? null : (
        <View style={styles.header}>
          <BackChevron />
          <Text style={styles.title}>{t('Genres')}</Text>
          <View style={{ width: 26 }} />
        </View>
      )}

      {showSearch ? (
        /* The box "Your library" has, to the same measurements, which is what every
            section of Explore now opens. */
        <SearchBox
          style={{ marginHorizontal: spacing.lg, marginBottom: spacing.md }}
          placeholder={t('Filter genres')}
          value={query}
          onChangeText={setQuery}
          autoFocus={embedded}
        />
      ) : (
        // The gap the box was giving the grid; without it the first row of
        // cards sits against the chips above.
        <View style={styles.searchGap} />
      )}

      {isLoading ? (
        <View style={styles.skeleton}>
          <GenreGridSkeleton width={cardW} />
        </View>
      ) : isError ? (
        <Message text={t("Couldn't load genres.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
        {...listPerf}
          // With the filter box open, a tap opens the row instead of only closing the keyboard.
          keyboardShouldPersistTaps="handled"
          data={genres}
          keyExtractor={(item) => item.value}
          key={columns}
          numColumns={columns}
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          renderItem={renderGenre}
          ListEmptyComponent={
            <EmptyState
              icon="pricetags-outline"
              title={t('No genres yet')}
              subtitle={t("Genres come from your music's tags.")}
            />
          }
        />
      )}
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
  // The box "Your library" has, to the same measurements, which is what every
  // section of Explore now opens.
  searchGap: { height: spacing.sm },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.sm,
  },
  // Same horizontal margin as the list so the skeleton cards align with the
  // real ones when they arrive.
  skeleton: { paddingHorizontal: spacing.lg },
}));
