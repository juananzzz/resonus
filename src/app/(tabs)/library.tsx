/** Library: lists (with fixed access to Favorites) and artists. Settings. */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router, useFocusEffect, useNavigation } from 'expo-router';
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
  type Artist,
  type Playlist,
  COVER,
} from '@/api/data';
import { AlbumRow } from '@/components/AlbumRow';
import { openArtistMenu } from '@/components/ArtistMenuSheet';
import { ArtistRow } from '@/components/ArtistRow';
import { PlaylistRow } from '@/components/PlaylistRow';
import { PodcastRow } from '@/components/PodcastRow';
import { Cover } from '@/components/Cover';
import { useHistoryTimes } from '@/hooks/useHistoryTimes';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { usePressFeedback } from '@/hooks/usePressFeedback';
import { albumsLabel, episodesLabel, songsLabel, useT } from '@/i18n';
import {
  episodeToSong,
  listFavoriteChannels,
  listFavoriteEpisodes,
  queueEpisode,
  type PodcastChannel,
  type PodcastEpisode,
} from '@/api/podcasts';
import { useSongMenu } from '@/store/songMenu';
import { openPodcastMenu } from '@/components/PodcastMenuSheet';
import { getDownloadShelf, useDownloads } from '@/store/downloads';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLastPlayed } from '@/store/lastPlayed';
import { useMediaMenu } from '@/store/mediaMenu';
import { usePins } from '@/store/pins';
import { SORT_LABELS, byCodepoint, byLibraryName, matches, normQ, sortItems } from '@/lib/librarySort';
import { isMine } from '@/lib/playlistEdits';
import { useSettings, type LibrarySort } from '@/store/settings';
import { useAccent } from '@/hooks/useAccent';
import { episodeUnavailable } from '@/hooks/useEpisodeUnavailable';
import { useToast } from '@/store/toast';
import { colors, DIM_OPACITY, fontSize, lineHeight, radius, restyled, SHEET_MAX_WIDTH, spacing, themed, useTheme, tracking } from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { columnsFor, useListPadding, useScreenSize } from '@/hooks/useScreenSize';
import { listPerf } from '@/lib/listPerf';
import { bump } from '@/lib/perfLog';
import { haptic } from '@/lib/haptics';

// Folders used to be a fourth segment here. It browses the server's own
// directory tree, which is the catalogue rather than your own shelf, so it
// went to the Explore tab with the rest of it (`FoldersBrowser`).
type Segment = 'playlists' | 'albums' | 'artists' | 'podcasts';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'playlists', label: 'Playlists' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'podcasts', label: 'Podcasts' },
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

/**
 * A pull that keeps what is on screen if it fails. `refreshing` is the pull's
 * own, so a background fetch doesn't draw the spinner.
 */
function usePullRefresh(...queries: { refetch: () => Promise<{ isError: boolean }> }[]) {
  const t = useT();
  const toast = useToast((s) => s.show);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    const results = await Promise.all(queries.map((q) => q.refetch()));
    setRefreshing(false);
    if (results.some((r) => r.isError)) toast(t("Couldn't refresh your library."));
  };
  return { refreshing, onRefresh };
}

/**
 * What the downloads say about a favourite album. Dimming and hiding are for a
 * server account offline; on the local profile everything is on the phone.
 */
function useAlbumAvailability() {
  const files = useDownloads((s) => s.files);
  const fileCount = useMemo(() => Object.keys(files).length, [files]);
  const offline = useAuthStore((s) => s.offline && !!s.auth);
  const { data: shelf } = useQuery({
    queryKey: ['downloadShelf', profileScopeId(), fileCount],
    queryFn: async () =>
      new Map((await getDownloadShelf()).albums.map((a) => [a.id, a.songCount ?? 0])),
    staleTime: Infinity,
  });
  return useMemo(
    () => ({
      downloaded: (a: Album) => (shelf?.get(a.id) ?? 0) >= (a.songCount || Infinity),
      unavailable: (a: Album) => offline && !!shelf && !shelf.has(a.id),
    }),
    [shelf, offline],
  );
}

