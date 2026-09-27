/**
 * Compact playback bar above the tab bar. Shows the current song and a
 * play/pause button; tapping it opens the player.
 */
import Icon from '@/components/Icon';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { COVER, songCoverUrl, type Song } from '@/api/data';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { router } from 'expo-router';
import { revealOffset } from '@/lib/playerReveal';
import { pushOnce } from '@/lib/pushOnce';
import { currentSong, useLiveInfo, usePlayerStore } from '@/store/player';
import { CONTENT_MAX_WIDTH, useScreenSize } from '@/hooks/useScreenSize';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed } from '@/theme';
import { motion } from '@/theme/motion';
import { BarBlur, useBarBlur } from './BarBlur';
import { Cover } from './Cover';
import { FavoriteButton } from './FavoriteButton';
import { MarqueeText } from './MarqueeText';

// Gesture thresholds: a share of the width to change track, a fixed distance
// downwards to dismiss. Measured while rendering rather than when this file was
// first imported, so turning the phone does not leave the thresholds — and the
// distance the card is thrown to get off screen — describing the other one (#131).
const SWIPE_SHARE = 0.25;
const DISMISS_Y = 80;
/** How far up the finger goes before the player starts coming up after it. */
const REVEAL_START = 12;
/** Past this share of the screen, letting go finishes opening it. */
const REVEAL_COMMIT = 0.2;

/**
 * Isolated progress bar: the only thing that subscribes to `positionSec`
 * (updated every 500ms), so the whole MiniPlayer (cover, title, favorite,
 * play) doesn't re-render 2×/sec while something is playing — only this bar.
 */
function MiniProgress({ song }: { song: Song }) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const duration = durationSec || song.duration || 0;
  const progress = duration > 0 ? Math.min(1, positionSec / duration) : 0;
  return (
    <View style={styles.progressTrack} pointerEvents="none">
      <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
    </View>
  );
}

