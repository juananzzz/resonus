/** Inicio estilo Spotify: accesos rápidos + carruseles de álbumes. */
import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
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

import {
  coverArtUrl,
  getAlbumList,
  getPlaylists,
  type Album,
} from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { FavoritesArt } from '@/components/FavoritesArt';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, radius, spacing } from '@/theme';

const TILE_W = (Dimensions.get('window').width - spacing.lg * 2 - spacing.sm) / 2;

function QuickTile({
  href,
  name,
  cover,
  favorites,
}: {
  href: string;
  name: string;
  cover?: string;
  favorites?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.tile}>
        {favorites ? (
          <FavoritesArt size={52} />
        ) : (
          <Cover uri={cover} size={52} />
        )}
        <Text style={styles.tileText} numberOfLines={2}>
          {name}
        </Text>
      </Pressable>
    </Link>
  );
}

function QuickGrid() {
  const auth = useAuthStore((s) => s.auth);
  const { data } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(auth!),
    enabled: !!auth,
  });
  const playlists = (data ?? []).slice(0, 5);

  return (
    <View style={styles.grid}>
      <QuickTile href="/favorites" name="Favoritos" favorites />
      {playlists.map((p) => (
        <QuickTile
          key={p.id}
          href={`/playlist/${p.id}`}
          name={p.name}
          cover={coverArtUrl(auth!, p.coverArt ?? p.id, 100)}
        />
      ))}
    </View>
  );
}

function AlbumSection({
  title,
  type,
}: {
  title: string;
  type: 'recent' | 'newest' | 'frequent';
}) {
  const auth = useAuthStore((s) => s.auth);
  const { data, isLoading } = useQuery({
    queryKey: ['albumList', type],
    queryFn: () => getAlbumList(auth!, type),
    enabled: !!auth,
  });

  if (isLoading) {
    return <ActivityIndicator style={styles.rowLoader} color={colors.accent} />;
  }
  if (!data || data.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList
        horizontal
        data={data}
        keyExtractor={(item: Album) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item }) => <AlbumCard album={item} />}
      />
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const initial = (auth?.username ?? '?').charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.greeting}>Tu música</Text>
          <Pressable style={styles.avatar} onPress={() => router.push('/settings')}>
            <Text style={styles.avatarText}>{initial}</Text>
          </Pressable>
        </View>

        <QuickGrid />

        <AlbumSection title="Reproducido recientemente" type="recent" />
        <AlbumSection title="Añadido recientemente" type="newest" />
        <AlbumSection title="Más escuchados" type="frequent" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.md, paddingBottom: 140 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  greeting: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  tile: {
    width: TILE_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    overflow: 'hidden',
    paddingRight: spacing.sm,
  },
  tileText: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  rowContent: { paddingHorizontal: spacing.lg, gap: spacing.md },
  rowLoader: { marginVertical: spacing.xl },
});
