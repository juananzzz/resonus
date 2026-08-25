/**
 * Spotify-style header (dominant color gradient + cover that fades on scroll
 * and a collapsing fixed bar) and the song list. Shared by album and playlist
 * screens.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
// The list must use gesture-handler so the row swipe-to-queue doesn't fight
// the vertical scroll (with RN's FlatList the gesture is flaky).
import {
  FlatList as GHFlatList,
  Gesture,
  GestureDetector,
  type GestureType,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Song, type StarType } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useSelectionMenu } from '@/hooks/useSelectionMenu';
import { useT } from '@/i18n';
import { artistTargets } from '@/lib/artistNav';
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';
import { useArtistPicker } from '@/store/artistPicker';
import { usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing, themed } from '@/theme';
import { BackChevron } from './BackChevron';
import { Cover } from './Cover';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';
import { FavoriteButton } from './FavoriteButton';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { SelectionBar, type SelectionAction } from './SelectionBar';
import { TrackRow } from './TrackRow';

/**
 * The cover across the top of an album or a playlist.
 *
 * A share of the width, capped, and measured while rendering rather than once
 * when the file was imported: turning the phone used to leave it at the size
 * it had when the app started. The height matters as much as the width on a
 * screen lying on its side, where 250 points of picture is most of the page
 * and the tracklist is what people came for (#131).
 */
function coverSize(width: number, height: number): number {
  return Math.round(Math.min(width * 0.58, height * 0.4, 250));
}
const TOPBAR_H = 48;
/** Height of the hidden search bar ("Find in playlist" Spotify style),
 * including the separation gap from the cover. */
const SEARCH_H = 72;

/**
 * The list, with its scroll wired straight to what the scroll animates.
 *
 * The cover fading, the bar coming in and the gradient following the scroll all
 * hang off the scroll position, and every frame of them used to go through JS:
 * the list moved natively while they waited behind whatever else the thread was
 * doing. With music playing there is always something else, and what it looks
 * like is a header stuttering against a list that does not (#154). Native, they
 * cannot be late whatever JS is up to.
 *
 * The search bar is the one thing that stays on this side: it animates a
 * height, which the native side does not do, so it is kept in a wrapper of its
 * own rather than added to the scroll (mixing the two in one expression is what
 * would break both).
 */
const AnimatedList = Animated.createAnimatedComponent(GHFlatList) as typeof GHFlatList;

