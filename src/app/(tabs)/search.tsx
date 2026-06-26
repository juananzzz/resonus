/** Búsqueda de álbumes y canciones en el servidor. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl, search } from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { TrackRow } from '@/components/TrackRow';
import { useDebounce } from '@/hooks/useDebounce';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useRecentSearches } from '@/store/recentSearches';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

export default function SearchScreen() {
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const debouncedQuery = useDebounce(query.trim(), 350);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const recent = useRecentSearches((s) => s.terms);
  const addRecent = useRecentSearches((s) => s.add);
  const removeRecent = useRecentSearches((s) => s.remove);
  const clearRecent = useRecentSearches((s) => s.clear);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => search(auth!, debouncedQuery),
    enabled: !!auth && debouncedQuery.length > 1,
  });

  const showRecent = focused && query.trim().length === 0 && recent.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder={t('Canciones, álbumes, artistas')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => addRecent(query)}
        />
        {query.length > 0 ? (
          <Pressable hitSlop={10} accessibilityLabel={t('Borrar')} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {showRecent ? (
          <View style={styles.section}>
            <View style={styles.recentHeader}>
              <Text style={styles.sectionTitle}>{t('Búsquedas recientes')}</Text>
              <Pressable hitSlop={8} onPress={() => clearRecent()}>
                <Text style={styles.clearAll}>{t('Borrar todo')}</Text>
              </Pressable>
            </View>
            <View>
              {recent.map((term) => (
                <Pressable key={term} style={styles.recentRow} onPress={() => setQuery(term)}>
                  <Ionicons name="time-outline" size={22} color={colors.textSecondary} />
                  <Text style={styles.recentText} numberOfLines={1}>
                    {term}
                  </Text>
                  <Pressable
                    hitSlop={10}
                    accessibilityLabel={t('Borrar')}
                    onPress={() => removeRecent(term)}
                  >
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {isFetching ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
        ) : null}

        {data && data.artists.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Artistas')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.albumRow}
            >
              {data.artists.map((artist) => (
                <Link key={artist.id} href={`/artist/${artist.id}`} asChild>
                  <Pressable style={styles.artist} onPress={() => addRecent(debouncedQuery)}>
                    <Cover
                      uri={coverArtUrl(auth!, artist.coverArt ?? artist.id, 200)}
                      size={110}
                      rounded
                    />
                    <Text style={styles.artistName} numberOfLines={1}>
                      {artist.name}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {data && data.albums.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Álbumes')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.albumRow}
            >
              {data.albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {data && data.songs.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Canciones')}</Text>
            {data.songs.map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                isCurrent={playing?.id === song.id}
                onPress={() => {
                  addRecent(debouncedQuery);
                  playQueue(data.songs, i);
                }}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    margin: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    paddingVertical: spacing.md,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clearAll: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  recentText: { flex: 1, color: colors.text, fontSize: fontSize.md },
  albumRow: {
    gap: spacing.md,
  },
  artist: {
    width: 110,
    alignItems: 'center',
    gap: spacing.xs,
  },
  artistName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
});
