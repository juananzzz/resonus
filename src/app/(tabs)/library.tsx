/** Biblioteca: listas, artistas y favoritos. Acceso a ajustes. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  getArtists,
  getPlaylists,
  getStarred,
  type Artist,
  type Playlist,
} from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { TrackRow } from '@/components/TrackRow';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, spacing } from '@/theme';

type Segment = 'playlists' | 'artists' | 'favorites';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'playlists', label: 'Listas' },
  { key: 'artists', label: 'Artistas' },
  { key: 'favorites', label: 'Favoritos' },
];

function PlaylistsTab() {
  const auth = useAuthStore((s) => s.auth);
  const { data, isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(auth!),
    enabled: !!auth,
  });
  if (isLoading) return <Loader />;
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }: { item: Playlist }) => (
        <Link href={`/playlist/${item.id}`} asChild>
          <Pressable style={styles.row}>
            <Cover uri={coverArtUrl(auth!, item.coverArt ?? item.id, 100)} size={56} />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.rowSub}>{item.songCount ?? 0} canciones</Text>
            </View>
          </Pressable>
        </Link>
      )}
      ListEmptyComponent={<Empty text="No hay listas de reproducción." />}
    />
  );
}

function ArtistsTab() {
  const auth = useAuthStore((s) => s.auth);
  const { data, isLoading } = useQuery({
    queryKey: ['artists'],
    queryFn: () => getArtists(auth!),
    enabled: !!auth,
  });
  if (isLoading) return <Loader />;
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }: { item: Artist }) => (
        <Link href={`/artist/${item.id}`} asChild>
          <Pressable style={styles.row}>
            <Cover
              uri={coverArtUrl(auth!, item.coverArt ?? item.id, 100)}
              size={56}
              rounded
            />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.rowSub}>
                {item.albumCount ?? 0} álbum{item.albumCount === 1 ? '' : 'es'}
              </Text>
            </View>
          </Pressable>
        </Link>
      )}
      ListEmptyComponent={<Empty text="No hay artistas." />}
    />
  );
}

function FavoritesTab() {
  const auth = useAuthStore((s) => s.auth);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const { data, isLoading } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(auth!),
    enabled: !!auth,
  });
  if (isLoading) return <Loader />;
  if (!data || data.songs.length === 0) {
    return <Empty text="Aún no tienes canciones favoritas." />;
  }
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {data.songs.map((song, i) => (
        <TrackRow
          key={song.id}
          song={song}
          isCurrent={playing?.id === song.id}
          onPress={() => playQueue(data.songs, i)}
        />
      ))}
    </ScrollView>
  );
}

function Loader() {
  return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />;
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

export default function LibraryScreen() {
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>('playlists');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Biblioteca</Text>
        <Pressable hitSlop={12} onPress={() => router.push('/settings')}>
          <Ionicons name="settings-outline" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.segments}>
        {SEGMENTS.map((s) => {
          const active = s.key === segment;
          return (
            <Pressable
              key={s.key}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setSegment(s.key)}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        {segment === 'playlists' ? <PlaylistsTab /> : null}
        {segment === 'artists' ? <ArtistsTab /> : null}
        {segment === 'favorites' ? <FavoritesTab /> : null}
      </View>
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  heading: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800' },
  segments: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  segment: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surfaceHighlight,
  },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  segmentTextActive: { color: '#000' },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 140,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
