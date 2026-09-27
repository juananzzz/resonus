/** Library: lists (with fixed access to Favorites) and artists. Settings. */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  createPlaylist,
  getPlaylists,
  getStarred,
  type Album,
  type Playlist,
  COVER,
} from '@/api/data';
import { listChannels } from '@/api/podcasts';
import { AlbumRow } from '@/components/AlbumRow';
import { ArtistRow } from '@/components/ArtistRow';
import { Cover } from '@/components/Cover';
import { useHistoryTimes } from '@/hooks/useHistoryTimes';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { PodcastArt } from '@/components/PodcastArt';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { albumsLabel, episodesLabel, songsLabel, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useLastPlayed } from '@/store/lastPlayed';
import { useMediaMenu } from '@/store/mediaMenu';
import { usePins } from '@/store/pins';
import { SORT_LABELS, byCodepoint, matches, normQ, sortItems } from '@/lib/librarySort';
import { useSettings, type LibrarySort } from '@/store/settings';
import { useAccent } from '@/hooks/useAccent';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed, useTheme, tracking } from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { columnsFor, useListPadding, useScreenSize } from '@/hooks/useScreenSize';
import { listPerf } from '@/lib/listPerf';
import { bump } from '@/lib/perfLog';
import { haptic } from '@/lib/haptics';

// Folders used to be a fourth segment here. It browses the server's own
// directory tree, which is the catalogue rather than your own shelf, so it
// went to the Explore tab with the rest of it (`FoldersBrowser`).
type Segment = 'playlists' | 'albums' | 'artists';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'playlists', label: 'Playlists' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
];

/**
 * The second row of chips, the one that appears once Playlists is the chip
 * pressed.
 *
 * Not the ones Spotify has: there is no such thing as a collaborative playlist
 * here, and nothing made by the service either. A Subsonic server hands you the
 * ones you own plus the ones somebody else marked public, and owner and public
 * are the only two things it says about them, which is what these two are. They
 * are not a partition and are not meant to be one: a list of yours can be
 * public and belongs under both. "Public" is Navidrome's own word for the flag,
 * so it is the one used here.
 *
 * Each only appears when it divides the lists you have (see `ownerChips`): with
 * one account nothing is anybody else's, and if none of them is public there is
 * nothing to pick out.
 */
/**
 * How the two chips of a narrowed answer are welded together: the line you see
 * between them, and how far the second hides under the first. The overlap is
 * about the corner radius of a chip (half its height), which is what it takes
 * for the outline to come out as one pill.
 */
const JOIN_LINE = 1;
const JOIN_OVERLAP = 14;

/** And how much rounder than a chip the X beside them is drawn, which is what
 *  keeps it from reading as a chip with nothing written on it. */
const X_OVERSIZE = 2;

type Owner = 'mine' | 'public';

const OWNER_LABEL: Record<Owner, string> = { mine: 'Yours', public: 'Public' };

/** Yours, both for the server that says so and for the one that says nothing. */
function isMine(playlist: Playlist, username: string | undefined): boolean {
  return !playlist.owner || playlist.owner === username;
}

function keeps(playlist: Playlist, owner: Owner, username: string | undefined): boolean {
  return owner === 'mine' ? isMine(playlist, username) : !!playlist.public;
}

// Library grid: the same gap as the rest of the grids.
/**
 * How wide a library card wants to be, in dp.
 *
 * Three across a phone, which is what this grid has always been, and the same
 * measure decides the rest: a tablet gets more of them rather than three
 * covers the size of a record sleeve (#131).
 */
const CARD_IDEAL = 180;
const GRID_GAP = spacing.sm;
/** The grid as it is right now: worked out while rendering, so a turn
 *  re-lays it out instead of keeping the width the app started at. */
function useGridMetrics(): { columns: number; card: number } {
  const { width } = useScreenSize();
  const columns = columnsFor(width, CARD_IDEAL, 3, 6);
  return {
    columns,
    card: (width - spacing.lg * 2 - GRID_GAP * (columns - 1)) / columns,
  };
}

// In grid mode, the Favorites access goes as the first card of the grid
// (in list it's the header). This sentinel id marks it within the data.
const FAVORITES_ID = '__favorites__';
// And the Podcasts access right after it, the same way: a subscription is as
// much yours as a star is, and it is a thing you keep rather than something the
// server has.
const PODCASTS_ID = '__podcasts__';

/** "⇅ Recent" row under the segments; opens the sort sheet. */
function SortBar({ onPress }: { onPress: () => void }) {
  const t = useT();
  const sort = useSettings((s) => s.librarySort);
  return (
    <Pressable style={styles.sortBar} hitSlop={8} onPress={onPress}>
      <Icon name="swap-vertical" size={15} color={colors.textSecondary} />
      <Text style={styles.sortBarText}>{t(SORT_LABELS[sort])}</Text>
    </Pressable>
  );
}

function SortSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const sort = useSettings((s) => s.librarySort);
  const setSort = useSettings((s) => s.setLibrarySort);
  const { dismiss, pan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    visible,
    onClose,
  );
  const close = () => dismiss(onClose);
  if (!visible) return null;
  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      {/* Gestures inside an RN Modal need a root view of their own: the
          Modal renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        {/* One drag around the whole sheet: what's in here never scrolls,
            so nothing else competes for the gesture. */}
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
            onLayout={onSheetLayout}
          >
            {/* Spotify-style grabber: the visual cue that the sheet can be
                dragged down to dismiss. */}
            <View style={styles.grabber} />
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
                    <Icon name="checkmark" size={20} color={colors.accent} style={{ marginLeft: 'auto' }} />
                  ) : null}
                </Pressable>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Pinned first (in their pinned order), ignoring the chosen sort order. */
function withPins<T>(items: T[], key: (x: T) => string, pins: Record<string, number>): T[] {
  const pinned = items
    .filter((x) => pins[key(x)])
    .sort((a, b) => pins[key(a)] - pins[key(b)]);
  if (pinned.length === 0) return items;
  return [...pinned, ...items.filter((x) => !pins[key(x)])];
}

function FavoritesEntry({ grid }: { grid?: boolean }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const { data } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });
  const count = data?.songs.length ?? 0;
  const { card } = useGridMetrics();

  if (grid) {
    return (
      <GridCard
        href="/favorites"
        art={<FavoritesArt size={card} />}
        title={t('Favorites')}
        subtitle={songsLabel(count, lang)}
      />
    );
  }

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

function PodcastsEntry({ grid }: { grid?: boolean }) {
  const t = useT();
  const lang = useSettings((s) => s.language);
  // No `enabled` gate, unlike the rows above: the subscriptions are the phone's
  // own, so this answers with or without a server and offline included.
  const { data } = useQuery({
    queryKey: ['podcastChannels'],
    queryFn: () => listChannels(),
  });
  // Episodes across every show rather than shows: it is the episodes that are
  // stored on the phone, so that is the number that says whether the row is
  // worth opening.
  const count = (data ?? []).reduce((n, c) => n + (c.episodeCount ?? 0), 0);
  const { card } = useGridMetrics();

  if (grid) {
    return (
      <GridCard
        href="/podcasts"
        art={<PodcastArt size={card} />}
        title={t('Podcasts')}
        subtitle={episodesLabel(count, lang)}
      />
    );
  }

  return (
    <Link href="/podcasts" asChild>
      <Pressable style={styles.row}>
        <PodcastArt size={56} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle}>{t('Podcasts')}</Text>
          <Text style={[styles.rowSub, styles.rowSubGap]}>{episodesLabel(count, lang)}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

/** The two fixed rows above the list, in order. */
function LibraryEntries() {
  return (
    <>
      <FavoritesEntry />
      <PodcastsEntry />
    </>
  );
}

function PlaylistsTab({
  onNew,
  query,
  owner,
}: {
  onNew?: () => void;
  query: string;
  /** Set by the second row of chips; without it, all of them. */
  owner?: Owner | null;
}) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const username = useAuthStore((s) => s.auth?.username);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const sort = useSettings((s) => s.librarySort);
  const times = useLastPlayed((s) => s.times);
  const pins = usePins((s) => s.pins);
  const openMenu = useMediaMenu((s) => s.open);
  const grid = useSettings((s) => s.libraryLayout) === 'grid';
  const bottomPad = useScreenBottomPadding();
  // Rows stop growing at a reading measure and centre themselves (#131).
  const listPad = useListPadding(spacing.lg);
  const { columns } = useGridMetrics();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canFetch,
  });
  // Filtering and sorting are memoised, and the hook goes before the early
  // returns below because hooks cannot be conditional. Without this the whole
  // list was filtered and sorted again on every render of the tab, which
  // includes every keystroke in its search box (#50).
  const playlists = useMemo(
    () =>
      withPins(
        sortItems(
          (data ?? []).filter(
            (p) => matches(query, p.name) && (!owner || keeps(p, owner, username)),
          ),
          sort,
          (p) => p.name,
          sort === 'recent'
            ? (p) => times[`/playlist/${p.id}`] ?? 0
            : (p) => Date.parse(p.created ?? '') || 0,
          // Code point so "+"-prefixed playlists pin to the top like on the server.
          byCodepoint,
        ),
        (p) => `playlist:${p.id}`,
        pins,
      ),
    [data, query, owner, username, sort, times, pins],
  );
  if (isLoading) return <Loader />;
  if (isError) return <Message text={t("Couldn't load playlists.")} onRetry={() => refetch()} />;
  // In grid, Favorites and Podcasts go in as the first cards (sentinels); in
  // list they remain the full-width headers.
  const listData: Playlist[] = grid
    ? [{ id: FAVORITES_ID, name: '' }, { id: PODCASTS_ID, name: '' }, ...playlists]
    : playlists;
  return (
    <FlatList
      key={grid ? `grid-${columns}` : 'list'}
      {...listPerf}
      // With the filter box open, a tap opens the row instead of only closing the keyboard.
      keyboardShouldPersistTaps="handled"
      {...gridListProps(grid, bottomPad, columns, listPad)}
      data={listData}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
      ListHeaderComponent={grid ? undefined : <LibraryEntries />}
      ListEmptyComponent={
        query ? (
          <NoResults query={query} />
        ) : (
          <EmptyState
            icon="list-outline"
            title={t('No playlists yet')}
            subtitle={t('Create your first playlist to get started.')}
            action={onNew ? { label: t('New playlist'), onPress: onNew } : undefined}
          />
        )
      }
      renderItem={({ item }: { item: Playlist }) =>
        item.id === FAVORITES_ID ? (
          <FavoritesEntry grid />
        ) : item.id === PODCASTS_ID ? (
          <PodcastsEntry grid />
        ) : grid ? (
          <GridCard
            href={`/playlist/${item.id}`}
            uri={coverArtUrl(item.coverArt ?? item.id, COVER.card)}
            title={item.name}
            subtitle={songsLabel(item.songCount ?? 0, lang)}
            pinned={!!pins[`playlist:${item.id}`]}
            onLongPress={() => { haptic('light'); openMenu({ kind: 'playlist', playlist: item }); }}
          />
        ) : (
          <Link href={`/playlist/${item.id}`} asChild>
            <Pressable
              style={styles.row}
              onLongPress={() => { haptic('light'); openMenu({ kind: 'playlist', playlist: item }); }}
            >
              <Cover uri={coverArtUrl(item.coverArt ?? item.id, COVER.thumb)} size={56} />
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.rowSubLine}>
                  {pins[`playlist:${item.id}`] ? (
                    <Icon name="pin" size={13} color={colors.accent} />
                  ) : null}
                  <Text style={styles.rowSub}>{songsLabel(item.songCount ?? 0, lang)}</Text>
                </View>
              </View>
            </Pressable>
          </Link>
        )
      }
    />
  );
}

