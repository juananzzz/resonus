/** Detalle de un artista: su carátula y la cuadrícula de álbumes. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
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

import { coverArtUrl, getArtist } from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

const GAP = spacing.md;
const CARD_WIDTH = (Dimensions.get('window').width - spacing.lg * 2 - GAP) / 2;

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);

  const { data, isLoading } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(auth!, id),
    enabled: !!auth && !!id,
  });

  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Pressable style={styles.back} hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </Pressable>

      <FlatList
        data={data.albums}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Cover
              uri={coverArtUrl(auth!, data.artist.coverArt ?? data.artist.id, 400)}
              size={160}
              rounded
            />
            <Text style={styles.name}>{data.artist.name}</Text>
            <View style={styles.headerRow}>
              <Text style={styles.count}>
                {data.albums.length} álbum{data.albums.length === 1 ? '' : 'es'}
              </Text>
              <FavoriteButton
                id={data.artist.id}
                type="artist"
                starred={!!data.artist.starred}
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ marginBottom: GAP }}>
            <AlbumCard album={item} width={CARD_WIDTH} />
          </View>
        )}
      />
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
  list: { paddingHorizontal: spacing.lg, paddingBottom: 140 },
  header: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
  name: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  count: { color: colors.textSecondary, fontSize: fontSize.md },
});
