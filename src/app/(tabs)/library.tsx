/** Biblioteca: listas de reproducción del usuario y opción de cerrar sesión. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl, getPlaylists, type Playlist } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

function PlaylistRow({ playlist }: { playlist: Playlist }) {
  const auth = useAuthStore((s) => s.auth);
  const cover = coverArtUrl(auth!, playlist.coverArt ?? playlist.id, 100);
  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      <Pressable style={styles.row}>
        <Cover uri={cover} size={56} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {playlist.name}
          </Text>
          <Text style={styles.rowSub}>{playlist.songCount ?? 0} canciones</Text>
        </View>
      </Pressable>
    </Link>
  );
}

export default function LibraryScreen() {
  const auth = useAuthStore((s) => s.auth);
  const logout = useAuthStore((s) => s.logout);
  const { data, isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(auth!),
    enabled: !!auth,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Biblioteca</Text>
        <Pressable hitSlop={12} onPress={() => logout()}>
          <Ionicons name="log-out-outline" size={26} color={colors.textSecondary} />
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <PlaylistRow playlist={item} />}
          ListEmptyComponent={
            <Text style={styles.empty}>No hay listas de reproducción todavía.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  heading: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 140,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  rowSub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
