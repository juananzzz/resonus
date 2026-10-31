/**
 * Spotify-style header (dominant color gradient + cover that fades on scroll
 * and a collapsing fixed bar) and the song list. Shared by album and playlist
 * screens.
 */
import Icon from '@/components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  type FlatList,
  Keyboard,
  Platform,
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
import ReorderableList, {
  type ReorderableListDragStartEvent,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { type Song, type StarType } from '@/api/subsonic';
import { useCoverTint } from '@/hooks/useDominantColor';
import { useInsets } from '@/hooks/useInsets';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useSelectionMenu } from '@/hooks/useSelectionMenu';
import { useT } from '@/i18n';
import { artistTargets } from '@/lib/artistNav';
import { easedFade } from '@/lib/fade';
import { haptic } from '@/lib/haptics';
import { listPerf, reorderListPerf } from '@/lib/listPerf';
import { applyDrag } from '@/lib/listOrder';
import { useArtistPicker } from '@/store/artistPicker';
import { usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, restyled, spacing, themed, tracking } from '@/theme';
import { motion } from '@/theme/motion';
import { BackChevron } from './BackChevron';
import { TopBarBackground, TopBarPaint } from './BarBlur';
import { Cover, useCoverRadius } from './Cover';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';
import { FavoriteButton } from './FavoriteButton';
import { SelectionBar, type SelectionAction } from './SelectionBar';
import { DragTrackRow, TrackRow } from './TrackRow';

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
export const TOPBAR_H = 48;
/** The round play button in the header: its size, and the share of it the
 *  bar holds once it reaches the bar (half inside it, half below its edge). */
const PLAY_SIZE = 56;
/** Height of the hidden search bar ("Find in playlist" Spotify style),
 *  including the separation gap from the cover. */
const SEARCH_H = 72;
/** How far the wide cover's gradient runs: from the picture's lower edge,
 *  through the title and the buttons, arriving at the page's own colour
 *  around the play button ("circa", as the order asked for it). */
const WIDE_GRADIENT_H = 240;
/** How far above the content the accent reaches: iOS reveals that strip on a
 *  pull-down bounce, and without it the page background would flash where the
 *  cover's own colour belongs. Tall enough for any pull; one view, no paint
 *  cost at rest, where it hangs off screen. */
