/** Pantalla de Favoritos: canciones marcadas con estrella en Navidrome. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getStarred } from '@/api/subsonic';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { TrackRow } from '@/components/TrackRow';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing } from '@/theme';

export default function FavoritesScreen() {
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(auth!),
    enabled: !!auth,
  });

  const songs = data?.songs ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Pressable style={styles.back} hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </Pressable>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError ? (
        <Message text="No se pudieron cargar los favoritos." onRetry={() => refetch()} />
      ) : (
        <FlatList
          data={songs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isFetching}
              onRefresh={refetch}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <View style={styles.header}>
              <FavoritesArt size={200} />
              <Text style={styles.title}>Favoritos</Text>
              <Text style={styles.count}>
                {songs.length} canción{songs.length === 1 ? '' : 'es'}
              </Text>
              {songs.length > 0 ? (
                <Pressable style={styles.play} onPress={() => playQueue(songs, 0)}>
                  <Ionicons name="play" size={22} color="#000" />
                  <Text style={styles.playText}>Reproducir</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item, index }) => (
            <TrackRow
              song={item}
              isCurrent={playing?.id === item.id}
              onPress={() => playQueue(songs, index)}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Aún no tienes canciones favoritas.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  back: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 140 },
  header: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    marginTop: spacing.md,
  },
  count: { color: colors.textSecondary, fontSize: fontSize.md },
  play: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  playText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