function ArtistsTab({ query }: { query: string }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const sort = useSettings((s) => s.librarySort);
  const times = useLastPlayed((s) => s.times);
  const { byArtist } = useHistoryTimes();
  const grid = useSettings((s) => s.libraryLayout) === 'grid';
  const bottomPad = useScreenBottomPadding();
  const { columns } = useGridMetrics();
  const listPad = useListPadding(spacing.lg);
  // Only favorite artists (what's browseable is in Home).
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });
  // See PlaylistsTab: memoised, and before the early returns.
  const artists = useMemo(
    () =>
      sortItems(
        (data?.artists ?? []).filter((a) => matches(query, a.name)),
        sort,
        (a) => a.name,
        sort === 'recent'
          ? (a) => Math.max(times[`/artist/${a.id}`] ?? 0, byArtist.get(a.id) ?? 0)
          : (a) => Date.parse(a.starred ?? '') || 0,
      ),
    [data, query, sort, times, byArtist],
  );
  if (isLoading) return <Loader />;
  if (isError) return <Message text={t("Couldn't load artists.")} onRetry={() => refetch()} />;
  return (
    <FlatList
      key={grid ? `grid-${columns}` : 'list'}
      {...listPerf}
      keyboardShouldPersistTaps="handled"
      {...gridListProps(grid, bottomPad, columns, listPad)}
      data={artists}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
      renderItem={({ item }) =>
        grid ? (
          <GridCard
            href={`/artist/${item.id}`}
            uri={coverArtUrl(item.coverArt ?? item.id, COVER.card)}
            rounded
            title={item.name}
            subtitle={albumsLabel(item.albumCount ?? 0, lang)}
          />
        ) : (
          <ArtistRow artist={item} />
        )
      }
      ListEmptyComponent={
        query ? (
          <NoResults query={query} />
        ) : (
          <EmptyState
            icon="people-outline"
            title={t('No favorite artists')}
            subtitle={t('Star artists to see them here.')}
          />
        )
      }
    />
  );
}

/** Nothing matched the filter (as opposed to "you have none yet"). */
function NoResults({ query }: { query: string }) {
  const t = useT();
  return (
    <EmptyState
      icon="search-outline"
      title={t('No results')}
      subtitle={t('No results for “{q}”', { q: query })}
    />
  );
}