/** Normalizes for searching: lowercase and without accents. */
function normQ(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

interface Props {
  title: string;
  subtitle?: string;
  /** If provided, the subtitle links to the artist when tapped. */
  artistId?: string;
  /** Album artists; with multiple, the subtitle opens the picker. */
  artists?: { id: string; name: string }[];
  /** Circular artist photo next to the subtitle (Spotify style). */
  artistImageUri?: string;
  /**
   * What the list says about itself (a playlist's description), whole, above
   * the metadata. Not cut down to a line with the rest a tap away: nothing
   * would say the tap is there, and a description nobody can finish reading is
   * barely better than one that isn't shown. Whoever wants the header quiet
   * turns it off in Settings › Appearance.
   */
  description?: string;
  /** Metadata line (e.g. "Album · 2021 · 12 songs · 48 min"). */
  meta?: string;
  /**
   * The record carries a parental advisory: the E goes at the head of the
   * metadata line. A word in that line would have said the same thing, but the
   * badge is what the rows below it use and reading one mark in two shapes on
   * the same screen is worse than reading it twice.
   */
  explicit?: boolean;
  /** Genres of the album, as a scrollable row of chips that browse each one.
   *  Empty or absent shows nothing at all, not an empty row. */
  genres?: string[];
  coverUri?: string;
  /** Custom cover art (e.g. Favorites artwork); replaces coverUri. */
  renderCover?: (size: number) => ReactNode;
  /** If provided, the cover is tappable (e.g. open the fullscreen viewer). */
  onCoverPress?: () => void;
  /** Hides the header cover and reclaims that space (e.g. Favorites). */
  hideCover?: boolean;
  /** Gradient/bar color if there's no cover with a dominant color. */
  accentColor?: string;
  songs: Song[];
  currentId?: string;
  /** Numbers the tracks (useful on albums). */
  numbered?: boolean;
  /**
   * Disc header to render ABOVE the row at that index (multi-disc albums):
   * index → label map ("Disc 2", disc title...). Only used without an active
   * search filter (filtered results have no discs).
   */
  discHeaders?: Record<number, string>;
  /** If provided, shows a heart to mark the album as a favorite. */
  favorite?: { id: string; type: StarType; starred: boolean };
  /** Offline download button (album/playlist header). */
  download?: {
    status: 'none' | 'active' | 'done';
    /** Progress 0..1 while `status` is 'active'. */
    progress: number;
    onPress: () => void;
  };
  /** If provided, shows a ⋯ button. */
  onMenu?: () => void;
  /** If provided, each song's menu allows removing it from this playlist. */
  playlistId?: string;
  /** Real server index for each song, in case the list is reordered. */
  playlistIndices?: number[];
  /** If provided, shows a sort button to the left of ⋯. */
  onSort?: () => void;
  /**
   * Action row below the others (Spotify style), e.g. "+ Add…" in Favorites.
   * The icon is "+" unless another is specified (the mix screen uses it to
   * reshuffle).
   */
  addAction?: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void };
  /** Extra content at the bottom of the list (e.g. "More from this artist"). */
  footer?: ReactNode;
  /** What to show below the header when there are no songs (e.g. empty playlist). */
  emptyState?: ReactNode;
  /** Shows the mini album cover on each row (playlists/favorites). */
  showArtwork?: boolean;
  /**
   * Hidden "search in list" bar above the header: revealed by pulling down
   * from the very top (Spotify-style gesture).
   */
  searchable?: boolean;
  /** Search bar hint text (defaults to "Find in playlist"). */
  searchPlaceholder?: string;
  /**
   * Enables multi-select (enter via long-press on a row). Each action receives
   * the marked songs; `indices` are their real positions (via `playlistIndices`
   * if the list is reordered).
   */
  selection?: {
    /** Remove from this list (playlist: by index; favorites: unstar). */
    onRemove?: (songs: Song[], indices: number[]) => void;
    /** Add to another playlist. */
    onAddTo?: (songs: Song[]) => void;
    /** Bulk download. */
    onDownload?: (songs: Song[]) => void;
    /** Favorites screen: there, "Remove" already is unfavouriting. */
    favorites?: boolean;
  };
  /** `opts` goes straight to `playQueue`: the shuffle button asks for the list
   *  dealt, which the screen owning the songs is the one who can request. */
  onPlay: (startIndex: number, opts?: { shuffled?: boolean }) => void | Promise<void | boolean>;
  /**
   * A row of its own between the header and the list, for an album that has
   * somewhere to be resumed from. Not the play button: that one means "play
   * this" on every screen in the app, and a screen that quietly repurposes it
   * is a screen you can no longer start from the top.
   */
  resumeAction?: { label: string; detail?: string; onPress: () => void | Promise<void> };
}

