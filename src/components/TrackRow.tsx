/** Song row inside a list (album, playlist, search results). */
import Icon from '@/components/Icon';
import { memo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useReorderableDrag } from 'react-native-reorderable-list';

import { COVER, songCoverUrl, star } from '@/api/data';
import { episodeHeart, heartedSong, NO_FAVORITES, togglePodcastHeart } from '@/api/podcasts';
import { streamReachable, type Song } from '@/api/subsonic';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { formatDuration, formatEpisodeDate } from '@/lib/format';
import { applyStarChange, resyncFavorites, unstarWithUndo } from '@/lib/favoritesCache';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSongMenu, type SongMenuContext } from '@/store/songMenu';
import { useSettings, type SwipeAction } from '@/store/settings';
import { haptic } from '@/lib/haptics';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, DIM_OPACITY, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { Cover, useCoverRadius } from './Cover';
import { usePressFeedback } from '@/hooks/usePressFeedback';
import { bump } from '@/lib/perfLog';
import { PlayingBars } from './PlayingBars';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';
import { FavoriteButton } from './FavoriteButton';

interface Props {
  song: Song;
  /**
   * Optional number on the left (e.g. the track number on an album). Coexists
   * with the cover: number then cover (Spotify's "Popular" style).
   */
  position?: number;
  isCurrent?: boolean;
  /** Playlist context (to allow "remove from list" in the menu). */
  menuContext?: SongMenuContext;
  /**
   * Allows showing the heart for favorited songs (default true). Only appears
   * if the song is marked as favorite (Spotify style). Offline passes `false`
   * (no server favorites).
   */
  showFavorite?: boolean;
  /**
   * Podcast episodes: the ids the user has hearted in SQLite. When the song is
   * an episode (`song.podcastChannelId`), its heart reads from here instead of
   * the server's favorites list.
   */
  podcastFavIds?: Set<string>;
  /**
   * Podcast episode on the show's screen: its description, its publish date and
   *  whether it came over with the show's last sync. When present the row drops
   *  the artist line — the show is already the screen's title, so repeating it
   *  under every episode says nothing — and instead shows the title over two
   *  lines, the full description, and a line with the duration and the date,
   *  wearing the dot and the word "new" behind that date when the episode is
   *  one of the new arrivals: the words a listener needs to pick an episode out
   *  of a feed. Absent for albums, playlists and search.
   */
  episode?: { description?: string; publishedAt?: number; fresh?: boolean; played?: boolean };
  /** Shows the ⋯ menu button (default true; works offline too). */
  showMenu?: boolean;
  /** Shows the mini album cover on the left (Spotify style). */
  showArtwork?: boolean;
  /** Multi-select mode: check circle and no swipe/menu/heart. */
  selecting?: boolean;
  /**
   * Swipe actions (default true). Off inside a horizontal carousel, where a
   * sideways swipe is meant to scroll it, not to queue the song under the finger.
   */
  swipeable?: boolean;
  /** Marked in selection mode. */
  selected?: boolean;
  onLongPress?: () => void;
  onPress: () => void;
  /** Press start (before onPress/onLongPress); used by the list to discard the
   *  onPress that follows the long-press to enter selection. */
  onPressIn?: () => void;
  /**
   * The grip a row shows at its right edge, on a list whose rows answer a hold
   *  by travelling: it is what says the row can travel, where the ⋯ used to be
   *  — selection takes that away, so nothing on the row shifts when the grip
   *  takes its place. Coming down on it arms the drag right away, without the
   *  wait a hold on the row itself has to earn before it counts as one, and the
   *  row keeps answering a hold for the same drag: the grip is the shorter way
   *  into one gesture, and the wider row is what a hand aims at.
   */
  grip?: boolean;
  /**
   * The arm itself, made where the row is mounted: the library's drag handler
   *  belongs to the cell the row sits in, which only the cell's own render can
   *  read (see `DragTrackRow`). Used for the grip's touchdown and, while `grip`
   *  is set, for a hold on the row.
   */
  dragHold?: () => void;
}

/** Swipe strip icon according to the configured action. */
const SWIPE_ICON: Record<Exclude<SwipeAction, 'off'>, keyof typeof Icon.glyphMap> = {
  queue: 'list',
  next: 'play-forward',
  favorite: 'heart',
  menu: 'ellipsis-horizontal',
};

