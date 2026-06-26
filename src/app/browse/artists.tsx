/** Explorar todos los artistas del servidor, con filtro rápido. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
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

import { coverArtUrl, getArtists } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { Message } from '@/components/Message';
import { albumsLabel, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

export default function BrowseArtistsScreen() {
  const router = useRouter();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const auth = useAuthStore((s) => s.auth);
  const [query, setQuery] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['allArtists'],
    queryFn: () => getArtists(auth!),
    enabled: !!auth,
  });

  const artists = useMemo(() => {
    const all = data ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all;
  }, [data, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()} accessibilityLabel={t('Atrás')}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('Artistas')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder={t('Filtrar artistas')}
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
        <Message text={t('No se pudieron cargar los artistas.')} onRetry={() => refetch()} />
      ) : (
        <FlatList
          data={artists}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Link href={`/artist/${item.id}`} asChild>
              <Pressable style={styles.row}>
                <Cover uri={coverArtUrl(auth!, item.coverArt ?? item.id, 100)} size={52} rounded />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.rowSub}>{albumsLabel(item.albumCount ?? 0, lang)}</Text>
                </View>
              </Pressable>
            </Link>
          )}
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
    gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
});