export function TrackListView({
  title,
  subtitle,
  artistId,
  artists,
  artistImageUri,
  description,
  meta,
  explicit,
  genres,
  coverUri,
  renderCover,
  onCoverPress,
  hideCover,
  accentColor,
  songs,
  currentId,
  numbered,
  discHeaders,
  favorite,
  download,
  onMenu,
  playlistId,
  playlistIndices,
  onSort,
  addAction,
  footer,
  emptyState,
  showArtwork,
  searchable,
  searchPlaceholder,
  selection,
  onPlay,
  resumeAction,
}: Props) {
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useScreenSize();
  const bottomPad = useScreenBottomPadding();
  const dominant = useDominantColor(coverUri);
  const headerColor = accentColor ?? dominant;
  const shuffle = usePlayerStore((s) => s.shuffle);
  const queueDealt = usePlayerStore((s) => s.queueDealt);
  // The shuffle button gets tinted only if this list is the one playing;
  // otherwise, the (global) shuffle mode would also tint the buttons of
  // unrelated albums/playlists, which was confusing.
  //
  // The mode is not the only way to end up listening shuffled: this button
  // hands the list over dealt without touching the mode (see `shufflePlay`),
  // and reading the mode alone meant pressing it lit nothing at all. What it
  // says is "what you are hearing is this list, shuffled", however it got that
  // way, so tapping a song in the list afterwards puts it out again.
  const shuffleActive = useMemo(
    () => (shuffle || queueDealt) && !!currentId && songs.some((s) => s.id === currentId),
    [shuffle, queueDealt, currentId, songs],
  );
  const openArtistPicker = useArtistPicker((s) => s.open);
  // The caller worked out whether the record carries an advisory; whether it is
  // drawn is the badge's own switch, asked here so the metadata line is not
  // built around a badge that never comes.
  const showExplicit = useExplicitBadge(explicit ? 'explicit' : undefined);
  const subtitleTargets = artistTargets({ artistId, artists });
  const onSubtitlePress =
    subtitleTargets.length > 1
      ? () => openArtistPicker(subtitleTargets)
      : subtitleTargets.length === 1
        ? () => router.push(`/artist/${subtitleTargets[0].id}`)
        : undefined;

  const scrollY = useRef(new Animated.Value(0)).current;

  // ── In-list search ──────────────────────────────────────────────────────
  // The bar is rendered collapsed (height 0) above the header; a pull-down
  // gesture when the list is at the very top reveals it, and scrolling back
  // collapses it. Like Spotify's "Find in playlist".
  const listRef = useRef<GHFlatList<Song>>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [revealed, setRevealed] = useState(false);
  /** Last real scroll offset (the gesture only reveals at the top). */
  const lastOffsetY = useRef(0);
  const searchH = useRef(new Animated.Value(0)).current;
  const searchBar = !!searchable && songs.length > 0;

  // `setRevealed` is async: the gesture fires `onChange` many times per drag,
  // and several would pass the `!revealed` guard before the re-render, each
  // triggering haptic. The ref updates instantly and stops the rest.
  const revealedRef = useRef(false);

  function revealSearchBar() {
    if (revealedRef.current) return;
    revealedRef.current = true;
    haptic('light');
    setRevealed(true);
    Animated.timing(searchH, { toValue: SEARCH_H, duration: 200, useNativeDriver: false }).start();
  }

  function collapseSearchBar() {
    revealedRef.current = false;
    setRevealed(false);
    Animated.timing(searchH, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  }

  // Simultaneous pan with the list scroll: doesn't steal the gesture, just
  // observes. Android doesn't fire overscroll events (the list clamps offset
  // at 0), so the "pull down at the top" must be detected separately. The
  // simultaneity is declared on the list (simultaneousHandlers prop with the
  // gesture ref): without it, native scroll cancels this Pan before it starts.
  const revealPanRef = useRef<GestureType | undefined>(undefined);
  const revealPan = Gesture.Pan()
    .withRef(revealPanRef)
    .runOnJS(true)
    // Only downward drags: upward ones (normal scroll) cancel it.
    .activeOffsetY(10)
    .failOffsetY(-10)
    .onChange((e) => {
      if (!searchBar || searching || revealed) return;
      if (lastOffsetY.current <= 1 && e.translationY > 60) revealSearchBar();
    });

  // ── Multi-select ────────────────────────────────────────────────────────
  /**
   * One key per row: the song's id, and which time it appears if the same song
   * is in the list more than once. A playlist may hold the same track twice,
   * and while these were the plain id every one of those rows was the same row
   * as far as anything here could tell: ticking one ticked them all, and
   * removing one removed them all, which left none (#132). The queue screen
   * already numbers its rows this way, and for the same reason.
   *
   * Keyed rather than indexed because it survives what indices do not: sorting
   * the list moves every position, and `id#0` is still the same song
   * afterwards. Two rows of the same song do swap places with each other, and
   * there is nothing to tell them apart by anyway.
   */
  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return songs.map((s) => {
      const n = seen.get(s.id) ?? 0;
      seen.set(s.id, n + 1);
      return `${s.id}#${n}`;
    });
  }, [songs]);

  // null = normal mode; a Set (even empty) = selecting.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const selecting = selectedIds !== null;
  // Row that just entered selection via long-press. On release, the `onPress` of
  // that same gesture arrives with `selecting` already active and would undo the
  // selection; we discard it once. Reset in `onPressIn` (start of each press),
  // so no residue remains even if `onPress` doesn't fire after the long-press.
  const justLongPressed = useRef<string | null>(null);
  const allSelected = selecting && selectedIds.size === songs.length && songs.length > 0;

  function toggleSelect(key: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Runs a selection-mode action with the marked items and exits the mode. */
  function runSelectionAction(fn: (sel: Song[], indices: number[]) => void) {
    const sel: Song[] = [];
    const indices: number[] = [];
    songs.forEach((s, i) => {
      if (selectedIds?.has(rowKeys[i])) {
        sel.push(s);
        indices.push(playlistIndices ? playlistIndices[i] : i);
      }
    });
    setSelectedIds(null);
    if (sel.length > 0) fn(sel, indices);
  }

  const selectionMenu = useSelectionMenu(runSelectionAction, {
    favorites: selection?.favorites,
  });
  // What this list lets you do with a selection, each one built once: the bar
  // takes two of them and ⋯ holds whatever is left.
  const addToAction: SelectionAction[] = selection?.onAddTo
    ? [
        {
          icon: 'add-circle-outline',
          label: t('Add to a playlist'),
          onPress: () => runSelectionAction((sel) => selection.onAddTo!(sel)),
        },
      ]
    : [];
  const removeAction: SelectionAction[] = selection?.onRemove
    ? [
        {
          icon: 'remove-circle-outline',
          label: t('Remove'),
          onPress: () => runSelectionAction((sel, idx) => selection.onRemove!(sel, idx)),
        },
      ]
    : [];
  const downloadAction: SelectionAction[] = selection?.onDownload
    ? [
        {
          icon: 'download-outline',
          label: t('Download'),
          onPress: () => runSelectionAction((sel) => selection.onDownload!(sel)),
        },
      ]
    : [];

  // Without cover, the header is shorter: the gradient and bar collapse adjust
  // to a smaller distance so the transition fits.
  const art = coverSize(screenW, screenH);
  const cover = hideCover ? 0 : art;
  const collapse = hideCover ? 120 : art;
  // The gradient tail dies roughly where the header ends (title + actions):
  // it blends the color with the list's black without tinting the first row
  // (tested: extending it to the rows looked messy).
  const gradientH = insets.top + TOPBAR_H + cover + 120;
  const coverOpacity = scrollY.interpolate({
    inputRange: [0, collapse * 0.7],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const barContentOpacity = scrollY.interpolate({
    inputRange: [collapse * 0.5, collapse * 0.85],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const barBgOpacity = scrollY.interpolate({
    inputRange: [0, collapse * 0.85],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Live filtering; preserves each song's original index so play/enqueue/remove
  // still point to the correct position.
  const filtered = useMemo(() => {
    const q = normQ(query.trim());
    if (!searchable || !q) return null;
    const rows: { song: Song; index: number }[] = [];
    songs.forEach((song, index) => {
      if (normQ(song.title).includes(q) || (song.artist && normQ(song.artist).includes(q)))
        rows.push({ song, index });
    });
    return rows;
  }, [searchable, query, songs]);
  const shownSongs = useMemo(
    () => (filtered ? filtered.map((r) => r.song) : songs),
    [filtered, songs],
  );

  function cancelSearch() {
    Keyboard.dismiss();
    setQuery('');
    setSearching(false);
    collapseSearchBar();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  function shufflePlay() {
    if (songs.length === 0) return;
    // The queue itself comes out dealt; the shuffle mode is not touched. It
    // used to be turned on here, and since the mode is remembered between
    // sessions it stayed on for the next album someone pressed Play on.
    void onPlay(0, { shuffled: true });
  }

  return (
    <View style={styles.root}>
      {/* Dominant color gradient; scrolls with 1:1 parallax. Hidden in search
          mode to keep the screen flat black. */}
      {searching ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.gradientWrap,
            {
              height: gradientH,
              // Moves down with the revealed search bar, which pushes the header
              // down without moving the scroll offset. On its own view, because
              // this is a height animated from JS and the scroll below is not:
              // one expression holding both would drag the scroll back onto this
              // side, which is the whole thing being avoided (see `AnimatedList`).
              transform: [{ translateY: searchH }],
            },
          ]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              // And follows the scroll 1:1, natively.
              { transform: [{ translateY: Animated.multiply(scrollY, -1) }] },
            ]}
          >
            {/* Color band above the gradient: when the search bar is revealed,
                content shifts down SEARCH_H px and this fills the gap at the top. */}
            {searchable ? (
              <View style={[styles.gradientAbove, { backgroundColor: headerColor }]} />
            ) : null}
            <LinearGradient
              colors={[headerColor, colors.background]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </Animated.View>
      )}

      <GestureDetector gesture={revealPan}>
      <AnimatedList
        ref={listRef}
        simultaneousHandlers={revealPanRef}
        {...listPerf}
        // Each row mounts a ReanimatedSwipeable (gestures + reanimated); with
        // `removeClippedSubviews` (known Android bug) those heavy rows render
        // blank and take a while to appear when scrolling large lists.
        // Disabling it here keeps them mounted within the virtual window.
        removeClippedSubviews={false}
        data={shownSongs}
        // The row's own key, not the song's: the same song can be in the list
        // twice and React was being handed the same key for both.
        keyExtractor={(_, index) => rowKeys[filtered ? filtered[index].index : index]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: insets.top + TOPBAR_H + spacing.md,
            paddingBottom: bottomPad,
            // Centred on a wide screen instead of stretched across it: a row
            // whose title is at one edge and whose duration is at the other,
            // a hand's width apart, is a phone screen that was pulled (#131).
            paddingHorizontal: centredPadding(screenW, spacing.lg),
          },
        ]}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          // The listener still runs on this side: a native event is delivered to
          // JS as well, it just no longer has to be for the animation to move.
          useNativeDriver: true,
          listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const y = e.nativeEvent.contentOffset.y;
            lastOffsetY.current = y;
            // Scrolling down with the bar open collapses it.
            if (revealed && !searching && y > 30) collapseSearchBar();
          },
        })}
        ListHeaderComponent={
          <View>
            {searchBar ? (
              /* Collapsed = height 0 (invisible); the gesture reveals it. The clip
                 goes in a no-padding container: any padding would impose a
                 minimum height and show a sliver. */
              <Animated.View style={[styles.searchClip, { height: searchH }]}>
              <View style={styles.searchRow}>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={18} color={colors.textSecondary} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={searchPlaceholder ?? t('Find in playlist')}
                    placeholderTextColor={colors.textSecondary}
                    value={query}
                    onChangeText={setQuery}
                    onFocus={() => setSearching(true)}
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
                      <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                    </Pressable>
                  ) : null}
                </View>
                {searching ? (
                  <Pressable hitSlop={8} accessibilityRole="button" onPress={cancelSearch}>
                    <Text style={styles.searchCancel}>{t('Cancel')}</Text>
                  </Pressable>
                ) : null}
              </View>
              </Animated.View>
            ) : null}
            {/* While searching, the large header is hidden: results stay flush
                with the bar, which is what Spotify does. */}
            {searching ? null : (
          <View style={styles.header}>
            {hideCover ? null : (
              <Animated.View style={[styles.coverCenter, { opacity: coverOpacity }]}>
                {onCoverPress ? (
                  <Pressable
                    onPress={onCoverPress}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={t('View cover')}
                  >
                    {renderCover ? renderCover(art) : <Cover uri={coverUri} size={art} />}
                  </Pressable>
                ) : renderCover ? (
                  renderCover(art)
                ) : (
                  <Cover uri={coverUri} size={art} />
                )}
              </Animated.View>
            )}
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {subtitle ? (
              onSubtitlePress ? (
                <Pressable hitSlop={6} style={styles.subtitleRow} onPress={onSubtitlePress}>
                  {artistImageUri ? (
                    <View style={styles.artistPhoto}>
                      <Cover uri={artistImageUri} size={24} />
                    </View>
                  ) : null}
                  <Text style={[styles.subtitle, styles.subtitleLink]}>{subtitle}</Text>
                </Pressable>
              ) : (
                <Text style={styles.subtitle}>{subtitle}</Text>
              )
            ) : null}
            {description?.trim() ? (
              <Text style={styles.description}>{description.trim()}</Text>
            ) : null}
            {showExplicit || meta ? (
              <View style={styles.metaRow}>
                {showExplicit ? <ExplicitBadge status="explicit" /> : null}
                {meta ? <Text style={styles.meta}>{meta}</Text> : null}
              </View>
            ) : null}
            {/* Deliberately quiet: same weight as the metadata line above, so
                it reads as one more piece of album info and not as a control.
                Horizontal because an album with eight tags shouldn't push the
                play button down the screen. */}
            {genres && genres.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.genres}
                contentContainerStyle={styles.genresContent}
              >
                {genres.map((g) => (
                  <Link key={g} href={`/genre/${encodeURIComponent(g)}`} asChild>
                    <Pressable style={styles.genreChip}>
                      <Text style={styles.genreText}>{g}</Text>
                    </Pressable>
                  </Link>
                ))}
              </ScrollView>
            ) : null}

            <View style={styles.actions}>
              <View style={styles.actionsLeft}>
                {favorite ? (
                  <FavoriteButton
                    id={favorite.id}
                    type={favorite.type}
                    starred={favorite.starred}
                    size={28}
                  />
                ) : null}
                {download ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={
                      download.status === 'done' ? t('Remove download') : t('Download')
                    }
                    onPress={download.onPress}
                    style={styles.downloadWrap}
                  >
                    {download.status === 'active' ? (
                      <>
                        <ActivityIndicator size="small" color={colors.accent} />
                        <Text style={[styles.downloadProgress, { color: colors.accent }]}>
                          {Math.round(download.progress * 100)}%
                        </Text>
                      </>
                    ) : (
                      <Ionicons
                        name={
                          download.status === 'done'
                            ? 'arrow-down-circle'
                            : 'arrow-down-circle-outline'
                        }
                        size={26}
                        color={download.status === 'done' ? colors.accent : colors.textSecondary}
                      />
                    )}
                  </Pressable>
                ) : null}
                {onSort ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('Sort')}
                    onPress={onSort}
                  >
                    <Ionicons name="swap-vertical" size={24} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
                {onMenu ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('More options')}
                    onPress={onMenu}
                  >
                    <Ionicons name="ellipsis-horizontal" size={26} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.actionsRight}>
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('Shuffle')}
                  onPress={shufflePlay}
                >
                  <Ionicons
                    name="shuffle"
                    size={26}
                    color={shuffleActive ? colors.accent : colors.textSecondary}
                  />
                </Pressable>
                <Pressable
                  style={[styles.playButton, { backgroundColor: colors.accent }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('Play')}
                  onPress={() => songs.length > 0 && onPlay(0)}
                >
                  <Ionicons
                    name="play"
                    size={28}
                    color={colors.onAccent}
                    style={{ marginLeft: 3 }}
                  />
                </Pressable>
              </View>
            </View>

            {resumeAction ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void Promise.resolve(resumeAction.onPress()).catch(() => {})}
                style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
              >
                <View style={styles.addBox}>
                  <Ionicons name="play-forward" size={26} color={colors.textSecondary} />
                </View>
                <View style={styles.resumeText}>
                  <Text style={styles.addLabel}>{resumeAction.label}</Text>
                  {resumeAction.detail ? (
                    <Text style={styles.resumeDetail} numberOfLines={1}>
                      {resumeAction.detail}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ) : null}

            {addAction ? (
              <Pressable
                accessibilityRole="button"
                onPress={addAction.onPress}
                style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
              >
                <View style={styles.addBox}>
                  <Ionicons
                    name={addAction.icon ?? 'add'}
                    size={26}
                    color={colors.textSecondary}
                  />
                </View>
                <Text style={styles.addLabel}>{addAction.label}</Text>
              </Pressable>
            ) : null}
          </View>
            )}
          </View>
        }
        extraData={selectedIds}
        renderItem={({ item, index }) => {
          // With an active filter, `index` is the position in results; everything
          // else (play, remove, numbering) uses the original position.
          const origIndex = filtered ? filtered[index].index : index;
          const rowKey = rowKeys[origIndex];
          // Disc header (only when not searching, where origIndex === index).
          const discLabel = filtered ? undefined : discHeaders?.[origIndex];
          const row = (
            <TrackRow
              song={item}
              // With artwork visible the number is omitted: the album stays as
              // usual (only the artist's Popular shows number + cover).
              position={numbered && !showArtwork ? item.track ?? origIndex + 1 : undefined}
              isCurrent={currentId === item.id}
              showArtwork={showArtwork}
              menuContext={
                playlistId
                  ? { playlistId, index: playlistIndices ? playlistIndices[origIndex] : origIndex }
                  : undefined
              }
              selecting={selecting}
              selected={!!selectedIds?.has(rowKey)}
              onPressIn={() => {
                justLongPressed.current = null;
              }}
              onLongPress={
                selection && !selecting
                  ? () => {
                      haptic('medium');
                      setSelectedIds(new Set([rowKey]));
                      justLongPressed.current = rowKey;
                    }
                  : undefined
              }
              onPress={() => {
                // Discards the onPress that follows the selection long-press:
                // otherwise it would deselect the song you entered selection with.
                if (justLongPressed.current === rowKey) return;
                if (selecting) toggleSelect(rowKey);
                else onPlay(origIndex);
              }}
            />
          );
          if (!discLabel) return row;
          return (
            <>
              <DiscHeader label={discLabel} />
              {row}
            </>
          );
        }}
        ListEmptyComponent={
          filtered ? (
            <Text style={styles.noResults}>{t('No results for “{q}”', { q: query.trim() })}</Text>
          ) : emptyState ? (
            <>{emptyState}</>
          ) : null
        }
        ListFooterComponent={footer ? <>{footer}</> : null}
      />
      </GestureDetector>

      {/* Fixed top bar: the background and title appear on collapse. In
          selection mode it's replaced by ✕ + counter + select all. */}
      <View style={[styles.bar, { height: insets.top + TOPBAR_H, paddingTop: insets.top }]}>
        {selecting ? (
          <>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: headerColor }]} />
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('Close')}
              onPress={() => setSelectedIds(null)}
            >
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.barTitle} numberOfLines={1}>
              {t('{n} selected', { n: selectedIds.size })}
            </Text>
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('Select all')}
              onPress={() =>
                setSelectedIds(allSelected ? new Set() : new Set(rowKeys))
              }
            >
              <Ionicons
                name="checkmark-done"
                size={24}
                color={allSelected ? colors.accent : colors.text}
              />
            </Pressable>
          </>
        ) : (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: headerColor, opacity: barBgOpacity },
              ]}
            />
            <BackChevron size={28} label={t('Close')} />
            <Animated.Text
              style={[styles.barTitle, { opacity: barContentOpacity }]}
              numberOfLines={1}
            >
              {title}
            </Animated.Text>
          </>
        )}
      </View>

      {selecting ? (
        <SelectionBar
          count={selectedIds.size}
          // Second slot: taking songs out of this list where that is a thing,
          // and downloading where it isn't. Whichever one loses the slot is
          // the one behind ⋯.
          actions={[...addToAction, ...(removeAction.length > 0 ? removeAction : downloadAction)]}
          menu={[
            ...(removeAction.length > 0 ? downloadAction : []),
            ...selectionMenu.actions,
          ]}
        />
      ) : null}
      {selectionMenu.dialogs}
    </View>
  );
}

