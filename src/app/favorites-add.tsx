/**
 * "Add to favorites" (Spotify's "Add to Liked Songs" style): tabs of
 * candidates (recent from history, suggestions based on similarity to existing
 * favorites, and random from the library) + a search bar at the bottom. Each
 * row has a ⊕ to favorite the song instantly (and ✓ to undo).
 */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMostPlayedSongs, getSimilarSongs, getStarred, search, star, unstar, COVER } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { usePlayHistory } from '@/store/playHistory';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { useCoverUrls } from '@/hooks/useCoverUrls';

type Tab = 'most' | 'recent' | 'suggested';

export default function FavoritesAddScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const queryClient = useQueryClient();
  const offline = useAuthStore((s) => s.offline);
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const toast = useToast((s) => s.show);
  const history = usePlayHistory((s) => s.entries);

  const [tab, setTab] = useState<Tab>('most');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // Favorited from this screen: the row stays with ✓ (tapping undoes).
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: starred } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });

  // Snapshot of favorites ON ENTRY: rows don't disappear when favorited
  // (like Spotify), only what was already a favorite before is excluded.
  const initialFavIds = useRef<Set<string> | null>(null);
  if (starred && !initialFavIds.current) {
    initialFavIds.current = new Set(starred.songs.map((s) => s.id));
  }
  const excluded = initialFavIds.current;

  const { data: mostPlayed, isLoading: loadingMost } = useQuery({
    queryKey: ['favAddMost'],
    queryFn: () => getMostPlayedSongs(50),
    enabled: tab === 'most',
    staleTime: Infinity,
  });

  const { data: suggested, isLoading: loadingSuggested } = useQuery({
    queryKey: ['favAddSuggested'],
    queryFn: async () => {
      // Seeds: up to 3 random favorites; their similar songs, shuffled.
      const seeds = [...(starred?.songs ?? [])].sort(() => Math.random() - 0.5).slice(0, 3);
      const lists = await Promise.all(seeds.map((s) => getSimilarSongs(s.id, 20).catch(() => [])));
      const seen = new Set<string>();
      return lists
        .flat()
        .filter((s) => !seen.has(s.id) && (seen.add(s.id), true))
        .sort(() => Math.random() - 0.5);
    },
    enabled: tab === 'suggested' && !offline && (starred?.songs.length ?? 0) > 0,
    staleTime: Infinity,
  });

  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['favAddSearch', debouncedQuery],
    queryFn: () => search(debouncedQuery).then((r) => r.songs),
    enabled: debouncedQuery.length > 0,
  });

  const loading =
    debouncedQuery.length > 0
      ? searching && !searchResults
      : (tab === 'most' && loadingMost) || (tab === 'suggested' && loadingSuggested);

  const base =
    debouncedQuery.length > 0
      ? (searchResults ?? [])
      : tab === 'most'
        ? (mostPlayed ?? [])
        : tab === 'recent'
          ? history.map((e) => e.song)
          : (suggested ?? []);
  // No prior favorites (or radios, which can't be starred on the server).
  const songs = base.filter((s) => !s.url && !(excluded?.has(s.id) && !added.has(s.id)));

  async function toggle(song: Song) {
    const wasAdded = added.has(song.id);
    setAdded((prev) => {
      const next = new Set(prev);
      if (wasAdded) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
    try {
      if (wasAdded) await unstar(song.id);
      else await star(song.id);
      queryClient.invalidateQueries({ queryKey: ['starred'] });
    } catch {
      // Revert the optimistic mark if the server fails.
      setAdded((prev) => {
        const next = new Set(prev);
        if (wasAdded) next.add(song.id);
        else next.delete(song.id);
        return next;
      });
      toast(t("Couldn't complete the action"));
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'most', label: t('Most played') },
    { key: 'recent', label: t('Recently played') },
    ...(!offline ? [{ key: 'suggested' as Tab, label: t('Suggestions') }] : []),
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          onPress={() => router.back()}
        >
          <Icon name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {t('Add to favorites')}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Icon name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('What would you like to add?')}
            placeholderTextColor={colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('Clear')}
              onPress={() => setQuery('')}
            >
              <Icon name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {debouncedQuery.length === 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          style={styles.tabsWrap}
        >
          {tabs.map(({ key, label }) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            {...listPerf}
            data={songs}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            // The list is now the last thing on the screen (the search bar lives
            // above): let its end clear the navigation bar.
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.lg }]}
            renderItem={({ item }) => (
              <AddRow song={item} added={added.has(item.id)} onToggle={() => void toggle(item)} />
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {debouncedQuery.length > 0
                  ? t('No results for “{q}”', { q: debouncedQuery })
                  : t('Nothing to suggest yet — play some music first.')}
              </Text>
            }
          />
        )}

      </View>
    </View>
  );
}

/** Candidate row: cover, title/artist and ⊕ (or ✓ if already marked). */
function AddRow({
  song,
  added,
  onToggle,
}: {
  song: Song;
  added: boolean;
  onToggle: () => void;
}) {
  const { songCoverUrl } = useCoverUrls();
  const t = useT();
  return (
    <View style={styles.row}>
      <Cover uri={songCoverUrl(song, COVER.thumb)} size={44} />
      <View style={styles.info}>
        <Text style={styles.songTitle} numberOfLines={1}>
          {song.title}
        </Text>
        {song.artist ? (
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist}
          </Text>
        ) : null}
      </View>
      <Pressable
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={added ? t('Removed from favorites') : t('Add to favorites')}
        onPress={onToggle}
      >
        <Icon
          name={added ? 'checkmark-circle' : 'add-circle-outline'}
          size={28}
          color={added ? colors.accent : colors.textSecondary}
        />
      </Pressable>
    </View>
  );
}

const styles = themed((colors) => ({
  root: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 48,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
    textAlign: 'center',
  },
  tabsWrap: { flexGrow: 0 },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tab: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  tabLabel: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
  tabLabelActive: { color: colors.onAccent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  info: { flex: 1 },
  songTitle: { color: colors.text, fontSize: fontSize.md },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  empty: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 46,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.sm, paddingVertical: 0 },
}));
