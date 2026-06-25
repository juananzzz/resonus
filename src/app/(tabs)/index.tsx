/** Inicio: carruseles de álbumes recientes, frecuentes y aleatorios. */
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAlbumList, type Album } from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

function AlbumRow({
  title,
  type,
}: {
  title: string;
  type: 'newest' | 'frequent' | 'random';
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
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Tu música</Text>
        <AlbumRow title="Añadidos recientemente" type="newest" />
        <AlbumRow title="Más escuchados" type="frequent" />
        <AlbumRow title="Descubre" type="random" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingVertical: spacing.lg,
    paddingBottom: 140,
  },
  heading: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  rowContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  rowLoader: {
    marginVertical: spacing.xl,
  },
});