/** The hearted shows and episodes, read again on focus: listening moves their order. */
function useFavoritePodcasts() {
  const channels = useQuery({
    queryKey: ['podcastFavoriteChannels'],
    queryFn: () => listFavoriteChannels(),
  });
  // A hearted single episode shows up too, even when its show is not favorited.
  const episodes = useQuery({
    queryKey: ['podcastFavoriteEpisodes'],
    queryFn: () => listFavoriteEpisodes(),
  });
  const refetchChannels = channels.refetch;
  const refetchEpisodes = episodes.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchChannels();
      void refetchEpisodes();
    }, [refetchChannels, refetchEpisodes]),
  );
  return { channels, episodes };
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
  const hideUnavailable = useSettings((s) => s.hideUnavailableOffline);
  const openMenu = useMediaMenu((s) => s.open);
  const grid = useSettings((s) => s.libraryLayout) === 'grid';
  const bottomPad = useScreenBottomPadding();
  // Rows stop growing at a reading measure and centre themselves (#131).
  const listPad = useListPadding(spacing.lg);
  const { columns } = useGridMetrics();
  const playlistsQ = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canFetch,
  });
  const { data, isLoading, isError, refetch } = playlistsQ;
  const pull = usePullRefresh(playlistsQ);
  // Filtering and sorting are memoised, and the hook goes before the early
  // returns below because hooks cannot be conditional. Without this the whole
  // list was filtered and sorted again on every render of the tab, which
  // includes every keystroke in its search box (#50).
  const playlists = useMemo(
    () =>
      withPins(
        sortItems(
          (data ?? []).filter(
            (p) =>
              matches(query, p.name) &&
              (!owner || keeps(p, owner, username)) &&
              !(hideUnavailable && p.availableOffline === false),
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
    [data, query, owner, username, sort, times, pins, hideUnavailable],
  );
  if (isLoading) return <Loader />;
  if (isError && !data) {
    return <Message text={t("Couldn't load playlists.")} onRetry={() => refetch()} />;
  }
  // In grid, Favorites goes in as the first card (sentinel); in list it
  // remains the full-width header. Not a playlist, so a filter leaves it out,
  // and with no rows it stays a header so the empty state still shows.
  const showFavorites = !query && !owner;
  const favoritesCard = grid && showFavorites && playlists.length > 0;
  const listData: Playlist[] = favoritesCard ? [{ id: FAVORITES_ID, name: '' }, ...playlists] : playlists;
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
        <RefreshControl {...pull} tintColor={colors.accent} />
      }
      ListHeaderComponent={showFavorites && !favoritesCard ? <FavoritesEntry /> : undefined}
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
        ) : grid ? (
          <GridCard
            href={`/playlist/${item.id}`}
            uri={coverArtUrl(item.coverArt ?? item.id, COVER.card)}
            title={item.name}
            subtitle={songsLabel(item.songCount ?? 0, lang)}
            pinned={!!pins[`playlist:${item.id}`]}
            dimmed={item.availableOffline === false}
            onLongPress={() => { haptic('light'); openMenu({ kind: 'playlist', playlist: item }); }}
          />
        ) : (
          <PlaylistRow
            playlist={item}
            sub={songsLabel(item.songCount ?? 0, lang)}
            pinned={!!pins[`playlist:${item.id}`]}
            dimmed={item.availableOffline === false}
          />
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
  const starredQ = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });
  const { data, isLoading, isError, refetch } = starredQ;
  const pull = usePullRefresh(starredQ);
  // See PlaylistsTab: memoised, and before the early returns.
  const artists = useMemo(
    () =>
      sortItems(
        (data?.artists ?? []).filter((a) => matches(query, a.name)),
        sort,
        (a) => a.sortName || a.name,
        sort === 'recent'
          ? (a) => Math.max(times[`/artist/${a.id}`] ?? 0, byArtist.get(a.id) ?? 0)
          : (a) => Date.parse(a.starred ?? '') || 0,
      ),
    [data, query, sort, times, byArtist],
  );
  if (isLoading) return <Loader />;
  if (isError && !data) {
    return <Message text={t("Couldn't load artists.")} onRetry={() => refetch()} />;
  }
  return (
    <FlatList
      key={grid ? `grid-${columns}` : 'list'}
      {...listPerf}
      keyboardShouldPersistTaps="handled"
      {...gridListProps(grid, bottomPad, columns, listPad)}
      data={artists}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl {...pull} tintColor={colors.accent} />
      }
      renderItem={({ item }) =>
        grid ? (
          <GridCard
            href={`/artist/${item.id}`}
            uri={coverArtUrl(item.coverArt ?? item.id, COVER.card)}
            rounded
            title={item.name}
            subtitle={albumsLabel(item.albumCount ?? 0, lang)}
            onLongPress={() => { haptic('light'); openArtistMenu(item); }}
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
            subtitle={t('Favorite artists to see them here.')}
          />
        )
      }
    />
  );
}

