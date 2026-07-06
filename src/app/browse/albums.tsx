/** Explorar todos los álbumes del servidor, con orden y scroll infinito. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAlbumList, type AlbumListType } from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { listPerf } from '@/lib/listPerf';

const PAGE = 30;
const COLUMNS = 2;
const GAP = spacing.sm;
const CARD = (Dimensions.get('window').width - spacing.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

const SORTS: { key: AlbumListType; label: string }[] = [
  { key: 'newest', label: 'Recent' },
  { key: 'alphabeticalByName', label: 'A-Z' },
  { key: 'alphabeticalByArtist', label: 'Artist' },
  { key: 'frequent', label: 'Most played' },
  { key: 'random', label: 'Shuffle' },
];

export default function BrowseAlbumsScreen() {
  const router = useRouter();
  const t = useT();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const [sort, setSort] = useState<AlbumListType>('newest');

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['browseAlbums', sort],
      queryFn: ({ pageParam }) => getAlbumList(sort, PAGE, pageParam),
      initialPageParam: 0,
      getNextPageParam: (last, pages) =>
        last.length === PAGE ? pages.length * PAGE : undefined,
      enabled: canFetch,
    });

  const albums = data?.pages.flat() ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()} accessibilityLabel={t('Back')}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('Albums')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipsRow}
      >
        {SORTS.map((s) => {
          const active = s.key === sort;
          return (
            <Pressable
              key={s.key}
              style={[styles.chip, active && { backgroundColor: colors.accent }]}
              onPress={() => setSort(s.key)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {t(s.label)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <AlbumCardsSkeleton width={CARD} count={8} />
      ) : isError ? (
        <Message text={t("Couldn't load albums.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
        {...listPerf}
          data={albums}
          key={sort}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <AlbumCard album={item} width={CARD} />}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
            ) : null
          }
          ListEmptyComponent={
            sort === 'frequent' ? (
              <EmptyState
                icon="play-outline"
                title={t('Nothing played yet')}
                subtitle={t('Your most played albums will show up here.')}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  chipsRow: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surfaceHighlight,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  chipTextActive: { color: '#000' },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: GAP,
  },
});