function AlbumsTab({ query }: { query: string }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const sort = useSettings((s) => s.librarySort);
  const times = useLastPlayed((s) => s.times);
  const pins = usePins((s) => s.pins);
  const { byAlbum } = useHistoryTimes();
  const openMenu = useMediaMenu((s) => s.open);
  const grid = useSettings((s) => s.libraryLayout) === 'grid';
  const bottomPad = useScreenBottomPadding();
  const { columns } = useGridMetrics();
  const listPad = useListPadding(spacing.lg);
  // Only favorite albums (what's browseable is in Home).
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });
  // See PlaylistsTab: memoised, and before the early returns.
  const albums = useMemo(
    () =>
      withPins(
        sortItems(
          // Albums also match by artist: looking for "radiohead" in your
          // favourites should find their records, not just an album literally
          // called that.
          (data?.albums ?? []).filter((a) => matches(query, a.name, a.artist)),
          sort,
          (a) => a.name,
          sort === 'recent'
            ? (a) => Math.max(times[`/album/${a.id}`] ?? 0, byAlbum.get(a.id) ?? 0)
            : (a) => Date.parse(a.starred ?? '') || 0,
        ),
        (a) => `album:${a.id}`,
        pins,
      ),
    [data, query, sort, times, byAlbum, pins],
  );
  if (isLoading) return <Loader />;
  if (isError) return <Message text={t("Couldn't load albums.")} onRetry={() => refetch()} />;
  return (
    <FlatList
      key={grid ? `grid-${columns}` : 'list'}
      {...listPerf}
      keyboardShouldPersistTaps="handled"
      {...gridListProps(grid, bottomPad, columns, listPad)}
      data={albums}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
      }
      renderItem={({ item }) =>
        grid ? (
          <GridCard
            href={`/album/${item.id}`}
            uri={coverArtUrl(item.coverArt ?? item.id, COVER.card)}
            title={item.name}
            subtitle={item.artist}
            pinned={!!pins[`album:${item.id}`]}
            onLongPress={() => { haptic('light'); openMenu({ kind: 'album', album: item }); }}
          />
        ) : (
          <AlbumRow album={item} pinned={!!pins[`album:${item.id}`]} />
        )
      }
      ListEmptyComponent={
        query ? (
          <NoResults query={query} />
        ) : (
          <EmptyState
            icon="albums-outline"
            title={t('No favorite albums')}
            subtitle={t('Star albums to see them here.')}
          />
        )
      }
    />
  );
}

/**
 * One row of the tab with no chip pressed: a playlist, a favourite album or a
 * favourite artist, all in the same list.
 *
 * Flattened at merge time rather than kept as three arrays walked in step: the
 * sort is one sort over the lot of them, and the row only needs a name, a
 * cover, a line to write underneath and somewhere to go. What the long-press
 * menu takes is carried along, since that one does want the object it came
 * from.
 */
interface LibItem {
  kind: 'playlist' | 'album' | 'artist';
  id: string;
  name: string;
  coverArt?: string;
  /** Whose it is: the owner of a list, the artist of an album. */
  by?: string;
  href: string;
  /** The two scores the orders ask for, worked out once (see `sortItems`). */
  recent: number;
  added: number;
  playlist?: Playlist;
  album?: Album;
}

/**
 * Everything you have, which is what the tab opens on.
 *
 * The chips narrow it; none of them pressed is not a fourth kind of list, it
 * is the same rows before anybody asked for less. Each says what it is under
 * its name, because in one list a record and a playlist are the same square.
 */
