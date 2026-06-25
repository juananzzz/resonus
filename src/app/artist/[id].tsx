/** Detalle de artista: populares, álbumes y artistas similares. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  getArtist,
  getSimilarArtists,
  getTopSongs,
} from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { FavoriteButton } from '@/components/FavoriteButton';
import { TrackRow } from '@/components/TrackRow';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, spacing } from '@/theme';

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const { data, isLoading } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(auth!, id),
    enabled: !!auth && !!id,
  });
  const name = data?.artist.name;

  const { data: topSongs } = useQuery({
    queryKey: ['topSongs', name],
    queryFn: () => getTopSongs(auth!, name!),
    enabled: !!auth && !!name,
  });

  const { data: similar } = useQuery({
    queryKey: ['similar', id],
    queryFn: () => getSimilarArtists(auth!, id),
    enabled: !!auth && !!id,
  });

  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const top = (topSongs ?? []).slice(0, 5);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Pressable style={styles.back} hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </Pressable>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Cover
            uri={coverArtUrl(auth!, data.artist.coverArt ?? data.artist.id, 400)}
            size={160}
            rounded
          />
          <Text style={styles.name}>{data.artist.name}</Text>
          <FavoriteButton
            id={data.artist.id}
            type="artist"
            starred={!!data.artist.starred}
          />
        </View>

        {top.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Populares</Text>
            {top.map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                position={i + 1}
                isCurrent={playing?.id === song.id}
                onPress={() => playQueue(top, i)}
              />
            ))}
          </View>
        ) : null}

        {data.albums.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Álbumes</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {data.albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {similar && similar.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Artistas similares</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {similar.map((a) => (
                <Link key={a.id} href={`/artist/${a.id}`} asChild>
                  <Pressable style={styles.similar}>
                    <Cover
                      uri={coverArtUrl(auth!, a.coverArt ?? a.id, 200)}
                      size={110}
                      rounded
                    />
                    <Text style={styles.similarName} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  back: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  content: { paddingBottom: 140 },
  header: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  name: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
  similar: { width: 110, alignItems: 'center', gap: spacing.xs },
  similarName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
});
