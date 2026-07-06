/** Álbumes de un género, con scroll infinito. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAlbumsByGenre } from '@/api/backend';
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

export default function GenreScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const genre = decodeURIComponent(name ?? '');
  const router = useRouter();
  const t = useT();
  const auth = useAuthStore((s) => s.auth);

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['genreAlbums', genre],
      queryFn: ({ pageParam }) => getAlbumsByGenre(auth!, genre, PAGE, pageParam),
      initialPageParam: 0,
      getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
      enabled: !!auth && !!genre,
    });

  const albums = data?.pages.flat() ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()} accessibilityLabel={t('Back')}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{genre}</Text>
        <View style={{ width: 26 }} />
      </View>

      {isLoading ? (
        <AlbumCardsSkeleton width={CARD} count={8} />
      ) : isError ? (
        <Message text={t("Couldn't load albums.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
        {...listPerf}
          data={albums}
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
            <EmptyState
              icon="disc-outline"
              title={t('No albums in this genre')}
              subtitle={t('Try exploring another genre.')}
            />
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
  title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING, gap: GAP },
});