function AllTab({ query, onNew }: { query: string; onNew?: () => void }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const sort = useSettings((s) => s.librarySort);
  const times = useLastPlayed((s) => s.times);
  const { byAlbum, byArtist } = useHistoryTimes();
  const pins = usePins((s) => s.pins);
  const openMenu = useMediaMenu((s) => s.open);
  const grid = useSettings((s) => s.libraryLayout) === 'grid';
  const bottomPad = useScreenBottomPadding();
  const { columns } = useGridMetrics();
  const listPad = useListPadding(spacing.lg);
  const lists = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canFetch,
  });
  const starred = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });

  const items = useMemo(() => {
    const all: LibItem[] = [
      ...(lists.data ?? []).map((p) => ({
        kind: 'playlist' as const,
        id: p.id,
        name: p.name,
        coverArt: p.coverArt,
        by: p.owner,
        href: `/playlist/${p.id}`,
        recent: times[`/playlist/${p.id}`] ?? 0,
        added: Date.parse(p.created ?? '') || 0,
        playlist: p,
      })),
      ...(starred.data?.albums ?? []).map((a) => ({
        kind: 'album' as const,
        id: a.id,
        name: a.name,
        coverArt: a.coverArt,
        by: a.artist,
        href: `/album/${a.id}`,
        recent: Math.max(times[`/album/${a.id}`] ?? 0, byAlbum.get(a.id) ?? 0),
        added: Date.parse(a.starred ?? '') || 0,
        album: a,
      })),
      ...(starred.data?.artists ?? []).map((a) => ({
        kind: 'artist' as const,
        id: a.id,
        name: a.name,
        coverArt: a.coverArt,
        href: `/artist/${a.id}`,
        recent: Math.max(times[`/artist/${a.id}`] ?? 0, byArtist.get(a.id) ?? 0),
        added: Date.parse(a.starred ?? '') || 0,
      })),
    ];
    return withPins(
      sortItems(
        // Albums match by artist too, as they do under their own chip.
        all.filter((i) => matches(query, i.name, i.kind === 'album' ? i.by : undefined)),
        sort,
        (i) => i.name,
        (i) => (sort === 'recent' ? i.recent : i.added),
      ),
      (i) => `${i.kind}:${i.id}`,
      pins,
    );
  }, [lists.data, starred.data, query, sort, times, byAlbum, byArtist, pins]);

  /** "Playlist · juan", "Album · Rojuu", "Artist". */
  const label = (i: LibItem): string => {
    const kind = i.kind === 'playlist' ? t('Playlist') : i.kind === 'album' ? t('Album') : t('Artist');
    return i.by ? `${kind} · ${i.by}` : kind;
  };

  const onLongPress = (i: LibItem) => {
    if (i.playlist) openMenu({ kind: 'playlist', playlist: i.playlist });
    else if (i.album) openMenu({ kind: 'album', album: i.album });
    else return;
    haptic('light');
  };

  const loading = lists.isLoading || starred.isLoading;
  const refresh = () => {
    lists.refetch();
    starred.refetch();
  };
  if (loading) return <Loader />;
  if (lists.isError && starred.isError) {
    return <Message text={t("Couldn't load your library.")} onRetry={refresh} />;
  }
  // In grid, Favorites and Podcasts go in as the first cards (sentinels); in
  // list they stay the full-width headers. The same arrangement the playlists
  // have.
  const data: LibItem[] = grid
    ? [
        { kind: 'playlist', id: FAVORITES_ID, name: '', href: '', recent: 0, added: 0 },
        { kind: 'playlist', id: PODCASTS_ID, name: '', href: '', recent: 0, added: 0 },
        ...items,
      ]
    : items;
  return (
    <FlatList
      key={grid ? `grid-${columns}` : 'list'}
      {...listPerf}
      keyboardShouldPersistTaps="handled"
      {...gridListProps(grid, bottomPad, columns, listPad)}
      data={data}
      keyExtractor={(item) => `${item.kind}:${item.id}`}
      refreshControl={
        <RefreshControl
          refreshing={lists.isFetching || starred.isFetching}
          onRefresh={refresh}
          tintColor={colors.accent}
        />
      }
      ListHeaderComponent={grid ? undefined : <LibraryEntries />}
      ListEmptyComponent={
        query ? (
          <NoResults query={query} />
        ) : (
          <EmptyState
            icon="library-outline"
            title={t('Nothing here yet')}
            subtitle={t('Your playlists and what you star show up here.')}
            action={onNew ? { label: t('New playlist'), onPress: onNew } : undefined}
          />
        )
      }
      renderItem={({ item }: { item: LibItem }) =>
        item.id === FAVORITES_ID ? (
          <FavoritesEntry grid />
        ) : item.id === PODCASTS_ID ? (
          <PodcastsEntry grid />
        ) : grid ? (
          <GridCard
            href={item.href}
            uri={coverArtUrl(item.coverArt ?? item.id, COVER.card)}
            rounded={item.kind === 'artist'}
            title={item.name}
            subtitle={label(item)}
            pinned={!!pins[`${item.kind}:${item.id}`]}
            onLongPress={() => onLongPress(item)}
          />
        ) : (
          <Link href={item.href} asChild>
            <Pressable style={styles.row} onLongPress={() => onLongPress(item)}>
              <Cover
                uri={coverArtUrl(item.coverArt ?? item.id, COVER.thumb)}
                size={56}
                rounded={item.kind === 'artist'}
              />
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.rowSubLine}>
                  {pins[`${item.kind}:${item.id}`] ? (
                    <Icon
                      name="pin"
                      size={13}
                      color={colors.accent}
                    />
                  ) : null}
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {label(item)}
                  </Text>
                </View>
              </View>
            </Pressable>
          </Link>
        )
      }
    />
  );
}

function Loader() {
  return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />;
}

