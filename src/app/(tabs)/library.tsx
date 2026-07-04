/** Biblioteca: listas (con acceso fijo a Favoritos) y artistas. Ajustes. */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  createPlaylist,
  getPlaylists,
  getStarred,
  type Playlist,
} from '@/api/data';
import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { albumsLabel, songsLabel, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useLastPlayed } from '@/store/lastPlayed';
import { useMediaMenu } from '@/store/mediaMenu';
import { usePins } from '@/store/pins';
import { usePlayHistory } from '@/store/playHistory';
import { useSettings, type LibrarySort } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { listPerf } from '@/lib/listPerf';

type Segment = 'playlists' | 'albums' | 'artists';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'playlists', label: 'Playlists' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
];

// ── Orden estilo Spotify (Recientes / Añadido recientemente / Alfabético) ──

const SORT_LABELS: Record<LibrarySort, string> = {
  recent: 'Recents',
  added: 'Recently added',
  alpha: 'Alphabetical',
};

/**
 * Ordena según el criterio elegido: alfabético por nombre, o por puntuación
 * descendente (timestamp de última escucha / de añadido) con desempate
 * alfabético — lo nunca escuchado queda al final, en A-Z.
 */
function sortItems<T>(
  items: T[],
  sort: LibrarySort,
  name: (x: T) => string,
  score: (x: T) => number,
): T[] {
  const arr = items.slice();
  const byName = (a: T, b: T) => name(a).localeCompare(name(b));
  if (sort === 'alpha') return arr.sort(byName);
  return arr.sort((a, b) => score(b) - score(a) || byName(a, b));
}

/** Fila "⇅ Recientes" bajo los segmentos; abre la hoja de orden. */
function SortBar({ onPress }: { onPress: () => void }) {
  const t = useT();
  const sort = useSettings((s) => s.librarySort);
  return (
    <Pressable style={styles.sortBar} hitSlop={8} onPress={onPress}>
      <Ionicons name="swap-vertical" size={15} color={colors.textSecondary} />
      <Text style={styles.sortBarText}>{t(SORT_LABELS[sort])}</Text>
    </Pressable>
  );
}

function SortSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const sort = useSettings((s) => s.librarySort);
  const setSort = useSettings((s) => s.setLibrarySort);
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(visible);
  const close = () => dismiss(onClose);
  if (!visible) return null;
  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
        onLayout={onSheetLayout}
      >
        <Text style={styles.sheetTitle}>{t('Sort by')}</Text>
        {(Object.keys(SORT_LABELS) as LibrarySort[]).map((key) => {
          const active = key === sort;
          return (
            <Pressable
              key={key}
              style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.6 }]}
              onPress={() => {
                setSort(key);
                close();
              }}
            >
              <Text style={[styles.sheetRowText, active && { color: colors.accent }]}>
                {t(SORT_LABELS[key])}
              </Text>
              {active ? (
                <Ionicons name="checkmark" size={20} color={colors.accent} style={{ marginLeft: 'auto' }} />
              ) : null}
            </Pressable>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

/** Anclados primero (en su orden de fijado), ignorando el orden elegido. */
function withPins<T>(items: T[], key: (x: T) => string, pins: Record<string, number>): T[] {
  const pinned = items
    .filter((x) => pins[key(x)])
    .sort((a, b) => pins[key(a)] - pins[key(b)]);
  if (pinned.length === 0) return items;
  return [...pinned, ...items.filter((x) => !pins[key(x)])];
}

/** Última escucha por álbum/artista según el historial de reproducción. */
function useHistoryTimes(): { byAlbum: Map<string, number>; byArtist: Map<string, number> } {
  const entries = usePlayHistory((s) => s.entries);
  return useMemo(() => {
    const byAlbum = new Map<string, number>();
    const byArtist = new Map<string, number>();
    for (const e of entries) {
      const { albumId, artistId } = e.song;
      if (albumId && (byAlbum.get(albumId) ?? 0) < e.playedAt) byAlbum.set(albumId, e.playedAt);
      if (artistId && (byArtist.get(artistId) ?? 0) < e.playedAt) byArtist.set(artistId, e.playedAt);
    }
    return { byAlbum, byArtist };
  }, [entries]);
}

function FavoritesEntry() {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const { data } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });
  const count = data?.songs.length ?? 0;

  return (
    <Link href="/favorites" asChild>
      <Pressable style={styles.row}>
        <FavoritesArt size={56} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle}>{t('Favorites')}</Text>
          <Text style={[styles.rowSub, styles.rowSubGap]}>{songsLabel(count, lang)}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

function PlaylistsTab({ onNew }: { onNew?: () => void }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const sort = useSettings((s) => s.librarySort);
  const times = useLastPlayed((s) => s.times);
  const pins = usePins((s) => s.pins);
  const openMenu = useMediaMenu((s) => s.open);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canFetch,
  });
  if (isLoading) return <Loader />;
  if (isError) return <Message text={t("Couldn't load playlists.")} onRetry={() => refetch()} />;
  const playlists = withPins(
    sortItems(
      data ?? [],
      sort,
      (p) => p.name,
      sort === 'recent'
        ? (p) => times[`/playlist/${p.id}`] ?? 0
        : (p) => Date.parse(p.created ?? '') || 0,
    ),
    (p) => `playlist:${p.id}`,
    pins,
  );
  return (
    <FlatList
        {...listPerf}
      data={playlists}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
      ListHeaderComponent={<FavoritesEntry />}
      ListEmptyComponent={
        <EmptyState
          icon="list-outline"
          title={t('No playlists yet')}
          subtitle={t('Create your first playlist to get started.')}
          action={onNew ? { label: t('New playlist'), onPress: onNew } : undefined}
        />
      }
      renderItem={({ item }: { item: Playlist }) => (
        <Link href={`/playlist/${item.id}`} asChild>
          <Pressable
            style={styles.row}
            onLongPress={() => openMenu({ kind: 'playlist', playlist: item })}
          >
            <Cover uri={coverArtUrl(item.coverArt ?? item.id, 100)} size={56} />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.rowSubLine}>
                {pins[`playlist:${item.id}`] ? (
                  <MaterialCommunityIcons name="pin" size={13} color={colors.accent} style={styles.pinIcon} />
                ) : null}
                <Text style={styles.rowSub}>{songsLabel(item.songCount ?? 0, lang)}</Text>
              </View>
            </View>
          </Pressable>
        </Link>
      )}
    />
  );
}