const OVERSCROLL_H = 1200;
/** Lines of the description shown before "Show more". */
const DESCRIPTION_LINES = 2;

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
   * What the list says about itself (a playlist's or an album's description),
   * above the metadata. Two lines, with "Show more" under them when there is
   * more: the words say the tap is there, which is what a bare cut text never
   * did. Whoever wants the header quiet turns it off in Settings › Appearance › Lists & albums.
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
  /**
   * Full-bleed cover across the top (the radio's): edge to edge from the very
   * top of the display, cropped to `height`, with the gradient starting at
   * its lower edge instead of running behind it. Clamped inside so it always
   * ends a little above where the square cover would; the rows keep their own
   * width, only the picture takes the whole screen.
   */
  wideCover?: {
    /** Albums keep the whole width-sized cover; radio headers keep their existing clamp. */
    preserveHeight?: boolean;
    height: number;
    render: (width: number, height: number, visible: boolean) => ReactNode;
  };
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
  favorite?: { id: string; type: StarType; starred: boolean; podcast?: true };
  /**
   * Podcast episodes: the ids the user has hearted in SQLite, so each row can
   * light its own heart. Passed in by the podcast screen (which already reads
   * them); absent for albums/playlists, whose rows use the server's list.
   */
  podcastFavIds?: Set<string>;
  /**
   * Podcast episodes on the show's screen: per-episode description, publish
   *  date and whether the episode arrived with the show's last sync, keyed by
   *  episode id, so each row can show them (see `TrackRow`'s `episode`). The
   *  screen builds it once from the episodes it already holds; absent for
   *  albums and playlists, whose rows keep the artist line.
   */
  episodeInfo?: Map<string, { description?: string; publishedAt?: number; fresh: boolean; played: boolean }>;
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
  addAction?: { label: string; icon?: keyof typeof Icon.glyphMap; onPress: () => void };
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
    /**
     * Where the order of the list is the app's to rewrite (a playlist): its rows
     *  live under the engine whose rows answer a hold by travelling, for the
     *  whole life of the screen, and the screen is handed the whole new sequence
     *  when it decides to keep it. `serverOrder` says whether the view on screen
     *  is the order the server keeps - the only view a row may be moved in, since
     *  moving a row in an A-Z or Recently-added view would write that view back
     *  as a sort the hand never asked for and cannot undo. Outside a selection a
     *  vertical drag is the list's scroll, and the row's own sideways swipe is a
     *  pan that would fight the list's (#279). `openRef` is the way in from the
     *  screen's ⋯ menu: it opens the selection, with nothing marked.
     */
    reorder?: {
      onSave: (songIds: string[]) => void;
      serverOrder: boolean;
      openRef?: MutableRefObject<() => void>;
    };
  };
  /** `opts` goes straight to `playQueue`: the shuffle button asks for the list
   *  dealt, which the screen owning the songs is the one who can request. */
  onPlay: (startIndex: number, opts?: { shuffled?: boolean }) => void | Promise<void | boolean>;
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
  wideCover,
  accentColor,
  songs,
  currentId,
  numbered,
  discHeaders,
  favorite,
  podcastFavIds,
  episodeInfo,
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
}: Props) {
  const router = useRouter();
  const t = useT();
  const insets = useInsets();
  const { width: screenW, height: screenH } = useScreenSize();
  // The bar's two ends: the back chevron on the left, the play button on the
  // right, and the button is the wider of the two. The title takes the larger
  // of the clearances on *both* sides, so a long name stops short of the
  // button instead of running under it, and the name itself still sits in the
  // middle of the screen rather than a button's width to the left of it.
  const titleInset = centredPadding(screenW, spacing.lg) + PLAY_SIZE + spacing.md;
  const bottomPad = useScreenBottomPadding();
  const tint = useCoverTint(coverUri, true);
  const dominant = tint.color;
  // A cover read for the first time fades its tint in over the page, instead
  // of the header being painted the plain grey and jumping to the colour a
  // moment later. One already read is there from the first frame.
  const tintIn = useRef(new Animated.Value(tint.known ? 1 : 0)).current;
  useEffect(() => {
    if (!tint.known) return;
    Animated.timing(tintIn, { toValue: 1, duration: motion.duration.fade, useNativeDriver: true }).start();
  }, [tint.known, tintIn]);
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
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionHasMore, setDescriptionHasMore] = useState(false);
  /** Last real scroll offset (the gesture only reveals at the top). */
  const lastOffsetY = useRef(0);
  /** The offset the reorderable engine last handed over, so its worklet can
   *  skip the JS hop for a scroll that did not move. */
  const lastScrollWritten = useSharedValue(0);
  const searchH = useRef(new Animated.Value(0)).current;
  const searchBar = !!searchable && songs.length > 0;

  // ── The play button ──────────────────────────────────────────────────────
  // The button is drawn outside the list, over the bar: it follows the place
  // it has in the header and, on reaching the bar, holds there - half in the
  // bar, half below it - so it never passes behind the bar and never fades
  // out from under the eye. What the header keeps is the place itself, laid
  // out (and measured) where the button would be.
  const headerRootRef = useRef<View>(null);
  const playBtnRef = useRef<View>(null);
  /** The button's own place in the scroll content (see the effect below). */
  const [playContentY, setPlayContentY] = useState(0);
  /** Whether the bar has reached it: from there the copy drawn over the bar
   *  takes the taps (the place itself is behind the bar by then) and is the
   *  one the screen reader is offered; before that it is the other way round,
   *  so the drags that start on the button still belong to the list. */
  const [overBar, setOverBar] = useState(false);
  const overBarRef = useRef(false);
  /** The scroll it happens at; `Infinity` until the place is known. */
  const behindAtRef = useRef(Infinity);
  /** Bumped when something moved the button without a render being able to
   *  see it (the search bar's height animation) or before it was laid out,
   *  so the measurement below runs again. Only the write is used: the
   *  effect reads no dependencies, any render will do, and this is what
   *  makes one happen. */
  const [, setMeasureTick] = useState(0);
  const measureRetries = useRef(0);

  // `setRevealed` is async: the gesture fires `onChange` many times per drag,
  // and several would pass the `!revealed` guard before the re-render, each
  // triggering haptic. The ref updates instantly and stops the rest.
  const revealedRef = useRef(false);
  /** Whether a row is under a hand mid-drag, which is what tells the reveal
   *  below that a pull down belongs to the row and not to the search bar. The
   *  engine says both ends of it - see `dragStarted` and `dragEnded`, which the
   *  list below hands its events to. */
  const dragArmed = useRef(false);

  function revealSearchBar() {
    if (revealedRef.current) return;
    revealedRef.current = true;
    haptic('light');
    setRevealed(true);
    Animated.timing(searchH, {
      toValue: SEARCH_H,
      duration: motion.duration.fade,
      useNativeDriver: false,
      // The header (and the play button in it) moves down as this runs, and
      // nothing re-renders when it lands: the measure below is told here.
    }).start(() => setMeasureTick((v) => v + 1));
  }

  function collapseSearchBar() {
    revealedRef.current = false;
    setRevealed(false);
    Animated.timing(searchH, {
      toValue: 0,
      duration: motion.duration.fade,
      useNativeDriver: false,
    }).start(() => setMeasureTick((v) => v + 1));
  }

  /**
   * The half of the reveal a worklet cannot answer for: a pan this list owns is
   *  also the drag a row rides, so the pull that reveals the bar is only the
   *  one that is not moving a row, is not a search already open, and starts
   *  where the page is still at the top.
   */
  function revealIfAtTop() {
    if (!searchBar || searching || revealedRef.current) return;
    if (dragArmed.current) return;
    if (lastOffsetY.current <= 1) revealSearchBar();
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

  /**
   * The same reveal, for the engine that owns the pan of its own area.
   *
   *  The reorderable list wraps itself in `Gesture.Simultaneous(Gesture.Native(),
   *  pan)`, so a detector of ours around the list would sit above the library's
   *  and never see a drag — the app hands this pan to the library instead, as
   *  its `panGesture`, and the library decorates it with its own `onBegin`,
   *  `onUpdate`, `onEnd` and `onFinalize`, all worklets (`ReorderableListCore.tsx:346`).
   *  Two things follow. The answer has to live in the one slot the library does
   *  not take — `onChange` — and it has to be a worklet as well, because one
   *  recognizer runs on one thread: a `runOnJS(true)` pan leaves the library's
   *  worklet callbacks with nowhere to run, which is what made a row arm a drag
   *  and then never move. And the pan must not carry the upward `failOffsetY`
   *  the ordinary one uses to cancel a scroll — a drag that may travel up a
   *  list is the same pan — nor an `activeOffsetY`, which delays `onBegin` past
   *  the touchdown the library measures the drag from.
   *
   *  A worklet sees numbers, not the app's state, so it answers only the travel
   *  it can see and hands the rest of the decision over to JS.
   */
  const revealPanList = Gesture.Pan()
    .onChange((e) => {
      'worklet';
      if (e.translationY > 60) {
        scheduleOnRN(revealIfAtTop);
      }
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
  const reorderOpenRef = selection?.reorder?.openRef;
  useEffect(() => {
    if (reorderOpenRef) reorderOpenRef.current = () => setSelectedIds(new Set());
  });
  // Row that just entered selection via long-press. On release, the `onPress` of
  // that same gesture arrives with `selecting` already active and would undo the
  // selection; we discard it once. Reset in `onPressIn` (start of each press),
  // so no residue remains even if `onPress` doesn't fire after the long-press.
  const justLongPressed = useRef<string | null>(null);
  const allSelected = selecting && selectedIds.size === songs.length && songs.length > 0;

  /**
   * The reorderable engine's own view, for the one scroll it has to send back
   *  to the top when a search is cancelled (`cancelSearch`).
   */
  const dragListRef = useRef<FlatList<{ song: Song; index: number }>>(null);
  /**
   * What the drag surface is showing once a row has moved: each row carries its
   *  place in the screen's own list, so remove and add still find the song's
   *  real position after the row travelled. Keyed by that place rather than by
   *  the position on the list, for the same reason `rowKeys` is keyed. It is
   *  also the one answer to whether a row went anywhere at all: the engine
   *  reports a release only for a row that left the place it came down
   *  (ReorderableListCore.tsx:514), so null means no hand moved anything, and
   *  the bar's Save order reads the same thing the display does.
   */
  const [draggedRows, setDraggedRows] = useState<{ song: Song; index: number }[] | null>(null);
  /**
   * Whether the order of a drag whose row is still travelling has to be thrown
   *  away. The engine answers with that order inside the animation that carries
   *  the row into its new place - 200 ms after the finger left
   *  (ReorderableListCore.tsx:694) - so a hand that left the selection in the
   *  same breath clears the order first and is handed it back afterwards, which
   *  would make the next selection offer a Save order over an order the hand
   *  already abandoned.
   */
  const dropReorder = useRef(false);

  // The order a hand made belongs to the view that offered the drag. The view is
  //  a preference a hand changes by tapping the header's ⇅, and the rows under
  //  the new one are a different order - an order that was never saved exists
  //  only on screen, so under a view that no longer offers a drag it is gone,
  //  and switching the view back does not bring an order the hand arranged
  //  before back onto the screen.
  const serverOrder = selection?.reorder?.serverOrder;
  useEffect(() => {
    setDraggedRows(null);
  }, [serverOrder]);

  /**
   * Leaving selection mode. An order the hand made by dragging only ever exists
   * once it is saved — saving is the one thing that writes it to the server —
   * so leaving without saving is the same as never having moved the row.
   */
  function exitSelection() {
    setSelectedIds(null);
    setDraggedRows((cur) => (cur === null ? cur : null));
    // And nothing may put an order back for a drag that is still travelling: the
    //  engine answers 200 ms after the release (see `dropReorder`).
    dropReorder.current = true;
    // Leaving is also the release of whatever row was under the hand: the flag
    //  that says a row is under a hand is cleared by that row's own press, and
    //  a drag that was cancelled mid-way leaves no press behind it, which would
    //  otherwise keep the search bar's reveal from answering for the rest of the
    //  screen. The hand that left is a hand, so its press is discarded as well.
    dragArmed.current = false;
    justLongPressed.current = null;
    // Nothing to put back in step any more: the engine does not change when the
    // selection leaves, nor when the view is switched, so the list that answers
    // for `scrollY` is the one that was answering for it before it came in, and
    // the page keeps its place.
  }

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
    exitSelection();
    if (sel.length > 0) fn(sel, indices);
  }

  const selectionMenu = useSelectionMenu(runSelectionAction, {
    favorites: selection?.favorites,
  });
  // What this list lets you do with a selection, each one built once: the bar
  // takes the ones that work on what is marked and, unless the drag's button
  // needs the room, adding to a playlist as well, and ⋯ holds what is left.
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
  const artRadius = useCoverRadius(art);
  // Where the square cover's content starts: the bar's own slice of the
  // screen plus the gap under it. The wide cover starts at zero instead -
  // it goes under the bar - but is clamped so it ends just above where this
  // one would, on every screen there is.
  const albumPadTop = insets.top + TOPBAR_H + spacing.md;
  const [wideVisible, setWideVisible] = useState(true);
  const wideH = wideCover ? wideCover.preserveHeight ? wideCover.height : Math.min(wideCover.height, albumPadTop + art - 24) : 0;
  const cover = wideCover || hideCover ? 0 : art;
  const collapse = wideCover ? wideH : hideCover ? 120 : art;
  // Down past the title and the buttons, so the header is the cover's colour
  // and not only the space around the cover. The wide one runs from its own
  // picture's edge instead: the picture is what covers the space above.
  const gradientH = wideCover ? WIDE_GRADIENT_H : insets.top + TOPBAR_H + cover + 280;
  const band = searchable && !wideCover ? SEARCH_H * 4 : 0;
  const gradientTop = wideCover ? wideH : -band;
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

  // Where the play button sits in the scroll content: its distance from the
  // top of the list header, plus the padding the list starts with - which is
  // the same expression the list is padded by below, so the two cannot drift
  // apart. The wide cover needs no top padding: its picture is the top.
  const listPadTop = wideCover ? 0 : albumPadTop;

  // The two ends of that distance are read in window coordinates in the same
  // tick, so the scroll underneath them cancels out: the number is the same
  // whether the list is at rest or mid-fling. Adding the scroll offset by
  // hand instead would not be - the offset JS has is a frame behind whatever
  // is on screen, and a fling travels a long way in a frame.
  //
  // Measured after every render (the header moves for reasons a render knows
  // about: the description opening, the search bar's height landing) and
  // again when the search bar's animation ends, which no render sees.
  useLayoutEffect(() => {
    if (searching) return;
    const btn = playBtnRef.current;
    const head = headerRootRef.current;
    if (!btn || !head) return;
    let btnY: number | null = null;
    let headY: number | null = null;
    const both = () => {
      if (btnY === null || headY === null) return;
      const rel = btnY - headY;
      if (rel <= 0) {
        // Nothing laid out yet: the first frame, before the header has a
        // place to report. A few tries at most, then give up - a button that
        // never turns up is one that is not on screen.
        if (measureRetries.current < 5) {
          measureRetries.current += 1;
          requestAnimationFrame(() => setMeasureTick((v) => v + 1));
        }
        return;
      }
      measureRetries.current = 0;
      const y = listPadTop + rel;
      setPlayContentY((cur) => (Math.abs(cur - y) > 2 ? y : cur));
    };
    btn.measureInWindow((_bx, by) => {
      if (typeof by === 'number') {
        btnY = by;
        both();
      }
    });
    head.measureInWindow((_hx, hy) => {
      if (typeof hy === 'number') {
        headY = hy;
        both();
      }
    });
  });

  // The line the button holds on: centred on the bar's lower edge, so half of
  // it is in the bar and half of it is under it. Below it the button tracks
  // the header 1:1 (the interpolation's slope is the scroll's own), from there
  // on it does not move at all.
  const dockTop = insets.top + TOPBAR_H - PLAY_SIZE / 2;
  // The revealed search row is not scroll: it sits above the header and pushes
  // it down without the offset moving, so the button starts that much lower and
  // reaches the line that much later. Its height is animated from JS (a height
  // is not something the scroll's native driver does), which is why it travels
  // in a wrapper of its own below rather than in the interpolation.
  const searchShift = revealed ? SEARCH_H : 0;
  // The scroll at which the button's top reaches the bar's lower edge: from
  // there the bar is between it and the eye (and between it and the hand).
  const behindAt = Math.max(playContentY + searchShift - (insets.top + TOPBAR_H), 1);
  const dockAt = Math.max(playContentY + searchShift - dockTop, 1);
  const playDockY = scrollY.interpolate({
    inputRange: [0, dockAt],
    outputRange: [playContentY, dockTop - searchShift],
    // Left extends, right clamps or not: once docked the button goes no
    // further, but while the list is rubber-banded past the top the header
    // keeps moving down and the button has to move with it instead of sitting
    // still (#overscroll). While a selection is up the line is not held at
    // all: the same slope keeps running, so the button leaves with the
    // header instead of stopping at the bar - a selection's bar is the
    // selection's own controls, and a button that stopped there would sit
    // over them; it is drawn under the bar, so it slips behind it instead
    // (see the copy of the button drawn before the bar).
    extrapolateLeft: 'extend',
    extrapolateRight: selecting ? 'extend' : 'clamp',
  });

  // Which of the two circles shows. Until the bar reaches it, the one laid out
  // in the header: it is part of the list, so Android's overscroll stretch
  // (which moves no offset, so nothing driven by the offset can follow it)
  // takes it along with the buttons beside it. From there the copy over the
  // bar, sitting on exactly the same spot at the switch. Both on the native
  // driver, so the swap lands on one frame.
  const slotOpacity = scrollY.interpolate({
    inputRange: [behindAt - 1, behindAt],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const dockOpacity = scrollY.interpolate({
    inputRange: [behindAt - 1, behindAt],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // The threshold the listener reads, kept with what it depends on.
  useLayoutEffect(() => {
    behindAtRef.current = playContentY > 0 ? behindAt : Infinity;
    const should = playContentY > 0 && lastOffsetY.current >= behindAt;
    if (should !== overBarRef.current) {
      overBarRef.current = should;
      setOverBar(should);
    }
  }, [behindAt, playContentY]);

  /**
   * The reorderable engine's answer for the page's one scroll number.
   *
   *  Everything the page paints outside the list — the cover's fade, the bar's
   *  colour and its title, the play button's dock, the accent's parallax —
   *  follows `scrollY`, and it followed it only for the ordinary list. A list
   *  that does not answer for the number leaves the header painting a scroll
   *  that is no longer on screen: the cover stays at opacity 0 and never fades
   *  back, the bar is solid at the very top of the page, the button stays welded
   *  in the bar (#279 on the device). One number, one owner, whichever list is
   *  up — and the library hands this engine its own composed scroll handler
   *  (`ReorderableListCore.tsx:1145`), so the number leaves the worklet into
   *  JS once per scroll event, which is what the ordinary list's own listener
   *  already costs at throttle 16.
   */
  const dragScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      // A scroll event that answers a place already written is not worth a
      // hop across: the library fires this handler on every event it gets.
      if (Math.abs(y - lastScrollWritten.value) < 1) return;
      lastScrollWritten.value = y;
      scheduleOnRN(listScrolled, y);
    },
  });

  /**
   * What a scroll answers for, whichever list made it: where the page is now,
   *  whether that is deep enough to collapse the revealed search bar, and
   *  whether the bar has reached the play button - from there the copy drawn
   *  over the bar takes the taps and is the one the screen reader is offered.
   *  The ordinary list's listener runs on this side and answers with it
   *  directly; the reorderable engine's listener has to be a worklet to be
   *  accepted at all, which is why that one hands the answers across.
   */
  function scrolledTo(y: number) {
    lastOffsetY.current = y;
    if (wideCover) setWideVisible(y < wideH && !searching);
    // Scrolling down with the bar open collapses it.
    if (revealedRef.current && !searching && y > 30) collapseSearchBar();
    const should = playContentY > 0 && y >= behindAtRef.current;
    if (should !== overBarRef.current) {
      overBarRef.current = should;
      setOverBar(should);
    }
  }

  // The JS half of the above: this engine's listener is a worklet, so the
  // number has to be written here as well as read.
  function listScrolled(y: number) {
    scrollY.setValue(y);
    scrolledTo(y);
  }

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
    // Whichever engine is up holds the scroll; only one of the two is mounted.
    (listRef.current ?? dragListRef.current)?.scrollToOffset({ offset: 0, animated: false });
  }

  function shufflePlay() {
    if (songs.length === 0) return;
    // The queue itself comes out dealt; the shuffle mode is not touched. It
    // used to be turned on here, and since the mode is remembered between
    // sessions it stayed on for the next album someone pressed Play on.
    void onPlay(0, { shuffled: true });
  }

  /**
   * The engine the screen runs. A playlist whose order is the app's to rewrite
   *  holds its rows under the reorderable engine for the whole life of the
   *  screen, and not only while a hand is arranging them: swapping engines when
   *  the selection came in left one page carrying two lists and one scroll
   *  number, and that number answered for whichever list is no longer up - the
   *  cover, the bar and the play button painted a scroll the rows under them
   *  had not made (see `dragScroll`, and the six-frame climb that used to push
   *  a fresh list down to where the finger came down). One engine, one scroll,
   *  nothing to hand over.
   */
  const reorderEngine = !!selection?.reorder;
  /**
   * The rows the reorderable engine holds: the display order, each carrying its
   *  place in the screen's list, or the live search results. The engine does not
   *  swap when a selection comes in, so the search has to be visible in the data
   *  it is handed as well — the other engine takes `shownSongs` for the same
   *  reason one screen down.
   */
  const dragRows = useMemo(
    () =>
      filtered
        ? filtered.map((r) => ({ song: r.song, index: r.index }))
        : songs.map((song, index) => ({ song, index })),
    [filtered, songs],
  );

  /**
   * Where a hold on a row moves it: only while selecting, only where the view
   *  on screen is the order the server keeps (the screen says so, see
   *  `serverOrder`), only while not searching, and only where there is
   *  somewhere to travel - a drag needs two places, which a list of a single
   *  row does not have, and answering it here is what keeps the grip and the
   *  bar's button off a row the engine could only ever refuse.
   *
   *  Outside a selection a vertical drag is the list's scroll, and the row's
   *  own sideways swipe is a pan that would fight the list's; while searching,
   *  the rows shown are not the whole list, and moving part of a list through
   *  another part is not a thing that has a meaning.
   */
  const dragging =
    reorderEngine && selecting && !searching && serverOrder && dragRows.length > 1;

  /**
   * The order the hand made, as long as it is still an order of the rows on
   *  screen: the footer's suggestion chip adds to the list inside a selection, so
   *  a song can arrive after the drag made the order, and an order of rows that
   *  are no longer the list's is not an order of this list — saving it would
   *  write the songs missing from it out of the playlist. A length that no longer
   *  matches says it: the hand takes songs out with an action that leaves
   *  selection mode, and that clears the order, so a list growing under a hand is
   *  the only thing that can make an order stop fitting.
   */
  const dragOrder =
    draggedRows !== null && draggedRows.length === dragRows.length ? draggedRows : null;

  /**
   * The two ends of a hand on a row, which the engine reports rather than the
   *  app guessing: `startDrag` runs `onDragStart` only inside the branch that
   *  really started a drag (ReorderableListCore.tsx:1026 - an arm asked while
   *  another drag is still in flight is refused and says nothing), and a press
   *  never answers for the release of a drag at all, since the row rides inside
   *  that drag and its release does not reach the row's own Pressable. The app
   *  asked its own arm callback for both, which set the flag for the arms that
   *  were refused and left it standing for the rest of the screen once a row
   *  had moved (see `dragArmed`). The library's callbacks are worklets, so both
   *  ends hand their bookkeeping back to JS.
   *
   *  It answers with the rows the engine is holding: the ones on screen, which
   *  is `dragOrder` where a hand has made an order and `dragRows` otherwise —
   *  and that is why it sits below those two and `rowKeys`: the place a row
   *  lifted from is a place in the list on screen, and the key it answers with
   *  is that row's own.
   */
  function dragStarted(index: number) {
    dragArmed.current = true;
    // This drag is the hand's: an order it ends with is an order to keep.
    dropReorder.current = false;
    // The place the row lifted from, in the screen's own list, which is the key
    //  the row answers with: `index` counts the rows on the list, and a row that
    //  travelled still carries its old place.
    const place = (dragOrder ?? dragRows)[index]?.index;
    if (place != null) justLongPressed.current = rowKeys[place];
  }

  function dragEnded() {
    dragArmed.current = false;
  }

  /**
   * One row of the list, for both list engines: the reorderable one hands a row
   * to another place on the list, so the row is told where it sits in the
   * screen's own list and not only where it sits on the screen — everything the
   * rows answer with (the play button, the ⋯ menu, removing) still points at
   * the same song after the row travelled.
   *
   *  It is one row and nothing above it: what sits above a row (a disc header
   *  of a multi-disc album) is said where the list assembles its rows, since it
   *  is a part of the list's shape rather than of the row's.
   */
  function renderRow(song: Song, index: number, draggable: boolean) {
    const rowKey = rowKeys[index];
    // This episode's description and date, when the screen passed them
    // (only the show's own does); the row's identity is stable, so the
    // row's memo holds across repaints.
    const ep = episodeInfo?.get(song.id);
    // The hold that opens the selection. It marks nothing: the hand has only
    // said where a selection is to start, and the song it started on is one
    // the hand may not have meant to take, so the selection comes up with
    // nothing marked and the marks are the taps that follow. The press the
    // release brings is still discarded, so the same hold cannot mark it.
    const enterSelection =
      selection && !selecting
        ? () => {
            haptic('medium');
            setSelectedIds(new Set());
            justLongPressed.current = rowKey;
          }
        : undefined;
    const rowProps = {
      song,
      episode: ep,
      // With artwork visible the number is omitted: the album stays as
      // usual (only the artist's Popular shows number + cover).
      position: numbered && !showArtwork ? song.track ?? index + 1 : undefined,
      isCurrent: currentId === song.id,
      showArtwork,
      podcastFavIds,
      menuContext:
        playlistId
          ? { playlistId, index: playlistIndices ? playlistIndices[index] : index }
          : undefined,
      selecting,
      selected: !!selectedIds?.has(rowKey),
      onLongPress: enterSelection,
      onPressIn: () => {
        justLongPressed.current = null;
      },
      onPress: () => {
        // Discards the press that follows a hold the row was armed with: the one
        //  that opened a selection, and the release of a drag the row rode (see
        //  `dragStarted`) - an order the hand made is not a mark the hand made,
        //  and a drag that ticked the row it travelled would move what Remove and
        //  Download act on under a hand that never meant to.
        if (justLongPressed.current === rowKey) return;
        if (selecting) toggleSelect(rowKey);
        else onPlay(index);
      },
    };
    // A row of the reorderable engine keeps its swipe: outside a selection the
    // swipe is what queues the song, and the row's own handler sits below the
    // list's pan, which is what lets it have the finger. While a selection is
    // up the row turns its swipe off itself (see `TrackRow`'s `enabled`).
    // What a drag means for the list - that a row is under a hand, and that the
    // press whose release follows the arm belongs to the drag rather than to the
    // hand, so that an order the hand made is not a mark the hand made: a drag
    // that ticked the row it travelled would move what Remove and Download act
    // on under a hand that never meant to - is the engine's to say, through
    // `onDragStart` and `onDragEnd` on the list (see `dragStarted`). All the row
    // needs is the grip: the icon at its right edge that says it can travel, and
    // the arm for a hold on the row or on that icon.
    return draggable
      ? <DragTrackRow {...rowProps} grip={dragging} />
      : <TrackRow {...rowProps} />;
  }

  /** The whole list's footer, whichever list is on screen. */
  const listFooter = footer ? <>{footer}</> : null;

  /**
   * Keeping what the hand arranged: the button the drag arms. It leaves
   * selection mode like every other action, and hands the screen the whole
   * sequence, which is what writes it — an order is the list's, so the marks
   * play no part in it.
   */
  const saveOrder: SelectionAction | undefined = selection?.reorder
    ? {
        icon: 'swap-vertical',
        label: t('Save order'),
        onPress: () => {
          const rows = dragOrder ?? dragRows;
          const ids = rows.map((r) => r.song.id);
          exitSelection();
          selection.reorder!.onSave(ids);
        },
      }
    : undefined;

  /** The bar's copy of the drag's button: only where a row may answer a hold
   *  and the screen can write the order back. The room the bar gives to it is
   *  decided with it, which is why the two props below read this one value.
   *  It stays visible and dimmed until a row actually went somewhere, and only
   *  while that order still describes the rows on screen, which is what
   *  `dragOrder` answers for.
   */
  const dragButton =
    dragging && saveOrder ? { action: saveOrder, ready: dragOrder !== null } : undefined;

  // The play button over the bar. It follows the place laid out for it in the
  // header - the search row's height riding in the outer wrapper, the scroll
  // in the one inside it - until it reaches the bar's line, and holds there:
  // half in the bar, half below its lower edge. Drawn after the bar (below),
  // so it is in front of it. While a selection is up it is drawn before the
  // bar instead, and does not hold at the line at all, so the bar's colour and
  // its own controls stay over it and the button goes behind them with the
  // header (see `playDockY`). Until the bar reaches it, it is the header's own
  // circle that shows (see `slotOpacity`), and the taps and the screen reader
  // are the header's too.
  const playOverlay =
    searching || playContentY <= 0 ? null : (
      <Animated.View
        pointerEvents={overBar && !selecting ? 'auto' : 'none'}
        accessibilityElementsHidden={!overBar || selecting}
        importantForAccessibility={overBar && !selecting ? 'auto' : 'no-hide-descendants'}
        style={[styles.playDock, { right: centredPadding(screenW, spacing.lg) }]}
      >
        <Animated.View style={{ transform: [{ translateY: searchH }] }}>
          <Animated.View style={{ opacity: dockOpacity, transform: [{ translateY: playDockY }] }}>
            <Pressable
              style={[styles.playButton, { backgroundColor: colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel={t('Play')}
              onPress={() => songs.length > 0 && onPlay(0)}
            >
              <Icon name="play" size={28} color={colors.onAccent} />
            </Pressable>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );

  /**
   * The header above the rows, taken out of the list so both list engines
   *  mount it: it is the same furniture above the rows whichever way the
   *  rows can be answered, and a drag surface without it would be a cover
   *  and a title vanishing under the finger the moment the selection came
   *  in.
   */
  const listHeader = (
    <View>
      {searchBar ? (
        /* Collapsed = height 0 (invisible); the gesture reveals it. The clip
           goes in a no-padding container: any padding would impose a
           minimum height and show a sliver. */
        <Animated.View style={[styles.searchClip, { height: searchH }]}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Icon name="search" size={18} color={colors.textSecondary} />
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
                <Icon name="close-circle" size={18} color={colors.textSecondary} />
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
          with the bar, which is what Spotify does. It is also what the
          button's place is measured against, and not the wrapper: the
          search row above it is not scroll, and its height travels with
          the button on its own (see `searchShift`). */}
      {searching ? null : (
    <View ref={headerRootRef} style={styles.header}>
      {wideCover ? (
        /* Paint above the first pixel: the pull-down bounce reveals
           whatever sits above the content - the page background by
           default - and on the radio that strip must stay the accent,
           the cover's own colour. Zero net layout: it hangs off the top
           of the header, off screen until a pull uncovers it. */
        <View
          pointerEvents="none"
          style={{
            width: screenW,
            height: OVERSCROLL_H,
            marginTop: -OVERSCROLL_H,
            marginHorizontal: -centredPadding(screenW, spacing.lg),
            backgroundColor: headerColor,
          }}
        />
      ) : null}
      {wideCover ? (
        /* The picture at the very top, pulled out of the rows' inset to
           the edges of the display: it fades with the scroll the way
           the square one does, and the bar rides over it. */
        <Animated.View
          style={[
            styles.wideCover,
            {
              width: screenW,
              height: wideH,
              opacity: coverOpacity,
              marginHorizontal: -centredPadding(screenW, spacing.lg),
            },
          ]}
        >
          {onCoverPress ? (
            <Pressable
              onPress={onCoverPress}
              accessibilityRole="imagebutton"
              accessibilityLabel={t('View cover')}
            >
              {wideCover.render(screenW, wideH, wideVisible)}
            </Pressable>
          ) : (
            wideCover.render(screenW, wideH, wideVisible)
          )}
        </Animated.View>
      ) : hideCover ? null : (
        <Animated.View style={[styles.coverCenter, { opacity: coverOpacity }]}>
          {/* Android draws no shadow from a transparent view's content
              the way iOS does: there it is a box shadow the size and
              shape of the cover. */}
          <View
            style={
              Platform.OS === 'android'
                ? { borderRadius: artRadius, boxShadow: '0px 10px 32px rgba(0, 0, 0, 0.45)' }
                : null
            }
          >
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
          </View>
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
        <View>
          {/* The whole text, drawn invisibly: with `numberOfLines` set,
              onTextLayout only reports the lines that survived, so the
              copy below can't tell whether anything was cut. */}
          <Text
            style={styles.descriptionMeasure}
            onTextLayout={(e) =>
              setDescriptionHasMore(e.nativeEvent.lines.length > DESCRIPTION_LINES)
            }
          >
            {description.trim()}
          </Text>
          <Text
            style={styles.description}
            numberOfLines={descriptionExpanded ? undefined : DESCRIPTION_LINES}
          >
            {description.trim()}
          </Text>
          {descriptionHasMore ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setDescriptionExpanded((v) => !v)}
              style={styles.descriptionMore}
              hitSlop={spacing.sm}
            >
              <Text style={styles.descriptionMoreText}>
                {descriptionExpanded ? t('Show less') : t('Show more')}
              </Text>
            </Pressable>
          ) : null}
        </View>
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
              podcast={favorite.podcast ? { kind: 'channel', channelId: favorite.id } : undefined}
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
                <Icon
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
              <Icon name="swap-vertical" size={24} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          {onMenu ? (
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('More options')}
              onPress={onMenu}
            >
              <Icon name="ellipsis-horizontal" size={26} color={colors.textSecondary} />
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
            <Icon
              name="shuffle"
              size={26}
              color={shuffleActive ? colors.accent : colors.textSecondary}
            />
          </Pressable>
          {/* The button while it is still in the header: drawn here so
              it moves with the list, overscroll included, and taking the
              taps from there down - a dragger that starts on it is the
              list's, as it always was. */}
          <Pressable
            ref={playBtnRef}
            style={styles.playSlot}
            collapsable={false}
            accessibilityElementsHidden={overBar && !selecting}
            importantForAccessibility={
              overBar && !selecting ? 'no-hide-descendants' : 'auto'
            }
            accessibilityRole="button"
            accessibilityLabel={t('Play')}
            onPress={() => songs.length > 0 && onPlay(0)}
          >
            <Animated.View
              style={[
                styles.playButton,
                { backgroundColor: colors.accent, opacity: slotOpacity },
              ]}
            >
              <Icon name="play" size={28} color={colors.onAccent} />
            </Animated.View>
          </Pressable>
        </View>
      </View>
  
      {addAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={addAction.onPress}
          style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
        >
          <View style={styles.addBox}>
            <Icon
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
  );

  return (
    <View style={styles.root}>
      <View style={{ flex: 1 }}>
      {/* Dominant color gradient; scrolls with 1:1 parallax. Hidden in search
          mode to keep the screen flat black. It stays where the rows can be
          dragged: the colour is what says which playlist this is, and an
          accent that went out the moment the selection came in would leave a
          accent that went out the moment the selection came in would leave a
          black page under a hand that is about to arrange that playlist. The
          tint follows `scrollY` whichever list made it, the reorderable one
          included - its handler answers for the number the same way the
          ordinary list's listener does (see `dragScroll`, and the reads the
          two share in `scrolledTo`). */}
      {searching ? null : (
        <Animated.View
          pointerEvents="none"
            style={[
              styles.gradientWrap,
              {
                top: gradientTop,
                height: gradientH + band,
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
              // And follows the scroll 1:1, natively - but never below zero:
              // an over-scroll drags `scrollY` negative, and the gradient
              // moving down with it would uncover the page's own colour where
              // the accent's band sits. Held at the top, the bounce reveals
              // the accent instead of the background. The tint itself fades
              // in with `tintIn`, rather than flashing grey first.
              {
                opacity: tintIn,
                transform: [
                  {
                    translateY: scrollY.interpolate({
                      inputRange: [-1e7, 0, 1e7],
                      outputRange: [0, 0, -1e7],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          >
            {/* Color band above the gradient: when the search bar is revealed,
                content shifts down SEARCH_H px and this fills the gap at the top.
                Inside the view's own bounds: hanging above them, Android left
                the gap grey. */}
            {band > 0 ? (
              <View style={[styles.gradientAbove, { height: band, backgroundColor: headerColor }]} />
            ) : null}
            <LinearGradient
              {...easedFade(headerColor, colors.background)}
              style={[StyleSheet.absoluteFill, { top: band }]}
            />
          </Animated.View>
        </Animated.View>
      )}

      {/* The rows of a playlist whose order is the app's to rewrite: the
          library's reorderable engine, under the same header, for the whole
          life of the screen. Its rows answer a hold by going to the list's own
          pan while a selection is up — outside one the same vertical drag is a
          scroll, which is what `dragEnabled` says — and the row keeps answering
          a swipe with its own handler, which sits below the list's pan and so
          has the finger. The bar carries the button that keeps the new order.
          The pull-down that reveals the search bar is the same gesture here as
          anywhere else: it is handed to the list as its `panGesture`, since the
          library owns the pan of this area and the app's own detector would sit
          above it and never see the drag. */}
      {reorderEngine ? (
        <ReorderableList
          {...reorderListPerf}
          ref={dragListRef}
          onScroll={dragScroll}
          dragEnabled={dragging}
          // The library owns the pan of this area, so the app's reveal goes to
          // it rather than fighting it from a detector above (see `revealPanList`
          // for why this pan answers in a worklet and carries no `failOffsetY`).
          panGesture={revealPanList}
          // The rows are told where they sit in the screen's list: one engine is
          // up the whole time, so the measurements the drop needs — the index a
          // row lifts from, how far it travelled, the place it drops into — are
          // the measurements of cells this list has laid out itself, and the
          // list is never asked to believe a promise about rows it has not
          // mounted, which is what used to stop it measuring at all.
          // The dragged order is the display only where the drag is offered: a
          //  search shows the rows that match, and an order the hand made is an
          //  order over the whole list, not over the rows that match.
          data={dragging ? dragOrder ?? dragRows : dragRows}
          keyExtractor={(row) => rowKeys[row.index]}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.list,
            {
              paddingTop: listPadTop,
              paddingBottom: bottomPad,
              // Centred on a wide screen instead of stretched across it: a row
              // whose title is at one edge and whose duration is at the other,
              // a hand's width apart, is a phone screen that was pulled (#131).
              paddingHorizontal: centredPadding(screenW, spacing.lg),
            },
          ]}
          extraData={selectedIds}
          renderItem={({ item }) => renderRow(item.song, item.index, true)}
          ListEmptyComponent={
            filtered ? (
              <Text style={styles.noResults}>{t('No results for “{q}”', { q: query.trim() })}</Text>
            ) : emptyState ? (
              <>{emptyState}</>
            ) : null
          }
          ListFooterComponent={listFooter}
          ListHeaderComponent={listHeader}
          onReorder={({ from, to }: ReorderableListReorderEvent) => {
            // The engine reports a release only for a row that left the place it
            //  came down (ReorderableListCore.tsx:514), so an event here is a
            //  row that moved: what the screen shows becomes the order the hand
            //  made, which is what the bar's Save order then writes back.
            if (dropReorder.current) {
              // Unless the hand already left: the order is still arriving from a
              //  drag that is no longer the screen's to keep (see `exitSelection`,
              //  which is what says so).
              dropReorder.current = false;
              return;
            }
            setDraggedRows((cur) => applyDrag(cur ?? dragRows, from, to));
          }}
          // The engine saying a drag started: what the app needs to know is that
          //  a row is under a hand, which is `startDrag`'s own branch - it is
          //  reached only when a drag really started (an arm asked while another
          //  drag is still in flight is refused before it), so the flag has one
          //  answer for both the pull down that must not open the search bar and
          //  the `onPress` that must not mark the row that travels.
          onDragStart={(e: ReorderableListDragStartEvent) => {
            'worklet';
            scheduleOnRN(dragStarted, e.index);
          }}
          // The same hand leaving: the row is no longer under it, and the pull
          //  down that finds a song answers again. Only the release says so -
          //  the row sits inside the library's drag and the release of that drag
          //  never reaches the row's own Pressable, which is what left the flag
          //  standing for the rest of the screen after any drag (see
          //  `dragArmed`).
          onDragEnd={() => {
            'worklet';
            scheduleOnRN(dragEnded);
          }}
        />
      ) : (
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
              paddingTop: listPadTop,
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
            // The same answers the reorderable engine hands across: this
            //  listener runs on this side already, and the event mapping above
            //  wrote `scrollY` for it.
            listener: (e: NativeSyntheticEvent<NativeScrollEvent>) =>
              scrolledTo(e.nativeEvent.contentOffset.y),
          })}
          ListHeaderComponent={listHeader}
          extraData={selectedIds}
          renderItem={({ item, index }) => {
            // With an active filter, `index` is the position in results; everything
            // else (play, remove, numbering) uses the original position.
            const origIndex = filtered ? filtered[index].index : index;
            const row = renderRow(item, origIndex, false);
            // A disc header goes above the row it came with, and only where the
            //  rows are the whole list: over the rows that match, a header would
            //  say a disc whose other songs did not match, which the list on
            //  screen does not hold.
            const disc = filtered ? undefined : discHeaders?.[origIndex];
            return disc ? (
              <>
                <DiscHeader label={disc} />
                {row}
              </>
            ) : (
              row
            );
          }}
          ListEmptyComponent={
            filtered ? (
              <Text style={styles.noResults}>{t('No results for “{q}”', { q: query.trim() })}</Text>
            ) : emptyState ? (
              <>{emptyState}</>
            ) : null
          }
          ListFooterComponent={listFooter}
        />
        </GestureDetector>
      )}
      </View>

      {/* While a selection is up the button is drawn under the bar: the bar of
          a selection is the selection's own colour and controls, and nothing
          of the header may sit over them. It is not held there any more - the
          line it used to stop at runs on, so the button slips behind the bar
          with the header instead of being cut by it (see `playDockY`). */}
      {selecting ? playOverlay : null}

      {/* Fixed top bar: the background and title appear on collapse. In
          selection mode it's replaced by ✕ + counter + select all. */}
      <View style={[styles.bar, { height: insets.top + TOPBAR_H, paddingTop: insets.top }]}>
        {selecting ? (
          <>
            {/* The bar of a selection keeps the header's colour at every
                scroll: what changes is what it says, not the bar. The
                header's own title scrolls behind it and is hidden here, so
                the bar never thins over the list under it - and it is laid
                flat rather than the one above pinned opaque, which is a
                style an animation has nothing to hold (see `TopBarPaint`). */}
            <TopBarPaint color={headerColor} />
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('Close')}
              onPress={exitSelection}
            >
              <Icon name="close" size={26} color={colors.text} />
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
              <Icon
                name="checkmark-done"
                size={24}
                color={allSelected ? colors.accent : colors.text}
              />
            </Pressable>
          </>
        ) : (
          <>
            <TopBarBackground color={headerColor} opacity={barBgOpacity} />
            <BackChevron size={28} label={t('Close')} />
            <Animated.Text
              style={[
                styles.barTitleCentered,
                {
                  top: insets.top + 10,
                  opacity: barContentOpacity,
                  left: titleInset,
                  right: titleInset,
                },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {title}
            </Animated.Text>
          </>
        )}
      </View>

      {/* Over the bar everywhere else: outside a selection this is the copy of
          the button that belongs to the bar, held at its line, so it has to be
          in front of it; a selection draws its travelling copy above the bar
          instead (above). */}
      {selecting ? null : playOverlay}

      {selecting ? (
        <SelectionBar
          count={selectedIds.size}
          // Taking songs out of this list where that is a thing, and downloading
          //  where it isn't. Whichever one loses the slot is the one behind ⋯.
          // Adding to a playlist keeps a slot of its own except where the drag's
          //  button is drawn: an order belongs to the list rather than to what
          //  is marked, so that button sits beside the marked songs' actions,
          //  and the bar would be four buttons wide with adding on it as well.
          //  The trade is this bar's own and not the bar's rule - a list whose
          //  rows never answer a hold has no such button and keeps adding where
          //  it was, as the genre and artist screens next to it do.
          actions={[
            ...(dragButton ? [] : addToAction),
            ...(removeAction.length > 0 ? removeAction : downloadAction),
          ]}
          menu={[
            ...(dragButton ? addToAction : []),
            ...(removeAction.length > 0 ? downloadAction : []),
            ...selectionMenu.actions,
          ]}
          reorder={dragButton}
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
    top: 0,
    left: 0,
    right: 0,
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
    // A capsule with Round, a rounded rectangle with Pointier.
    borderRadius: restyled(radius.pill, radius.md),
    paddingHorizontal: spacing.lg,
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
    fontWeight: '500',
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
  addLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
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
    fontWeight: '500',
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
    // The big cover sits on the page rather than being printed on it: a soft
    // shadow under it and to the sides, less over the top. The offset is what
    // puts the weight at the bottom, and the radius what softens it - one
    // shadow, both edges handled. It fades out with the cover it belongs to.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
  },
  wideCover: {
    // No corners and no shadow: the picture is printed into the page itself,
    // from the very top edge, and the rows below come back into their inset.
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    letterSpacing: tracking.display,
    fontWeight: '500',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  subtitleLink: {
    color: colors.text,
    fontWeight: '500',
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
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  // Same weight and colour as the metadata under it: what the playlist says
  // about itself belongs with the rest of what it says, not above it as a
  // second title.
  description: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  // Same text, same width, no paint: only here to count the lines.
  descriptionMeasure: {
    position: 'absolute',
    opacity: 0,
    pointerEvents: 'none',
    width: '100%',
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  // Under the text, never over it: the header sits on the dominant color
  // gradient, so a patch of the plain background would show as a rectangle.
  descriptionMore: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  descriptionMoreText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
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
    borderRadius: radius.pill,
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
    fontWeight: '500',
    minWidth: 32,
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  playButton: {
    backgroundColor: colors.accent,
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The place the button takes in the header.
  playSlot: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
  },
  // The button over the bar: only the column's `right` comes with each
  // render; the scroll and the search row's height travel in wrappers.
  playDock: {
    position: 'absolute',
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
    fontWeight: '500',
  },
  barTitleCentered: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    // Both ends come with each render (they need the screen's width): the same
    // clearance either side is what puts the name in the middle of the screen.
    textAlign: 'center',
    includeFontPadding: false,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
}));