export function MiniPlayer() {
  const { width: screenW, height: screenH, wide } = useScreenSize();
  const song = usePlayerStore(currentSong);
  // A radio saying what it plays says it here too: down here there is only room
  // for the track and whoever is playing it, so the station stays in the player.
  const live = useLiveInfo(song);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const reset = usePlayerStore((s) => s.reset);
  const t = useT();

  // Mini-player gestures: swipe left → next, swipe right → previous (same as
  // the player carousel), swipe down → dismiss (stop and clear), swipe up →
  // open the player. The pan is locked to the dominant axis to prevent
  // diagonal movement.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // Pulled up, the player comes with the finger (see `playerReveal`): it is
  // opened with no animation and `revealOffset` places it.
  const revealing = useSharedValue(false);
  const startReveal = () => pushOnce('/player?reveal=1');
  // Down at the bottom, out of sight: it is let go of (`revealOffset` back to
  // -1) by the player as it unmounts, or it would flash back up for a frame.
  const cancelReveal = () => {
    if (router.canGoBack()) router.back();
    else revealOffset.value = -1;
  };
  const pan = Gesture.Pan()
    .minDistance(10)
    .onUpdate((e) => {
      // Once the player is coming up, the pull is only ever vertical.
      if (revealing.value) {
        revealOffset.value = Math.min(screenH, Math.max(0, screenH + e.translationY + REVEAL_START));
        return;
      }
      if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
        translateX.value = e.translationX;
        translateY.value = 0;
      } else if (e.translationY >= 0) {
        translateY.value = e.translationY;
        translateX.value = 0;
      } else {
        translateX.value = 0;
        translateY.value = 0;
        if (e.translationY < -REVEAL_START) {
          revealing.value = true;
          revealOffset.value = screenH;
          scheduleOnRN(startReveal);
        }
      }
    })
    .onEnd((e) => {
      const horizontal = !revealing.value && Math.abs(e.translationX) > Math.abs(e.translationY);
      if (horizontal) {
        const swipeX = screenW * SWIPE_SHARE;
        if (e.translationX < -swipeX || e.velocityX < -800) scheduleOnRN(next);
        else if (e.translationX > swipeX || e.velocityX > 800) scheduleOnRN(previous);
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        translateY.value = 0;
      } else if (revealing.value) {
        revealing.value = false;
        const opened = -e.translationY > screenH * REVEAL_COMMIT || e.velocityY < -600;
        if (opened) {
          revealOffset.value = withTiming(0, { duration: motion.duration.move }, () => {
            revealOffset.value = -1;
          });
        } else {
          revealOffset.value = withTiming(screenH, { duration: motion.duration.move }, (f) => {
            if (f) scheduleOnRN(cancelReveal);
            else revealOffset.value = -1;
          });
        }
      } else if (e.translationY > DISMISS_Y || e.velocityY > 800) {
        translateY.value = withTiming(screenH, { duration: motion.duration.move }, (finished) => {
          if (finished) scheduleOnRN(reset);
        });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    })
    // A pull that was cut off (the system took the touch) still ends somewhere:
    // opened, since the player is already up on the screen.
    .onFinalize(() => {
      if (!revealing.value) return;
      revealing.value = false;
      revealOffset.value = withTiming(0, { duration: motion.duration.move }, () => {
        revealOffset.value = -1;
      });
    });
  // The entire card only moves (and fades) when dismissed downward.
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(translateY.value, [0, screenW * 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  // On horizontal swipe the bar stays fixed: only the song details slide/fade,
  // to read as "changing track", not as dismissing.
  const detailsStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: interpolate(Math.abs(translateX.value), [0, screenW * 0.5], [1, 0.15], Extrapolation.CLAMP),
  }));

  // When the song changes (or playback resumes) we return the card to its place
  // in case it was offset from a previous gesture.
  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
  }, [song?.id, translateX, translateY]);

  // A radio has no album, but the station may carry its own image.
  const cover = song ? songCoverUrl(song, COVER.thumb) : undefined;
  // Dominant color from the cover art, if the setting is active; otherwise neutral surface.
  const miniColor = useSettings((s) => s.miniPlayerColorBackground);
  const marqueeTitles = useSettings((s) => s.marqueeTitles);
  // The palette is extracted from the SAME image the player uses (600px):
  // with different sizes the quantization picks different colors and the mini
  // ended up one color and the player screen another for the same song.
  const colorSource = song
    ? songCoverUrl(song, COVER.card)
    : undefined;
  const dominant = useDominantColor(miniColor ? colorSource : undefined);
  const bg = miniColor ? dominant : colors.surfaceHighlight;
  const blur = useBarBlur();
  // Not "unless the file is on the phone": see the player screen, which had the
  // same test in the same two places and the same hole under it.
  const favIds = useFavoriteIds(!!song);

  if (!song) return null;

  // The central list wins when loaded; `song.starred` from the queue becomes
  // stale (only kept as backup for local files or while loading).
  const favorited = favIds ? favIds.has(song.id) : !!song.starred;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={cardStyle}>
        {/* It stops growing on a wide screen. Across a tablet the title ends
            up alone on the left with the buttons a forearm away on the right,
            and nothing about a bar with three things in it needs 1280 points
            (#131). */}
        {/* The shadow sits outside the card, which clips its own contents. */}
        <View style={[styles.card, wide && styles.narrow]}>
        <Pressable
          style={[styles.container, { backgroundColor: blur ? 'transparent' : bg }]}
          onPress={() => pushOnce('/player')}
        >
          {blur ? <BarBlur tint={bg} alpha={0.55} /> : null}
      <Animated.View style={[styles.details, detailsStyle]}>
        <Cover uri={cover} size={44} placeholderIcon={song.url ? 'radio' : 'musical-notes'} />
        <View style={styles.info}>
          <MarqueeText
            text={live?.title ?? song.title}
            style={styles.title}
            enabled={marqueeTitles}
          />
          {live?.artist ?? song.artist ? (
            <Text style={styles.artist} numberOfLines={1}>
              {live?.artist ?? song.artist}
            </Text>
          ) : null}
        </View>
      </Animated.View>
      <FavoriteButton id={song.id} starred={favorited} size={24} />
      <Pressable
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? t('Pause') : t('Play')}
        onPress={(e) => {
          e.stopPropagation();
          toggle();
        }}
        // Real stop: stops and clears queue, mini player, and notification.
        onLongPress={() => {
          haptic('medium');
          void usePlayerStore
            .getState()
            .stopAndClear()
            .then((undo) => {
              if (undo) {
                useToast.getState().show(t('Playback stopped'), { label: t('Undo'), run: undo });
              }
            });
        }}
      >
        {isBuffering ? (
          <ActivityIndicator size="small" color={colors.text} style={styles.spinner} />
        ) : (
          <Icon
            name={isPlaying ? 'pause' : 'play'}
            size={28}
            color={colors.text}
          />
        )}
      </Pressable>

          <MiniProgress song={song} />
        </Pressable>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = themed((colors) => ({
  card: {
    marginHorizontal: spacing.sm,
    borderRadius: radius.lg,
    boxShadow: '0px 6px 16px rgba(0, 0, 0, 0.3)',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceHighlight,
    padding: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  /** Centred and no wider than a wide screen wants it. */
  narrow: { maxWidth: CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  progressTrack: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.highlight,
    overflow: 'hidden',
  },
  progressFill: { height: 3, borderRadius: radius.pill, backgroundColor: colors.text },
  spinner: { width: 28, height: 28 },
  details: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  info: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
}));
