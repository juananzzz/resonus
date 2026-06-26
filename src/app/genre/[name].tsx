/** Álbumes de un género. */
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

import { getAlbumsByGenre } from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

const GAP = spacing.md;
const CARD_W = (Dimensions.get('window').width - spacing.lg * 2 - GAP) / 2;

export default function GenreScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const genre = decodeURIComponent(name ?? '');

  const { data, isLoading } = useQuery({
    queryKey: ['genre', genre],
    queryFn: () => getAlbumsByGenre(auth!, genre),
    enabled: !!auth && !!genre,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {genre}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={{ marginBottom: GAP }}>
              <AlbumCard album={item} width={CARD_W} />
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No hay álbumes de este género.</Text>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  title: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 140 },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