/**
 * Your subscriptions, which are the phone's own: unlike the other tabs nothing
 * here is gated on a server, so the tab works with no account and offline.
 */
function PodcastsTab({ query }: { query: string }) {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const sort = useSettings((s) => s.librarySort);
  const grid = useSettings((s) => s.libraryLayout) === 'grid';
  const bottomPad = useScreenBottomPadding();
  const { columns } = useGridMetrics();
  const listPad = useListPadding(spacing.lg);
  // Offline, an episode only plays from disk; with the hide setting its rows
  // are not even built (as `annotate` does for songs).
  const offline = useAuthStore((s) => s.offline);
  const files = useDownloads((s) => s.files);
  const hideUnavailable = useSettings((s) => s.hideUnavailableOffline);
  const toast = useToast((s) => s.show);
  const unavailable = (id: string) => episodeUnavailable(offline, files, id);
  const { channels: channelsQ, episodes: episodesQ } = useFavoritePodcasts();
  const pull = usePullRefresh(channelsQ, episodesQ);

  // One row per hearted thing: a favorited show, or a single favorited episode
  // (which then names the show it came from).
  type Row = {
    kind: 'channel' | 'episode';
    id: string;
    title: string;
    by?: string;
    coverArt?: string;
    href: string;
    recent: number;
    added: number;
    episodeCount?: number;
    error?: string;
    /** The objects the long-press menu and an episode's tap need. */
    channel: PodcastChannel;
    episode?: PodcastEpisode;
  };
  const rows = useMemo(() => {
    const all: Row[] = [
      ...(channelsQ.data ?? []).map((c) => ({
        kind: 'channel' as const,
        id: c.id,
        title: c.title,
        by: c.author,
        coverArt: c.imageUrl,
        href: `/podcast/${c.id}`,
        recent: c.listenedAt,
        added: c.favoritedAt,
        episodeCount: c.episodeCount,
        error: c.error,
        channel: c,
      })),
      ...(episodesQ.data ?? []).map((r) => ({
        kind: 'episode' as const,
        id: r.episode.id,
        title: r.episode.title,
        by: r.channel.title,
        coverArt: r.channel.imageUrl,
        href: `/podcast/${r.channel.id}`,
        recent: r.listenedAt,
        added: r.favoritedAt,
        episode: r.episode,
        channel: r.channel,
      })),
    ];
    const filtered = all.filter((r) => matches(query, r.title, r.by));
    // Hide mode, offline: an episode that is not on disk gets no row at all.
    const kept = hideUnavailable
      ? filtered.filter((r) => r.kind === 'channel' || !episodeUnavailable(offline, files, r.id))
      : filtered;
    return sortItems(
      kept,
      sort,
      (r) => r.title,
      sort === 'recent' ? (r) => r.recent : (r) => r.added,
    );
  }, [channelsQ.data, episodesQ.data, query, sort, offline, files, hideUnavailable]);

  if (channelsQ.isLoading || episodesQ.isLoading) return <Loader />;
  if (channelsQ.isError && episodesQ.isError && !channelsQ.data && !episodesQ.data) {
    return <Message text={t("Couldn't load your podcasts.")} onRetry={() => { channelsQ.refetch(); episodesQ.refetch(); }} />;
  }
  // Tapping an episode plays just that episode (like Home's shelf); long-press
  // opens its menu. A show taps to its screen and long-press opens the show's
  // menu — the same sheets the show's own screen and a song row open.
  const playEpisode = (r: Row) => {
    if (!r.episode || !r.channel) return;
    queueEpisode(r.episode, r.channel);
  };
  const openEpisodeMenu = (r: Row) => {
    if (!r.episode || !r.channel) return;
    useSongMenu.getState().open(episodeToSong(r.episode, r.channel));
  };
  const openShowMenu = (r: Row) => {
    if (r.channel) openPodcastMenu(r.channel);
  };
  return (
    <FlatList
      key={grid ? `grid-${columns}` : 'list'}
      {...listPerf}
      keyboardShouldPersistTaps="handled"
      {...gridListProps(grid, bottomPad, columns, listPad)}
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl {...pull} tintColor={colors.accent} />
      }
      renderItem={({ item }: { item: Row }) =>
        grid ? (
          item.kind === 'episode' ? (
            <GridCard
              href=""
              onPress={() => {
                if (unavailable(item.id)) toast(t('Not available offline'));
                else {
                  haptic('light');
                  playEpisode(item);
                }
              }}
              onLongPress={
                unavailable(item.id)
                  ? undefined
                  : () => {
                      haptic('light');
                      openEpisodeMenu(item);
                    }
              }
              dimmed={unavailable(item.id)}
              badge={!!files[item.id]}
              uri={coverArtUrl(item.coverArt, COVER.card)}
              title={item.title}
              subtitle={item.by}
            />
          ) : (
            <GridCard
              href={item.href}
              onLongPress={() => {
                haptic('light');
                openShowMenu(item);
              }}
              uri={coverArtUrl(item.coverArt, COVER.card)}
              title={item.title}
              subtitle={episodesLabel(item.episodeCount ?? 0, lang)}
            />
          )
        ) : (
          item.kind === 'episode' ? (
            <PodcastRow channel={item.channel} episode={item.episode} sub={item.by} />
          ) : (
            <PodcastRow
              channel={item.channel}
              sub={item.error ? t("Couldn't read this feed") : episodesLabel(item.episodeCount ?? 0, lang)}
            />
          )
        )
      }
      ListEmptyComponent={
        query ? (
          <NoResults query={query} />
        ) : (
          <EmptyState
            icon="headset-outline"
            title={t('No podcasts')}
            subtitle={t('Favorite a show to keep it here.')}
            action={{ label: t('Find a podcast'), onPress: () => router.push('/podcasts') }}
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
  const hideUnavailable = useSettings((s) => s.hideUnavailableOffline);
  const availability = useAlbumAvailability();
  const bottomPad = useScreenBottomPadding();
  const { columns } = useGridMetrics();
  const listPad = useListPadding(spacing.lg);
  // Only favorite albums (what's browseable is in Home).
  const starredQ = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });
  const { data, isLoading, isError, refetch } = starredQ;
  const pull = usePullRefresh(starredQ);
  // See PlaylistsTab: memoised, and before the early returns.
  const albums = useMemo(
    () =>
      withPins(
        sortItems(
          // Albums also match by artist: looking for "radiohead" in your
          // favourites should find their records, not just an album literally
          // called that.
          (data?.albums ?? []).filter(
            (a) =>
              matches(query, a.name, a.artist) &&
              !(hideUnavailable && availability.unavailable(a)),
          ),
          sort,
          (a) => a.name,
          sort === 'recent'
            ? (a) => Math.max(times[`/album/${a.id}`] ?? 0, byAlbum.get(a.id) ?? 0)
            : (a) => Date.parse(a.starred ?? '') || 0,
        ),
        (a) => `album:${a.id}`,
        pins,
      ),
    [data, query, sort, times, byAlbum, pins, hideUnavailable, availability],
  );
  if (isLoading) return <Loader />;
  if (isError && !data) {
    return <Message text={t("Couldn't load albums.")} onRetry={() => refetch()} />;
  }
  return (
    <FlatList
      key={grid ? `grid-${columns}` : 'list'}
      {...listPerf}
      keyboardShouldPersistTaps="handled"
      {...gridListProps(grid, bottomPad, columns, listPad)}
      data={albums}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl {...pull} tintColor={colors.accent} />
      }
      renderItem={({ item }) =>
        grid ? (
          <GridCard
            href={`/album/${item.id}`}
            uri={coverArtUrl(item.coverArt ?? item.id, COVER.card)}
            title={item.name}
            subtitle={item.artist}
            pinned={!!pins[`album:${item.id}`]}
            dimmed={availability.unavailable(item)}
            badge={availability.downloaded(item)}
            onLongPress={() => { haptic('light'); openMenu({ kind: 'album', album: item }); }}
          />
        ) : (
          <AlbumRow
            album={item}
            pinned={!!pins[`album:${item.id}`]}
            dimmed={availability.unavailable(item)}
            downloaded={availability.downloaded(item)}
          />
        )
      }
      ListEmptyComponent={
        query ? (
          <NoResults query={query} />
        ) : (
          <EmptyState
            icon="albums-outline"
            title={t('No favorite albums')}
            subtitle={t('Favorite albums to see them here.')}
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
  kind: 'playlist' | 'album' | 'artist' | 'podcast' | 'episode';
  id: string;
  name: string;
  /** What it files under, where that isn't its name. */
  sortName?: string;
  coverArt?: string;
  /** Whose it is: the owner of a list, the artist of an album, the show of an episode. */
  by?: string;
  href: string;
  /** The two scores the orders ask for, worked out once (see `sortItems`). */
  recent: number;
  added: number;
  playlist?: Playlist;
  album?: Album;
  artist?: Artist;
  /** The objects a podcast row's tap/menu need. */
  channel?: PodcastChannel;
  episode?: PodcastEpisode;
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
  // Offline, an episode only plays from disk; hide mode drops its row (as the
  // song lists do via `annotate`).
  const offline = useAuthStore((s) => s.offline);
  const files = useDownloads((s) => s.files);
  const hideUnavailable = useSettings((s) => s.hideUnavailableOffline);
  const availability = useAlbumAvailability();
  const toast = useToast((s) => s.show);
  const unavailable = (id: string) => episodeUnavailable(offline, files, id);
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
  // Only favorited shows land in the mixed Library, like the Podcasts segment.
  const { channels: podcastsQ, episodes: episodesQ } = useFavoritePodcasts();
  const pull = usePullRefresh(lists, starred, podcastsQ, episodesQ);

  const items = useMemo(() => {
    const all: LibItem[] = [
      ...(podcastsQ.data ?? []).map((c) => ({
        kind: 'podcast' as const,
        id: c.id,
        name: c.title,
        coverArt: c.imageUrl,
        by: c.author,
        href: `/podcast/${c.id}`,
        recent: c.listenedAt,
        added: c.favoritedAt,
        channel: c,
      })),
      ...(episodesQ.data ?? []).map((r) => ({
        kind: 'episode' as const,
        id: r.episode.id,
        name: r.episode.title,
        coverArt: r.channel.imageUrl,
        by: r.channel.title,
        href: `/podcast/${r.channel.id}`,
        recent: r.listenedAt,
        added: r.favoritedAt,
        episode: r.episode,
        channel: r.channel,
      })),
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
        sortName: a.sortName,
        coverArt: a.coverArt,
        artist: a,
        href: `/artist/${a.id}`,
        recent: Math.max(times[`/artist/${a.id}`] ?? 0, byArtist.get(a.id) ?? 0),
        added: Date.parse(a.starred ?? '') || 0,
      })),
    ];
    return withPins(
      sortItems(
        // Albums and podcasts match by who made them too, as they do under their
        // own chip: looking for a name should find the shows behind it.
        all.filter(
          (i) =>
            !(
              hideUnavailable &&
              ((i.kind === 'episode' && episodeUnavailable(offline, files, i.id)) ||
                i.playlist?.availableOffline === false ||
                (i.album && availability.unavailable(i.album)))
            ) &&
            matches(query, i.name, i.kind === 'album' || i.kind === 'podcast' || i.kind === 'episode' ? i.by : undefined),
        ),
        sort,
        (i) => i.sortName || i.name,
        (i) => (sort === 'recent' ? i.recent : i.added),
        byLibraryName,
      ),
      (i) => `${i.kind}:${i.id}`,
      pins,
    );
  }, [lists.data, starred.data, podcastsQ.data, episodesQ.data, query, sort, times, byAlbum, byArtist, pins, offline, files, hideUnavailable, availability]);

  /** "Playlist · juan", "Album · Rojuu", "Podcast · Ada", "Artist". */
  const label = (i: LibItem): string => {
    const kind =
      i.kind === 'playlist'
        ? t('Playlist')
        : i.kind === 'album'
          ? t('Album')
          : i.kind === 'podcast'
            ? t('Podcast')
            : i.kind === 'episode'
              ? t('Episode')
              : t('Artist');
    return i.by ? `${kind} · ${i.by}` : kind;
  };

  const onLongPress = (i: LibItem) => {
    if (i.playlist) openMenu({ kind: 'playlist', playlist: i.playlist });
    else if (i.album) openMenu({ kind: 'album', album: i.album });
    else if (i.kind === 'episode' && i.episode && i.channel)
      useSongMenu.getState().open(episodeToSong(i.episode, i.channel));
    else if (i.channel) openPodcastMenu(i.channel);
    else if (i.artist) openArtistMenu(i.artist);
    else return;
    haptic('light');
  };
  // Tapping an episode plays just that episode; a show still taps to its screen.
  const playEpisode = (i: LibItem) => {
    if (!i.episode || !i.channel) return;
    queueEpisode(i.episode, i.channel);
  };

  const loading = lists.isLoading || starred.isLoading;
  const listsFailed = lists.isError && !lists.data;
  const starredFailed = starred.isError && !starred.data;
  // One of the two is missing: the rows that came are worth showing, with a word.
  useEffect(() => {
    if (listsFailed !== starredFailed) toast(t("Couldn't load all of your library."));
  }, [listsFailed, starredFailed, toast, t]);
  if (loading) return <Loader />;
  if (listsFailed && starredFailed) {
    return <Message text={t("Couldn't load your library.")} onRetry={() => void pull.onRefresh()} />;
  }
  // In grid, Favorites goes in as the first card (sentinel); in list it stays
  // the full-width header. The same arrangement the playlists have.
  const showFavorites = !query;
  const favoritesCard = grid && showFavorites && items.length > 0;
  const data: LibItem[] = favoritesCard
    ? [{ kind: 'playlist', id: FAVORITES_ID, name: '', href: '', recent: 0, added: 0 }, ...items]
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
        <RefreshControl {...pull} tintColor={colors.accent} />
      }
      ListHeaderComponent={showFavorites && !favoritesCard ? <FavoritesEntry /> : undefined}
      ListEmptyComponent={
        query ? (
          <NoResults query={query} />
        ) : (
          <EmptyState
            icon="library-outline"
            title={t('Nothing here yet')}
            subtitle={t('Your playlists and favorites show up here.')}
            action={onNew ? { label: t('New playlist'), onPress: onNew } : undefined}
          />
        )
      }
      renderItem={({ item }: { item: LibItem }) =>
        item.id === FAVORITES_ID ? (
          <FavoritesEntry grid />
        ) : grid ? (
          <GridCard
            href={item.kind === 'episode' ? '' : item.href}
            onPress={
              item.kind === 'episode'
                ? () => {
                    if (unavailable(item.id)) toast(t('Not available offline'));
                    else {
                      haptic('light');
                      playEpisode(item);
                    }
                  }
                : undefined
            }
            uri={coverArtUrl(item.coverArt ?? item.id, COVER.card)}
            rounded={item.kind === 'artist'}
            title={item.name}
            subtitle={label(item)}
            pinned={!!pins[`${item.kind}:${item.id}`]}
            dimmed={
              item.kind === 'episode'
                ? unavailable(item.id)
                : item.playlist?.availableOffline === false ||
                  (!!item.album && availability.unavailable(item.album))
            }
            badge={
              item.kind === 'episode'
                ? !!files[item.id]
                : !!item.album && availability.downloaded(item.album)
            }
            onLongPress={
              item.kind === 'episode' && unavailable(item.id)
                ? undefined
                : () => onLongPress(item)
            }
          />
        ) : (
          item.kind === 'episode' ? (
            <PodcastRow
              channel={item.channel}
              episode={item.episode}
              pinned={!!pins[`${item.kind}:${item.id}`]}
              sub={label(item)}
            />
          ) : item.kind === 'podcast' ? (
            <PodcastRow
              channel={item.channel}
              pinned={!!pins[`${item.kind}:${item.id}`]}
              sub={label(item)}
            />
          ) : item.album ? (
            <AlbumRow
              album={item.album}
              sub={label(item)}
              pinned={!!pins[`${item.kind}:${item.id}`]}
              dimmed={availability.unavailable(item.album)}
              downloaded={availability.downloaded(item.album)}
            />
          ) : item.artist ? (
            <ArtistRow artist={item.artist} sub={label(item)} />
          ) : item.playlist ? (
            <PlaylistRow
              playlist={item.playlist}
              sub={label(item)}
              pinned={!!pins[`${item.kind}:${item.id}`]}
              dimmed={item.playlist.availableOffline === false}
            />
          ) : null
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
  dimmed,
  badge,
  onLongPress,
  onPress,
}: {
  href: string;
  uri?: string;
  /** Alternative cover (e.g. the Favorites tile). */
  art?: ReactNode;
  rounded?: boolean;
  title: string;
  subtitle?: string;
  pinned?: boolean;
  /** Offline and not downloaded (a podcast episode): dim like a song row. */
  dimmed?: boolean;
  /** On disk (a downloaded episode): the ↓ badge, as `TrackRow` gives a song. */
  badge?: boolean;
  onLongPress?: () => void;
  /**
   * A card that does something on tap instead of navigating (a podcast episode
   * plays itself). With it, the card is not a link: the tap runs this.
   */
  onPress?: () => void;
}) {
  const { card } = useGridMetrics();
  const press = usePressFeedback();
  const pressable = (
    <Pressable
      style={StyleSheet.flatten([styles.card, dimmed && styles.dimmed, { width: card }, rounded && styles.cardCentered])}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {art ?? <Cover uri={uri} size={card} rounded={rounded} />}
      <Text style={[styles.cardTitle, rounded && styles.centerText]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <View style={styles.cardSubLine}>
          {badge ? <Icon name="arrow-down-circle" size={12} color={colors.accent} /> : null}
          {pinned ? <Icon name="pin" size={12} color={colors.accent} /> : null}
          <Text style={styles.cardSub} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
  // A card that acts on tap (an episode plays itself) is not a link; otherwise
  // the tap navigates to `href`.
  return (
    <Animated.View style={press.style}>
      {onPress ? pressable : <Link href={href} asChild>{pressable}</Link>}
    </Animated.View>
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

  // Going to another tab puts the bar away; opening a result and coming back
  // finds the filter as you left it.
  const navigation = useNavigation();
  useEffect(
    () =>
      navigation.addListener('state', (e) => {
        const { routes, index } = e.data.state;
        if (routes[index]?.name !== 'library') closeSearch();
      }),
    [navigation, closeSearch],
  );

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
      const id = await createPlaylist(name);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      router.push(`/playlist/${id}`);
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

      {/* The text stays across chips: the point is filtering the same word
          across lists, albums and artists. */}
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
        ) : segment === 'podcasts' ? (
          <PodcastsTab query={filter} />
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
    // A capsule with Round, a rounded rectangle with Pointier.
    borderRadius: restyled(radius.pill, radius.md),
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
  // Offline and not downloaded (a podcast episode): dim like a song row.
  dimmed: { opacity: DIM_OPACITY },
  cardTitle: { color: colors.text, fontSize: fontSize.xs, lineHeight: lineHeight.xs, fontWeight: '500', marginTop: spacing.xs },
  centerText: { textAlign: 'center' },
  cardSub: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: lineHeight.xs },
  cardSubLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs },
  rowSubGap: { marginTop: 2 },
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
