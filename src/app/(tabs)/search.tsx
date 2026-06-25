/** Búsqueda de álbumes y canciones en el servidor. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { search } from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { TrackRow } from '@/components/TrackRow';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing } from '@/theme';

export default function SearchScreen() {
  const auth = useAuthStore((s) => s.auth);
  const [query, setQuery] = useState('');
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const { data, isFetching } = useQuery({
    queryKey: ['search', query],
    queryFn: () => search(auth!, query),
    enabled: !!auth && query.trim().length > 1,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Canciones, álbumes, artistas"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {isFetching ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
        ) : null}

        {data && data.albums.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Álbumes</Text>
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
            <Text style={styles.sectionTitle}>Canciones</Text>
            {data.songs.map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                isCurrent={playing?.id === song.id}
                onPress={() => playQueue(data.songs, i)}
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
    paddingBottom: 140,
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
  albumRow: {
    gap: spacing.md,
  },
});