function ArtistsTab() {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const sort = useSettings((s) => s.librarySort);
  const times = useLastPlayed((s) => s.times);
  const { byArtist } = useHistoryTimes();
  // Solo artistas favoritos (lo explorable está en Inicio).
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });
  if (isLoading) return <Loader />;
  if (isError) return <Message text={t("Couldn't load artists.")} onRetry={() => refetch()} />;
  const artists = sortItems(
    data?.artists ?? [],
    sort,
    (a) => a.name,
    sort === 'recent'
      ? (a) => Math.max(times[`/artist/${a.id}`] ?? 0, byArtist.get(a.id) ?? 0)
      : (a) => Date.parse(a.starred ?? '') || 0,
  );
  return (
    <FlatList
        {...listPerf}
      data={artists}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
      renderItem={({ item }) => (
        <Link href={`/artist/${item.id}`} asChild>
          <Pressable style={styles.row}>
            <Cover uri={coverArtUrl(item.coverArt ?? item.id, 100)} size={56} rounded />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.rowSub, styles.rowSubGap]}>{albumsLabel(item.albumCount ?? 0, lang)}</Text>
            </View>
          </Pressable>
        </Link>
      )}
      ListEmptyComponent={
        <EmptyState
          icon="people-outline"
          title={t('No favorite artists')}
          subtitle={t('Star artists to see them here.')}
        />
      }
    />
  );
}

function AlbumsTab() {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const sort = useSettings((s) => s.librarySort);
  const times = useLastPlayed((s) => s.times);
  const pins = usePins((s) => s.pins);
  const { byAlbum } = useHistoryTimes();
  const openMenu = useMediaMenu((s) => s.open);
  // Solo álbumes favoritos (lo explorable está en Inicio).
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });
  if (isLoading) return <Loader />;
  if (isError) return <Message text={t("Couldn't load albums.")} onRetry={() => refetch()} />;
  const albums = withPins(
    sortItems(
      data?.albums ?? [],
      sort,
      (a) => a.name,
      sort === 'recent'
        ? (a) => Math.max(times[`/album/${a.id}`] ?? 0, byAlbum.get(a.id) ?? 0)
        : (a) => Date.parse(a.starred ?? '') || 0,
    ),
    (a) => `album:${a.id}`,
    pins,
  );
  return (
    <FlatList
        {...listPerf}
      data={albums}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
      renderItem={({ item }) => (
        <Link href={`/album/${item.id}`} asChild>
          <Pressable
            style={styles.row}
            onLongPress={() => openMenu({ kind: 'album', album: item })}
          >
            <Cover uri={coverArtUrl(item.coverArt ?? item.id, 100)} size={56} />
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              {item.artist || pins[`album:${item.id}`] ? (
                <View style={styles.rowSubLine}>
                  {pins[`album:${item.id}`] ? (
                    <MaterialCommunityIcons name="pin" size={13} color={colors.accent} style={styles.pinIcon} />
                  ) : null}
                  {item.artist ? (
                    <Text style={styles.rowSub} numberOfLines={1}>{item.artist}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </Pressable>
        </Link>
      )}
      ListEmptyComponent={
        <EmptyState
          icon="albums-outline"
          title={t('No favorite albums')}
          subtitle={t('Star albums to see them here.')}
        />
      }
    />
  );
}

function Loader() {
  return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />;
}

export default function LibraryScreen() {
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const [segment, setSegment] = useState<Segment>('playlists');
  const [creating, setCreating] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const visibleSegments = SEGMENTS;

  async function onCreate(name: string) {
    setCreating(false);
    if (!auth && !offline) return;
    try {
      await createPlaylist(name);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Playlist created'));
    } catch {
      toast(t("Couldn't create the playlist"));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('Library')}</Text>
        <View style={styles.headerActions}>
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('New playlist')}
            onPress={() => setCreating(true)}
          >
            <Ionicons name="add" size={28} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <Dialog
        visible={creating}
        title={t('New playlist')}
        input={{ placeholder: t('Playlist name') }}
        confirmLabel={t('Create')}
        onCancel={() => setCreating(false)}
        onConfirm={onCreate}
      />

      <View style={styles.segments}>
        {visibleSegments.map((s) => {
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

      <SortBar onPress={() => setSortOpen(true)} />
      <SortSheet visible={sortOpen} onClose={() => setSortOpen(false)} />

      <View style={{ flex: 1 }}>
        {segment === 'playlists' ? (
          <PlaylistsTab onNew={() => setCreating(true)} />
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
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs },
  rowSubGap: { marginTop: 2 },
  // Subtítulo con hueco para la chincheta de los anclados.
  rowSubLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  // La chincheta de MCI viene vertical; girada 45° queda como la de Spotify.
  pinIcon: { transform: [{ rotate: '45deg' }] },
  // Fila de orden estilo Spotify ("⇅ Recientes") y su hoja inferior.
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  sortBarText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  sheetRowText: { color: colors.text, fontSize: fontSize.md },
});