/** Button to toggle list/grid; shows the current mode's icon. */
function LayoutToggle() {
  const t = useT();
  const layout = useSettings((s) => s.libraryLayout);
  const setLayout = useSettings((s) => s.setLibraryLayout);
  const grid = layout === 'grid';
  return (
    <Pressable
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={grid ? t('List view') : t('Grid view')}
      onPress={() => setLayout(grid ? 'list' : 'grid')}
    >
      <Icon name={grid ? 'list' : 'grid-outline'} size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

/** Grid card (album/list/artist and the Favorites access). */
function GridCard({
  href,
  uri,
  art,
  rounded,
  title,
  subtitle,
  pinned,
  onLongPress,
}: {
  href: string;
  uri?: string;
  /** Alternative cover (e.g. the Favorites tile). */
  art?: ReactNode;
  rounded?: boolean;
  title: string;
  subtitle?: string;
  pinned?: boolean;
  onLongPress?: () => void;
}) {
  const { card } = useGridMetrics();
  return (
    <Link href={href} asChild>
      <Pressable
        style={StyleSheet.flatten([styles.card, { width: card }, rounded && styles.cardCentered])}
        onLongPress={onLongPress}
      >
        {art ?? <Cover uri={uri} size={card} rounded={rounded} />}
        <Text style={[styles.cardTitle, rounded && styles.centerText]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <View style={styles.cardSubLine}>
            {pinned ? (
              <Icon name="pin" size={12} color={colors.accent} />
            ) : null}
            <Text style={styles.cardSub} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

/**
 * FlatList props by layout. Additionally `key={grid...}` must be passed
 * directly on each list to force remounting: FlatList doesn't support hot-
 * changing `numColumns` (and `key` can't go in a spread).
 */
function gridListProps(grid: boolean, bottomPad: number, columns: number, listPad: number) {
  return grid
    ? {
        numColumns: columns,
        columnWrapperStyle: { gap: GRID_GAP },
        contentContainerStyle: [styles.gridList, { paddingBottom: bottomPad }],
      }
    : {
        contentContainerStyle: [
          styles.list,
          { paddingBottom: bottomPad, paddingHorizontal: listPad },
        ],
      };
}

export default function LibraryScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  // Counted, to answer whether a tab you have visited keeps working
  // afterwards: they stay mounted once opened, and freezing them is
  // supposed to stop them rendering while they are not on screen. If this
  // climbs while you are somewhere else, it does not.
  bump('render · library');
  const t = useT();
  const accent = useAccent();
  useSettings((s) => s.appFont); // re-render when font changes
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  /**
   * Which chip is pressed, and none of them to start with: the tab opens on
   * everything you have, and a chip is what narrows it (`AllTab`). It used to
   * open on the playlists, which put your albums and your artists behind a tap
   * nobody had asked for; that is now a setting (#217).
   */
  const [segment, setSegment] = useState<Segment | null>(null);
  const showsPlaylists = useSettings((s) => s.libraryShowsPlaylists);
  /** And which playlists, once that chip is the one pressed. */
  const [owner, setOwner] = useState<Owner | null>(null);
  /**
   * How tall a chip with a word in it comes out, which is the diameter of the
   * X beside them. Measured rather than worked out: it is a line of text plus
   * padding, and the text grows with the system font size.
   */
  const [chipHeight, setChipHeight] = useState(0);
  // Rows are centred on a wide screen and a grid is not, so the header lines
  // up with whichever is underneath it.
  const listPad = useListPadding(spacing.lg);
  const headerPad = useSettings((s) => s.libraryLayout) === 'grid' ? spacing.lg : listPad;
  const [creating, setCreating] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  // Filter over what the Library already has in memory (your favourites and
  // your lists): no server round-trip, unlike browsing the whole collection.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filter = normQ(query.trim());

  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    setSearchOpen(false);
  }, []);

  // Leaving the screen puts the bar away: going to another tab, or opening one
  // of the results and coming back. The X was the only way out of it, which
  // meant a filter typed once stayed on the Library for the rest of the
  // session.
  useFocusEffect(useCallback(() => closeSearch, [closeSearch]));

  // And Back closes it before it leaves, the way Android expects. Only while
  // the bar is open, so the tab keeps its own behaviour the rest of the time.
  // With the keyboard up the system eats the first press to lower it and this
  // never sees it; that press is the keyboard's, not ours to take.
  useEffect(() => {
    if (!searchOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSearch();
      return true;
    });
    return () => sub.remove();
  }, [searchOpen, closeSearch]);

  function toggleSearch() {
    if (searchOpen) {
      closeSearch();
    } else {
      // The bar opens focused and typing, which is what tapping a magnifier
      // asks for. `autoFocus` on the input rather than a `focus()` from here:
      // the input mounts with the render this schedules, and Android decides
      // whether to raise the keyboard when the field is attached to the
      // window, which is later. Asking before that only moved the caret, and
      // the bar sat there needing a second tap to type in.
      setSearchOpen(true);
    }
  }

  function clearSegment() {
    setSegment(null);
    setOwner(null);
  }

  /**
   * A chip is only worth drawing where it leaves something out. On a server
   * with one account every list is yours, and "Yours" over all of them is a
   * question with one answer; the same goes for "Public" where none of them is,
   * or where all of them are.
   */
  const username = useAuthStore((s) => s.auth?.username);
  const { data: allPlaylists } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: !!auth || offline,
  });
  const ownerChips: Owner[] =
    segment !== 'playlists'
      ? []
      : (['mine', 'public'] as Owner[]).filter((key) => {
          const lists = allPlaylists ?? [];
          const kept = lists.filter((p) => keeps(p, key, username));
          return kept.length > 0 && kept.length < lists.length;
        });

  /** A chip that has stopped being worth drawing takes its filter with it. */
  const shownOwner = owner && ownerChips.includes(owner) ? owner : null;

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

  // The inset is read here rather than left to a `SafeAreaView`: that one pads
  // itself once its native view has been measured, and this tab is only
  // mounted the first time it is opened, so its first frame was drawn under
  // the status bar and jumped down right after. The context already holds the
  // inset by then, which makes the first frame the right one.
  const insets = useSafeAreaInsets();

  const segmentChipRow = (segment ? SEGMENTS.filter((s) => s.key === segment) : SEGMENTS).map(
    (s) => {
      const active = s.key === segment;
      return (
        <Pressable
          key={s.key}
          style={[
            styles.segment,
            active && { backgroundColor: accent },
            shownOwner ? styles.segmentJoinFirst : null,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          onPress={() => (active ? clearSegment() : setSegment(s.key))}
        >
          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{t(s.label)}</Text>
        </Pressable>
      );
    },
  );

  const ownerChipRow = ownerChips
    .filter((key) => !shownOwner || key === shownOwner)
    .map((key) => {
      const active = key === shownOwner;
      return (
        <Pressable
          key={key}
          style={[
            styles.segment,
            active && { backgroundColor: accent },
            active ? styles.segmentJoinSecond : null,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          onPress={() => setOwner(active ? null : key)}
        >
          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
            {t(OWNER_LABEL[key])}
          </Text>
        </Pressable>
      );
    });

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      {/* The screen's own chrome follows what it is over: with rows, it lines
          up with the centred column; with a grid, the grid fills the width and
          so does this (#131). */}
      <View style={[styles.header, { paddingHorizontal: headerPad }]}>
        <Text style={styles.heading}>{t('Your library')}</Text>
        <View style={styles.headerActions}>
          <OfflineIndicator />
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? t('Close') : t('Search')}
            onPress={toggleSearch}
          >
            <Icon
              name={searchOpen ? 'close' : 'search'}
              size={24}
              color={searchOpen ? colors.accent : colors.text}
            />
          </Pressable>
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('New playlist')}
            onPress={() => setCreating(true)}
          >
            <Icon name="add" size={28} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Its text survives closing it: coming back to the other segments finds
          the filter as you left it, which is the point of filtering the same
          word across lists, albums and artists. */}
      {searchOpen ? (
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Icon name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder={t('Search')}
              placeholderTextColor={colors.textMuted}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Clear')}
                onPress={() => setQuery('')}
              >
                <Icon name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <Dialog
        visible={creating}
        title={t('New playlist')}
        input={{ placeholder: t('Playlist name') }}
        confirmLabel={t('Create')}
        onCancel={() => setCreating(false)}
        onConfirm={onCreate}
      />

      {/* With a chip pressed the row is that chip and what narrows it further,
          behind an X that gives you the whole library back. The other two are
          not greyed out but gone: they are not narrower, they are elsewhere. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.segments}
        contentContainerStyle={[styles.segmentsContent, { paddingHorizontal: headerPad }]}
      >
        {segment ? (
          <Pressable
            style={[
              styles.segment,
              styles.segmentIcon,
              chipHeight ? { width: chipHeight + X_OVERSIZE, height: chipHeight + X_OVERSIZE } : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('Clear')}
            onPress={clearSegment}
          >
            <Icon name="close" size={18} color={colors.text} />
          </Pressable>
        ) : null}

        {/* Once one of the pair is picked the other goes and the two that are
            left become one pill: "playlists, yours" is one answer in two words,
            not two chips that happen to both be on. The second slides under the
            first by its own corner, so the join is one curve and the outline
            has no pinch in it.

            Written backwards and laid out backwards (`segmentGroupJoined`) so
            the first one is drawn last and its ring of background lands over
            the second: what paints over what is the order they are written in,
            and `zIndex` does not change it here. */}
        <View
          style={[styles.segmentGroup, shownOwner ? styles.segmentGroupJoined : null]}
          // Read while they are apart. Joined, the first one carries its ring
          // and the row is two points taller, which is not the chip's height
          // and would have the X grow every time you narrow the answer.
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (!shownOwner && h && h !== chipHeight) setChipHeight(h);
          }}
        >
          {shownOwner ? ownerChipRow : segmentChipRow}
          {shownOwner ? segmentChipRow : ownerChipRow}
        </View>

      </ScrollView>

      <View style={[styles.controls, { paddingHorizontal: headerPad }]}>
        <SortBar onPress={() => setSortOpen(true)} />
        <LayoutToggle />
      </View>
      <SortSheet visible={sortOpen} onClose={() => setSortOpen(false)} />

      <View style={{ flex: 1 }}>
        {segment === null && !showsPlaylists ? (
          <AllTab query={filter} onNew={() => setCreating(true)} />
        ) : segment === null || segment === 'playlists' ? (
          <PlaylistsTab onNew={() => setCreating(true)} query={filter} owner={shownOwner} />
        ) : segment === 'albums' ? (
          <AlbumsTab query={filter} />
        ) : (
          <ArtistsTab query={filter} />
        )}
      </View>
    </View>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  heading: { color: colors.text, fontSize: fontSize.xxl, letterSpacing: tracking.display, fontWeight: '400' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  segments: {
    flexGrow: 0,
    paddingBottom: spacing.md,
  },
  segmentsContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    // Centred, so the chips keep their own height instead of stretching to the
    // tallest thing in the row. Stretching made the X and the chips measure
    // each other: the X is drawn from the height read off them (`chipHeight`),
    // and every layout added its own two points to the answer.
    alignItems: 'center',
  },
  segment: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  // A circle, the height of the chips beside it (`chipHeight`): with padding of
  // its own it would be an oval, and an aspect ratio squares it the wrong way
  // round, taking the width it got from the icon and making the row that tall.
  segmentIcon: { paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  segmentGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  /**
   * Merged, the two are laid out backwards so the first one is drawn last and
   * its ring lands on top of the second. `zIndex` was the obvious way to say
   * that and does nothing here: what paints over what is the order they are
   * written in, and this is how you write them the other way round without
   * moving them.
   */
  segmentGroupJoined: { gap: 0, flexDirection: 'row-reverse' as const },
  /**
   * The pair, merged. The first is drawn over the second inside a ring of
   * background, and that ring is the curve you see between them: everywhere
   * else it is the page and invisible.
   *
   * All the way round, not only on the edge that shows: a border on one side
   * tapers to nothing where the corners turn, and the line came out thin at the
   * top and bottom of the join. And added around the chip rather than taken out
   * of its padding, because what has to match the second pill is the green, not
   * the box: taking it out left the first one two points shorter and the
   * silhouette of what should read as one pill had a step in it.
   */
  segmentJoinFirst: {
    borderWidth: JOIN_LINE,
    borderColor: colors.background,
    marginRight: -JOIN_OVERLAP,
  },
  // A corner's worth of it goes under the first, and that much is given back
  // as padding so the word does not end up against the join.
  segmentJoinSecond: { paddingLeft: spacing.md + JOIN_OVERLAP },
  segmentTextActive: { color: colors.onAccent },
  searchRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    backgroundColor: colors.surfaceHighlight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: 0 },
  list: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  gridList: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  card: { gap: spacing.xs },
  cardCentered: { alignItems: 'center' },
  cardTitle: { color: colors.text, fontSize: fontSize.xs, fontWeight: '500', marginTop: spacing.xs },
  centerText: { textAlign: 'center' },
  cardSub: { color: colors.textSecondary, fontSize: fontSize.xs },
  cardSubLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs },
  rowSubGap: { marginTop: 2 },
  // Subtitle with room for the pinned icon.
  rowSubLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  // The MCI pin comes vertical; rotated 45° it looks like Spotify's.
  // Control row: sort on the left ("⇅ Recent"), toggle list/grid on the right.
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  // Spotify-style sort row ("⇅ Recent") and its bottom sheet.
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sortBarText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '500' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    // Smaller than the old spacing.lg because the grabber below already brings
    // its own margin: together they add up to the same top gap as before.
    paddingTop: spacing.sm,
  },
  // Spotify's little handle. Its only job is to advertise the drag gesture, so
  // it stays discreet: it must read as an affordance, not as a control.
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  sheetRowText: { color: colors.text, fontSize: fontSize.md },
}));
