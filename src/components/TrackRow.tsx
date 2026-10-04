/** Song row inside a list (album, playlist, search results). */
import Icon from '@/components/Icon';
import { memo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { COVER, songCoverUrl, star } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { formatDuration } from '@/lib/format';
import { applyStarChange, resyncFavorites, unstarWithUndo } from '@/lib/favoritesCache';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSongMenu, type SongMenuContext } from '@/store/songMenu';
import { useSettings, type SwipeAction } from '@/store/settings';
import { haptic } from '@/lib/haptics';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';
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
}

/** Swipe strip icon according to the configured action. */
const SWIPE_ICON: Record<Exclude<SwipeAction, 'off'>, keyof typeof Icon.glyphMap> = {
  queue: 'list',
  next: 'play-forward',
  favorite: 'heart',
  menu: 'ellipsis-horizontal',
};

/**
 * Action strip that peeks out behind the row during swipe. Invisible at rest:
 * the row is transparent (lets the header gradient through, Spotify style),
 * so the strip can only exist while the gesture lasts.
 */
function SwipeActionPanel({
  progress,
  icon,
  side,
}: {
  progress: SharedValue<number>;
  icon: keyof typeof Icon.glyphMap;
  /** Side where the strip peeks out: the icon sticks to the edge it enters from. */
  side: 'left' | 'right';
}) {
  const visible = useAnimatedStyle(() => ({ opacity: progress.get() > 0.01 ? 1 : 0 }));
  return (
    <Reanimated.View
      style={[
        styles.queueAction,
        { backgroundColor: colors.accent, alignItems: side === 'left' ? 'flex-start' : 'flex-end' },
        visible,
      ]}
    >
      <Icon name={icon} size={22} color={colors.onAccent} />
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

  // Favorite: the central favorites list (`favIds`) is the reliable source —
  // it reflects mark/unmark upon invalidation. The song's `starred` (which
  // getAlbum fetches but does NOT refresh) is only used as a fallback while that
  // list is still loading; otherwise, unmarking on an album would keep the heart
  // visible (the OR with `song.starred` never became false).
  const favIds = useFavoriteIds(showFavorite);
  const favorited = showFavorite && (favIds ? favIds.has(song.id) : !!song.starred);
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
    ? !song.url && !song.localUri && !downloaded
    : !!song.unavailable;
  const explicit = useExplicitBadge(song.explicitStatus);

  // Swipe right = configurable action (Spotify-style gesture). The row returns
  // on its own; the background strip only peaks during the gesture.
  // NOTE: the gesture only coexists well with scroll if the parent list uses
  // react-native-gesture-handler (FlatList/ScrollView from that library).
  async function toggleFavoriteSwipe() {
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

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      // The left strip is opened by swiping RIGHT (and vice versa).
      renderLeftActions={(progress) =>
        swipeAction === 'off' ? null : (
          <SwipeActionPanel progress={progress} icon={SWIPE_ICON[swipeAction]} side="left" />
        )
      }
      renderRightActions={(progress) =>
        swipeLeftAction === 'off' ? null : (
          <SwipeActionPanel progress={progress} icon={SWIPE_ICON[swipeLeftAction]} side="right" />
        )
      }
      // Intentionally less sensitive: `dragOffsetFrom…Edge` requires a clear
      // horizontal path before activating (so a vertical scroll with some
      // lateral movement no longer triggers it accidentally), and the
      // `threshold` requires a substantial drag to confirm the action.
      dragOffsetFromLeftEdge={30}
      dragOffsetFromRightEdge={30}
      leftThreshold={90}
      rightThreshold={90}
      friction={1}
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
      onLongPress={onLongPress}
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
          numberOfLines={1}
        >
          {song.title}
        </Text>
        {downloaded || explicit || song.artist ? (
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
        ) : null}
      </View>

      {favorited && !selecting && !unavailable ? (
        <FavoriteButton id={song.id} starred undo size={20} />
      ) : null}
      {showRating && song.userRating ? (
        <View style={styles.rating} accessibilityLabel={t('Rate {n} stars', { n: song.userRating })}>
          {Array.from({ length: song.userRating }).map((_, i) => (
            <Icon key={i} name="star" size={12} color={colors.accent} />
          ))}
        </View>
      ) : null}
      {showDuration ? <Text style={styles.duration}>{formatDuration(song.duration)}</Text> : null}
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
    </AnimatedPressable>
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
    !!a.onLongPress === !!b.onLongPress &&
    sameMenuContext(a.menuContext, b.menuContext)
  );
}

export const TrackRow = memo(TrackRowBase, propsEqual);

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
  queueAction: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
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
    opacity: 0.4,
  },
}));
