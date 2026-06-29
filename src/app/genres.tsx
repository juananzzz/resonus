/** Lista de géneros del servidor, en tarjetas de color (estilo Spotify). */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getGenres, type Genre } from '@/api/subsonic';
import { EmptyState } from '@/components/EmptyState';
import { GenreCard } from '@/components/GenreCard';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { listPerf } from '@/lib/listPerf';

export default function GenresScreen() {
  const router = useRouter();
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const [query, setQuery] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['genres'],
    queryFn: () => getGenres(auth!),
    enabled: !!auth,
  });

  const genres = useMemo(() => {
    const all = [...(data ?? [])].sort((a, b) => a.value.localeCompare(b.value));
    const q = query.trim().toLowerCase();
    return q ? all.filter((g) => g.value.toLowerCase().includes(q)) : all;
  }, [data, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()} accessibilityLabel={t('Back')}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('Genres')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder={t('Filter genres')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
        {query.length > 0 ? (
          <Pressable hitSlop={10} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError ? (
        <Message text={t("Couldn't load genres.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
        {...listPerf}
          data={genres}
          keyExtractor={(item) => item.value}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: Genre }) => <GenreCard name={item.value} />}
          ListEmptyComponent={<EmptyState icon="pricetags-outline" title={t('No genres.')} />}
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: spacing.sm },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.sm,
  },
});