/** Short label shown on the strip alongside the icon. */
const SWIPE_LABEL: Record<Exclude<SwipeAction, 'off'>, string> = {
  queue: 'Queue',
  next: 'Next',
  favorite: 'Favorite',
  menu: 'More',
};

/** Lines of an episode's show notes before "Show more" takes over (see `TrackRow`). */
const EPISODE_DESCRIPTION_LINES = 2;
/** Characters of the notes measured for that: far more than two lines hold
 *  at any width a phone has. */
const EPISODE_MEASURE_CHARS = 600;

/**
 * Action strip that peeks out behind the row during swipe. Fades in as the
 * user drags, scales the icon once the threshold is crossed so the user knows
 * the action is confirmed, and shows a short label alongside the icon.
 */
function SwipeActionPanel({
  progress,
  icon,
  label,
  side,
}: {
  progress: SharedValue<number>;
  icon: keyof typeof Icon.glyphMap;
  label: string;
  /** Side where the strip peeks out: the icon sticks to the edge it enters from. */
  side: 'left' | 'right';
}) {
  // The strip fades in gradually as the finger moves (0→1 over first 30% of
  // travel) and the icon+label pop at 1.1× scale once fully confirmed (>0.9).
  const stripStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: Math.min(1, p / 0.3),
    };
  });
  const contentStyle = useAnimatedStyle(() => {
    const confirmed = progress.value >= 0.9;
    return {
      transform: [{ scale: confirmed ? 1.1 : 1 }],
    };
  });
  return (
    <Reanimated.View
      style={[
        styles.swipeAction,
        { alignItems: side === 'left' ? 'flex-start' : 'flex-end' },
        stripStyle,
      ]}
    >
      <Reanimated.View style={[styles.swipeActionContent, contentStyle]}>
        <Icon name={icon} size={20} color={colors.onAccent} />
        <Text style={styles.swipeActionLabel}>{label}</Text>
      </Reanimated.View>
    </Reanimated.View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function TrackRowBase({
  song,
  position,
  isCurrent,
  menuContext,
  showFavorite = true,
  showMenu = true,
  showArtwork = false,
  selecting = false,
  swipeable = true,
  selected = false,
  onLongPress,
  onPress,
  onPressIn,
  podcastFavIds,
  episode,
  grip,
  dragHold,
}: Props) {
  bump('render · TrackRow');
  const openMenu = useSongMenu((s) => s.open);
  const t = useT();
  const press = usePressFeedback();
  // Memoized below, and with its own `propsEqual` at that: the list repainting
  // does not reach the rows, so each one asks for the appearance itself.
  useTheme();
  const showDuration = useSettings((s) => s.showSongDuration);
  const showRating = useSettings((s) => s.showListRating);
  const swipeAction = useSettings((s) => s.swipeAction);
  const swipeLeftAction = useSettings((s) => s.swipeLeftAction);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const toast = useToast((s) => s.show);
  const swipeRef = useRef<SwipeableMethods>(null);
  // An episode's show notes open and close like a podcast's description: the
  // first `EPISODE_DESCRIPTION_LINES` of them at rest, the whole thing once
  // "Show more" is tapped. Per row, so expanding one episode does not expand
  // the ones above and below it — and keyed to the episode, because the row is
  // not a new component when the list hands it another one: scrolling
  // recycles the row and `propsEqual` below is there exactly so that a change
  // of song does not re-render it, which leaves a plain boolean behind on the
  // episode that used to sit here. An episode nobody tapped would then come
  // back unfolded, offering "Show less". One state, carrying the id, so a row
  // that arrives with a new episode starts folded.
  const [desc, setDesc] = useState({ id: '', expanded: false, hasMore: false });
  const descExpanded = desc.id === song.id && desc.expanded;
  const descHasMore = desc.id === song.id && desc.hasMore;

  // Favorite: the central favorites list (`favIds`) is the reliable source —
  // it reflects mark/unmark upon invalidation. The song's `starred` (which
  // getAlbum fetches but does NOT refresh) is only used as a fallback while that
  // list is still loading; otherwise, unmarking on an album would keep the heart
  // visible (the OR with `song.starred` never became false).
  const favIds = useFavoriteIds(showFavorite);
  const favorited =
    showFavorite && heartedSong(song, podcastFavIds ?? NO_FAVORITES, favIds);
  const downloaded = useDownloads((s) => !!s.files[song.id]);
  const offline = useAuthStore((s) => s.offline);
  /**
   * Not playable without a connection: visible but grayed out and not playable.
   *
   * Worked out here rather than trusted from the song, because the mark is put
   * on by the offline data path and a list can reach the screen without having
   * been through it: anything the server answered before the connection went
   * away carries no mark at all, and would sit here looking perfectly playable
   * (@ztx-lyghters). The rule is the player's own, so the row cannot promise
   * what the player will refuse.
   */
  const unavailable = offline
    ? !song.localUri && !downloaded && !streamReachable(song)
    : !!song.unavailable;
  const explicit = useExplicitBadge(song.explicitStatus);
  // The language, so an episode's publish date reads the way the rest of the
  // screen does (see `formatEpisodeDate`).
  const lang = useSettings((s) => s.language);
  // An episode's "how long · when": the two facts a listener needs to tell
  // episodes apart. The duration leaves the row's right edge for episodes and
  // comes up here instead, so the date has a home and the two read together.
  const episodeMeta =
    episode &&
    [
      song.duration ? formatDuration(song.duration) : null,
      episode.publishedAt ? formatEpisodeDate(episode.publishedAt, lang) : null,
      episode.played ? t('Played') : null,
    ].filter(Boolean).join(' · ');

  // Swipe right = configurable action (Spotify-style gesture). The row returns
  // on its own; the background strip only peaks during the gesture.
  // NOTE: the gesture only coexists well with scroll if the parent list uses
  // react-native-gesture-handler (FlatList/ScrollView from that library).
  async function toggleFavoriteSwipe() {
    // A podcast episode: the device's own SQLite favorite, not the server's.
    if (song.podcastChannelId) {
      void togglePodcastHeart(song.id, 'episode', song.podcastChannelId)
        .then((on) => {
          toast(on ? t('Added to favorites') : t('Removed from favorites'));
        })
        .catch(() => toast(t("Couldn't complete the action")));
      return;
    }
    // Removing is deferred behind «Undo»; the heart here reads from the cached
    // list, so there is no state of its own to put back.
    if (favorited) {
      unstarWithUndo('song', song.id);
      return;
    }
    try {
      await star(song.id, 'song');
      // The cached list is patched, not thrown away: see `favoritesCache`.
      applyStarChange('song', song.id, true, song);
      toast(t('Added to favorites'));
    } catch {
      resyncFavorites();
      toast(t("Couldn't complete the action"));
    }
  }

  function runSwipeAction(action: SwipeAction) {
    haptic('light');
    swipeRef.current?.close();
    switch (action) {
      case 'queue':
        addToQueue(song);
        toast(t('Added to queue'));
        break;
      case 'next':
        playNext(song);
        toast(t('Playing next'));
        break;
      case 'favorite':
        void toggleFavoriteSwipe();
        break;
      case 'menu':
        openMenu(song, menuContext);
        break;
      default:
        break;
    }
  }

  const row = (
    <AnimatedPressable
      // The row dims late rather than not at all: it used to light up on the
      // way past while somebody scrolled, which read as taps nobody made, so
      // it stopped answering the finger entirely. The wait is in the fade now
      // and not in the gesture (see `usePressFeedback`).
      //
      // Not downloaded: dimmed and with warning on tap OUTSIDE selection; inside
      // selection it behaves normally (long-press enters, tap marks) so it can
      // be added to a list even though it can't be played. One or the other:
      // the press style sets opacity too, and after `dimmed` it undid it.
      style={[styles.row, unavailable && !selecting ? styles.dimmed : press.style]}
      onPressIn={() => {
        press.onPressIn();
        if (!(unavailable && !selecting)) onPressIn?.();
      }}
      onPressOut={press.onPressOut}
      onPress={unavailable && !selecting ? () => toast(t('Not available offline')) : onPress}
      // A row that carries the grip answers a hold by arming the drag; the rest
      // answer the caller's hold (`onLongPress`: entering selection).
      onLongPress={grip ? dragHold : onLongPress}
    >
      {selecting ? (
        <Icon
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={selected ? colors.accent : colors.textMuted}
        />
      ) : null}
      {/* One line whatever happens: the slot fits any track number worth
          having, and past that a number that does not fit should be cut rather
          than push the row taller than every other one. */}
      {position !== undefined ? (
        // The slot says which track this is, so on the one playing it says so
        // with the bars instead of the number. Same slot, so nothing shifts
        // when the song changes.
        <View style={styles.leftSlot}>
          {isCurrent ? (
            <PlayingBars />
          ) : (
            <Text style={styles.position} numberOfLines={1}>
              {position}
            </Text>
          )}
        </View>
      ) : null}
      {showArtwork ? (
        <View style={styles.artwork}>
          <Cover uri={songCoverUrl(song, COVER.thumb)} size={48} />
          {/* Over the picture where there is no number to give up, behind a
              scrim so the bars read on artwork of any colour. */}
          {isCurrent && position === undefined ? (
            <ArtworkPlaying />
          ) : null}
        </View>
      ) : null}

      <View style={styles.info}>
        <Text
          style={[styles.title, isCurrent && { color: colors.accent }]}
          // An episode's title is a sentence, so it gets the two lines it needs;
          // a track's is short and stays on one.
          numberOfLines={episode ? 2 : 1}
        >
          {song.title}
        </Text>
        {episode ? (
          <>
            {/* The whole description: an episode's is the show notes, and cutting
                it would hide the one thing that tells this episode from the next. */}
            {episode.description ? (
              <View>
                {/* The whole text, drawn invisibly: with `numberOfLines` set,
                    onTextLayout only reports the lines that survived, so the
                    copy below can't tell whether anything was cut. */}
                <Text
                  style={styles.episodeDescriptionMeasure}
                  // A screen reader would read the notes twice otherwise.
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  // The count answers after layout, so the answer arrives as a
                  // state write that re-renders the row. Only a real difference
                  // writes: layout runs again on every repaint, and a write on
                  // each one would churn the row forever. A row that came over
                  // with another episode differs by the id alone, so it writes
                  // once — and that write is what starts a fresh episode:
                  // folded, with the pill only offered once the notes were cut.
                  onTextLayout={(e) => {
                    const more =
                      e.nativeEvent.lines.length > EPISODE_DESCRIPTION_LINES;
                    if (desc.id !== song.id || desc.hasMore !== more) {
                      setDesc({ id: song.id, expanded: descExpanded, hasMore: more });
                    }
                  }}
                >
                  {/* The opening is enough to tell whether the notes run past
                      two lines, and some shows' notes are pages long: laying
                      the whole text out twice per row would cost every scroll. */}
                  {episode.description.slice(0, EPISODE_MEASURE_CHARS)}
                </Text>
                <Text
                  style={styles.episodeDescription}
                  numberOfLines={descExpanded ? undefined : EPISODE_DESCRIPTION_LINES}
                >
                  {episode.description}
                </Text>
                {descHasMore ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDesc((s) => ({ ...s, expanded: !s.expanded }))}
                    style={styles.episodeDescriptionMore}
                    hitSlop={spacing.sm}
                  >
                    <Text style={styles.episodeDescriptionMoreText}>
                      {descExpanded ? t('Show less') : t('Show more')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {downloaded || episodeMeta || episode.fresh ? (
              <View style={styles.subRow}>
                {downloaded ? (
                  <Icon name="arrow-down-circle" size={13} color={colors.accent} />
                ) : null}
                {episodeMeta ? (
                  <Text style={styles.episodeMeta} numberOfLines={1}>
                    {episodeMeta}
                  </Text>
                ) : null}
                {episode.fresh ? (
                  <>
                    {/* The mark an episode wears when it came over with the show's
                        last sync — read from the device's own first sighting, not
                        from the date beside it, which a publisher can rewrite. The
                        dot is drawn rather than an icon: it is a dot of the app's
                        own accent, and an icon would have to be cut into the font
                        for it. The word a step brighter than the metadata behind
                        it, so the mark reads as the row's own and not as more
                        furniture on it. */}
                    <View style={styles.episodeNewMark} />
                    <Text style={styles.episodeNew} numberOfLines={1}>
                      {t('New')}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <>{downloaded || explicit || song.artist ? (
            <View style={styles.subRow}>
              {downloaded ? (
                <Icon name="arrow-down-circle" size={13} color={colors.accent} />
              ) : null}
              {/* Ahead of the name, like every other player draws it: the badge
                  is about the track, and an artist name long enough to be cut
                  would take the badge off the row with it. */}
              <ExplicitBadge status={song.explicitStatus} />
              {song.artist ? (
                <Text style={styles.artist} numberOfLines={1}>
                  {song.artist}
                </Text>
              ) : null}
            </View>
          ) : null}</>
        )}
      </View>

      {favorited && !selecting && !unavailable ? (
        <FavoriteButton
          id={song.id}
          starred
          undo
          size={20}
          podcast={episodeHeart(song)}
        />
      ) : null}
      {showRating && song.userRating ? (
        <View style={styles.rating} accessibilityLabel={t('Rate {n} stars', { n: song.userRating })}>
          {Array.from({ length: song.userRating }).map((_, i) => (
            <Icon key={i} name="star" size={12} color={colors.accent} />
          ))}
        </View>
      ) : null}
      {/* An episode carries its duration in the meta line under the title, so
          the right edge stays quiet for it; a track still answers the setting. */}
      {showDuration && !episode ? <Text style={styles.duration}>{formatDuration(song.duration)}</Text> : null}
      {showMenu && !selecting && !unavailable ? (
        <Pressable
          hitSlop={8}
          style={styles.menuButton}
          accessibilityRole="button"
          accessibilityLabel={t('More options')}
          onPress={() => openMenu(song, menuContext)}
        >
          <Icon name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      {/* The grip a row answers a hold with, on a list whose rows travel: it
          sits where the ⋯ used to be, which selection already took away, so the
          row's furniture stays put. Coming down on it arms the drag at once;
          the whole row keeps answering a hold for the same drag, which is what
          the handle is drawn for — a row that can travel says so instead of
          being a row to read and guess. */}
      {grip ? (
        <Pressable
          hitSlop={8}
          // Every other grip in the app says what it is to a screen reader, and
          //  the row itself is not announced as a button: an unlabelled extra
          //  hit target beside the row is a thing an AT user finds by accident.
          accessibilityRole="button"
          accessibilityLabel={t('Reorder')}
          onPressIn={dragHold}
        >
          <Icon name="reorder-two" size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </AnimatedPressable>
  );

  // A row that never swipes skips the gesture wrapper altogether: it is a pan
  // handler and a handful of animated values per row, and a shelf of thirty
  // of them was enough to make Home stutter while music played.
  if (!swipeable) return row;

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      // The left strip is opened by swiping RIGHT (and vice versa).
      renderLeftActions={(progress) =>
        swipeAction === 'off' ? null : (
          <SwipeActionPanel progress={progress} icon={SWIPE_ICON[swipeAction]} label={SWIPE_LABEL[swipeAction]} side="left" />
        )
      }
      renderRightActions={(progress) =>
        swipeLeftAction === 'off' ? null : (
          <SwipeActionPanel progress={progress} icon={SWIPE_ICON[swipeLeftAction]} label={SWIPE_LABEL[swipeLeftAction]} side="right" />
        )
      }
      dragOffsetFromLeftEdge={10}
      dragOffsetFromRightEdge={10}
      leftThreshold={60}
      rightThreshold={60}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      enabled={swipeable && !selecting && !unavailable && (swipeAction !== 'off' || swipeLeftAction !== 'off')}
      onSwipeableWillOpen={(direction) => {
        // `direction` is the GESTURE direction (not the panel side):
        // swiping right (opens the left strip) arrives as RIGHT.
        if (direction === SwipeDirection.RIGHT) runSwipeAction(swipeAction);
        else if (direction === SwipeDirection.LEFT) runSwipeAction(swipeLeftAction);
      }}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

function sameMenuContext(a?: SongMenuContext, b?: SongMenuContext): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.playlistId === b.playlistId && a.index === b.index;
}

/**
 * `memo` comparison: re-renders only if something the row paints or how it
 * behaves changes. Callbacks (`onPress`/`onPressIn`) are recreated on every
 * parent render, but their behavior depends only on `song` and on the state
 * already compared here (selecting/selected), not on their identity, so that
 * is intentionally ignored; for `onLongPress` only whether it's active (allows
 * entering selection) matters. Without this, changing the current song would
 * re-render ALL visible rows (each receives new closures), not just the two
 * whose `isCurrent` changes. Internal subscriptions (downloads, settings,
 * favorites) keep re-rendering their row on their own when needed.
 */
function propsEqual(a: Props, b: Props): boolean {
  return (
    a.song === b.song &&
    a.position === b.position &&
    a.isCurrent === b.isCurrent &&
    a.showFavorite === b.showFavorite &&
    a.showMenu === b.showMenu &&
    a.showArtwork === b.showArtwork &&
    a.selecting === b.selecting &&
    a.swipeable === b.swipeable &&
    a.selected === b.selected &&
    a.podcastFavIds === b.podcastFavIds &&
    a.episode === b.episode &&
    !!a.onLongPress === !!b.onLongPress &&
    a.grip === b.grip &&
    !!a.dragHold === !!b.dragHold &&
    sameMenuContext(a.menuContext, b.menuContext)
  );
}

export const TrackRow = memo(TrackRowBase, propsEqual);

/**
 * The same row, for a list whose rows can be dragged to new places: a hold on
 * it arms the list's own pan instead of leaving the finger where it came down,
 * and the row keeps answering a tap with its mark. It has to be a component of
 * its own because the library's drag handle comes from the cell's context, which
 * only a component's render can see. Not `memo`ized like the plain row: the
 * handle belongs to the cell the row sits in *now*, and a row that has travelled
 * to another place must answer with the new one, not with the render the
 * previous place cached. The row inside it still memoizes itself, so what a
 * repaint costs is this wrapper.
 */
export function DragTrackRow(props: Props) {
  const drag = useReorderableDrag();
  const arm = () => {
    haptic('medium');
    drag();
  };
  // The row hands over the arm; which press answers with it is the row's own
  //  call - `TrackRowBase` arms with it for the grip's touchdown and for a hold
  //  only while the row carries the grip, and otherwise answers the caller's
  //  `onLongPress` (entering selection). One engine is on screen either way, so
  //  the two decisions belong to the row and not to the list under the finger.
  //  What the arm did to the list is not the row's to report: the engine says
  //  when a drag really started (see `dragStarted`), which is also the moment
  //  the app had to leave before an arm it refused.
  return <TrackRow {...props} dragHold={arm} />;
}

/** Its own component so only the playing row reads the cover corner. */
function ArtworkPlaying() {
  const corner = useCoverRadius(48);
  return (
    <View style={[styles.artworkPlaying, { borderRadius: corner }]}>
      <PlayingBars />
    </View>
  );
}

const styles = themed((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
    // Transparent: the header color gradient (album/playlist) seeps through
    // the first rows, like Spotify. The swipe action no longer needs to be
    // covered: it hides on its own at rest (see QueueAction).
  },
  swipeAction: {
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
    minWidth: 72,
  },
  swipeActionContent: {
    alignItems: 'center',
    gap: 4,
  },
  swipeActionLabel: {
    color: colors.onAccent,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  position: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  leftSlot: {
    // Three digits' worth. A hundred-track compilation is a real thing, and at
    // 24 the number wrapped: "100" came out as a 10 with a 0 under it, and the
    // row grew a line to hold it. The width is generous on purpose, since the
    // font is the reader's to choose and some are wider than others.
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Separates the three-dot icon from the right edge and expands the touch area
  // (Spotify style): the vertical padding makes almost the entire row height
  // on that side tappable, so it's much easier to hit with a finger.
  menuButton: {
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    paddingVertical: spacing.md,
  },
  artwork: {
    width: 48,
    height: 48,
  },
  artworkPlaying: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  info: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  // An episode's show notes: quieter than the title, and left to run the full
  // width so a long one wraps under the two-line title rather than beside it.
  episodeDescription: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: 2,
  },
  // Same text, same width, no paint: only here to count the lines.
  episodeDescriptionMeasure: {
    position: 'absolute',
    opacity: 0,
    pointerEvents: 'none',
    width: '100%',
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  // Under the text, never over it.
  episodeDescriptionMore: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  // The button belongs to the notes it unfolds, so it takes their grey: the
  // block under a title reads as one thing, and the heavier weight already
  // says this one line can be tapped. `textMuted` would put it as far back as
  // a disabled icon, and a tap target that looks dead is worse than one that
  // shouts. Episodes only — the header's "Show more" stays at full text, where
  // it sits over the cover's gradient and has no grey of its own to match.
  episodeDescriptionMoreText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  // The "how long · when" line under an episode.
  episodeMeta: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  // The word behind the dot that marks an episode as a new arrival: a step
  // above the metadata line it follows, so the mark reads as the row's own and
  // not as more of its furniture. The dot carries the accent; this only has to
  // say what the dot means.
  episodeNew: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  // The dot itself: the app's accent, drawn as a circle rather than an icon, so
  // a name the icon font was never cut for cannot answer blank. One gap step
  // across, which is what the row's own gap puts between it and the word.
  episodeNewMark: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  duration: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  rating: {
    flexDirection: 'row',
    gap: 1,
  },
  // Song not available offline (mirror): dimmed and not tappable.
  dimmed: {
    opacity: DIM_OPACITY,
  },
}));
