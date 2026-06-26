/** Biblioteca: listas (con acceso fijo a Favoritos) y artistas. Ajustes. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  createPlaylist,
  getArtists,
  getPlaylists,
  getStarred,
  type Artist,
  type Playlist,
} from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { albumsLabel, songsLabel, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

type Segment = 'playlists' | 'albums' | 'artists';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'playlists', label: 'Listas' },
  { key: 'albums', label: 'Álbumes' },
  { key: 'artists', label: 'Artistas' },
];

function FavoritesEntry() {
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const { data } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(auth!),
    enabled: !!auth,
  });
  const count = data?.songs.length ?? 0;

  return (
    <Link href="/favorites" asChild>
      <Pressable style={styles.row}>
        <FavoritesArt size={56} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle}>{t('Favoritos')}</Text>
          <Text style={styles.rowSub}>{songsLabel(count, lang)}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

function PlaylistsTab() {
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(auth!),
    enabled: !!auth,
  });
  if (isLoading) return <Loader />;
  if (isError) return <Message text={t('No se pudieron cargar las listas.')} onRetry={() => refetch()} />;
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
      ListHeaderComponent={<FavoritesEntry />}
      renderItem={({ item }: { item: Playlist }) => (
        <Link href={`/playlist/${item.id}`} asChild>
          <Pressable style={styles.row}>
            <Cover uri={coverArtUrl(auth!, item.coverArt ?? item.id, 100)} size={56} />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.rowSub}>{songsLabel(item.songCount ?? 0, lang)}</Text>
            </View>
          </Pressable>
        </Link>
      )}
    />
  );
}

function ArtistsTab() {
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['artists'],
    queryFn: () => getArtists(auth!),
    enabled: !!auth,
  });
  if (isLoading) return <Loader />;
  if (isError) return <Message text={t('No se pudieron cargar los artistas.')} onRetry={() => refetch()} />;
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
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
                {albumsLabel(item.albumCount ?? 0, lang)}
              </Text>
            </View>
          </Pressable>
        </Link>
      )}
      ListEmptyComponent={<Empty text={t('No hay artistas.')} />}
    />
  );
}

function AlbumsTab() {
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(auth!),
    enabled: !!auth,
  });
  if (isLoading) return <Loader />;
  if (isError)
    return <Message text={t('No se pudieron cargar los álbumes.')} onRetry={() => refetch()} />;
  return (
    <FlatList
      data={data?.albums ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
      renderItem={({ item }) => (
        <Link href={`/album/${item.id}`} asChild>
          <Pressable style={styles.row}>
            <Cover uri={coverArtUrl(auth!, item.coverArt ?? item.id, 100)} size={56} />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              {item.artist ? (
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.artist}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Link>
      )}
      ListEmptyComponent={<Empty text={t('No hay álbumes guardados.')} />}
    />
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
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const [segment, setSegment] = useState<Segment>('playlists');
  const [creating, setCreating] = useState(false);

  async function onCreate(name: string) {
    setCreating(false);
    if (!auth) return;
    try {
      await createPlaylist(auth, name);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Lista creada'));
    } catch {
      toast(t('No se pudo crear la lista'));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('Biblioteca')}</Text>
        <View style={styles.headerActions}>
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('Nueva lista')}
            onPress={() => setCreating(true)}
          >
            <Ionicons name="add" size={28} color={colors.text} />
          </Pressable>
          <Pressable hitSlop={12} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <Dialog
        visible={creating}
        title={t('Nueva lista')}
        input={{ placeholder: t('Nombre de la lista') }}
        confirmLabel={t('Crear')}
        onCancel={() => setCreating(false)}
        onConfirm={onCreate}
      />

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
                {t(s.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        {segment === 'playlists' ? (
          <PlaylistsTab />
        ) : segment === 'albums' ? (
          <AlbumsTab />
        ) : (
          <ArtistsTab />
        )}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
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
    paddingBottom: SCREEN_BOTTOM_PADDING,
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