/** Disc header (thin separator + label) for multi-disc albums. */
function DiscHeader({ label }: { label: string }) {
  return (
    <View style={styles.discHeader}>
      <Text style={styles.discHeaderText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = themed((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  gradientWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  gradientAbove: {
    position: 'absolute',
    top: -SEARCH_H * 4,
    left: 0,
    right: 0,
    height: SEARCH_H * 4,
  },
  searchClip: {
    overflow: 'hidden',
  },
  searchRow: {
    height: SEARCH_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // The gap to the cover goes inside the animated height: this way it
    // collapses along with the bar (an external margin would always be visible).
    paddingBottom: spacing.md,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // Translucent to let the header's dominant color through (Spotify).
    backgroundColor: colors.highlight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    paddingVertical: 0,
  },
  searchCancel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  noResults: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  addBox: {
    width: 48,
    height: 48,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  resumeText: { flex: 1 },
  resumeDetail: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  discHeader: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  discHeaderText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  header: {
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  coverCenter: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  subtitleLink: {
    color: colors.text,
    fontWeight: '700',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
  },
  artistPhoto: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Same weight and colour as the metadata under it: what the playlist says
  // about itself belongs with the rest of what it says, not above it as a
  // second title.
  description: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  // The row keeps the gap the line used to keep for itself, so a header with
  // no badge sits exactly where it always did.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
  // `flexGrow: 0` or the row would stretch to fill the header column.
  genres: { flexGrow: 0, marginTop: spacing.sm },
  genresContent: { gap: spacing.sm, paddingRight: spacing.lg },
  genreChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surfaceHighlight,
  },
  genreText: { color: colors.textSecondary, fontSize: fontSize.xs },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  downloadWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  downloadProgress: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '600',
    minWidth: 32,
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  playButton: {
    backgroundColor: colors.accent,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  barTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
}));
