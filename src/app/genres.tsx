/** Lista de géneros del servidor, en tarjetas de color (estilo Spotify). */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getGenres, type Genre } from '@/api/subsonic';
import { GenreCard } from '@/components/GenreCard';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { listPerf } from '@/lib/listPerf';

export default function GenresScreen() {
  const router = useRouter();
  const t = useT();
  const auth = useAuthStore((s) => s.auth);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['genres'],
    queryFn: () => getGenres(auth!),
    enabled: !!auth,
  });

  const genres = [...(data ?? [])].sort((a, b) => a.value.localeCompare(b.value));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()} accessibilityLabel={t('Atrás')}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('Géneros')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError ? (
        <Message text={t('No se pudieron cargar los géneros.')} onRetry={() => refetch()} />
      ) : (
        <FlatList
        {...listPerf}
          data={genres}
          keyExtractor={(item) => item.value}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: Genre }) => <GenreCard name={item.value} />}
          ListEmptyComponent={<Text style={styles.empty}>{t('No hay géneros.')}</Text>}
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
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.sm,
  },
  empty: { color: colors.textMuted, fontSize: fontSize.md, textAlign: 'center', marginTop: spacing.xl },
});
