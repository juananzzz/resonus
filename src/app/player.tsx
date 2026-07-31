/** Full-screen player (modal): cover art, progress and controls. */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { coverArtUrl, type Song } from '@/api/data';
import { AudioQualityBadge } from '@/components/AudioQualityBadge';
import { Cover } from '@/components/Cover';
import { FavoriteButton } from '@/components/FavoriteButton';
import { StarRating } from '@/components/StarRating';
import { CoverLyrics, LyricsCard } from '@/components/LyricsCard';
import { MarqueeText } from '@/components/MarqueeText';
import { OutputSheet } from '@/components/OutputSheet';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useLyrics } from '@/hooks/useLyrics';
import { artistTargets } from '@/lib/artistNav';
import { formatDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useArtistPicker } from '@/store/artistPicker';
import { useAuthStore } from '@/store/auth';
import {
  currentSong,
  SOURCE_FAVORITES,
  SOURCE_HISTORY,
  useLiveInfo,
  usePlayerStore,
} from '@/store/player';
import { useSettings } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { useToast } from '@/store/toast';
import { useJukebox } from '@/store/jukebox';
import { useUpnp } from '@/store/upnp';
import { useT } from '@/i18n';
import { colors, fontSize, spacing } from '@/theme';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
/** Cover size when there's height to spare: a square as wide as the screen. */
const COVER_MAX = SCREEN_W - spacing.xl * 2;
/** Floor: below this the cover stops giving up space and the page scrolls. */
const COVER_MIN = 200;
/**
 * Share of the spare height that goes ABOVE the cover; the rest falls below it,
 * between the artwork and the info block. With few options enabled there is a
 * lot of spare height and it has to go somewhere: piling it all on one side
 * left an obvious hole there, so it gets split. Slightly under half so the
 * cover sits a touch high, which reads better than dead centre.
 */
const COVER_TOP_SHARE = 0.4;
const SWIPE_THRESHOLD = SCREEN_W * 0.25;
const DISMISS_THRESHOLD = 120;
// How much of the lyrics card peeks below the first page (invites swipe).
const LYRICS_PEEK = 56;

function CircleButton({
  name,
  label,
  onPress,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: (e: GestureResponderEvent) => void;
}) {
  return (
    <Pressable
      style={styles.circle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Ionicons name={name} size={22} color={colors.text} />
    </Pressable>
  );
}

/**
 * Position and opacity of a carousel panel (recycled).
 *
 * The 3 panels form an infinite strip: panel `k` is placed at the nearest
 * multiple of 3 screens to the center, so it always stays ≤1.5 screens away
 * and the jump from one end to the other happens off-screen. Everything is
 * calculated on the UI thread from `offset` (which accumulates, never resets),
 * so committing a swipe doesn't move any visible panel: the one that was the
 * neighbor stays centered and only the hidden panel's content changes.
 */
function usePaneStyle(offset: SharedValue<number>, k: number) {
  return useAnimatedStyle(() => {
    const m = k + 3 * Math.round((-offset.value / SCREEN_W - k) / 3);
    const x = m * SCREEN_W + offset.value;
    return {
      transform: [{ translateX: x }],
      opacity: interpolate(Math.abs(x), [0, SCREEN_W * 0.6], [1, 0.4], Extrapolation.CLAMP),
    };
  });
}

/**
 * Slider and times, kept apart on purpose.
 *
 * `positionSec` moves twice a second while music plays, and this screen is one
 * large component: cover, gradient, quality badge, controls, queue sheet. It
 * was repainting all of it on every tick, which is the one thing the mini
 * player has always been careful not to do (#50). The seek buttons read the
 * position when they are pressed instead of subscribing to it.
 */
function PlayerProgress({
  duration,
  onSeek,
}: {
  duration: number;
  onSeek: (sec: number) => void;
}) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  return (
    <View style={styles.progress}>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={duration}
        value={positionSec}
        onSlidingComplete={onSeek}
        minimumTrackTintColor={colors.text}
        maximumTrackTintColor="rgba(255,255,255,0.35)"
        thumbTintColor={colors.text}
      />
      <View style={styles.times}>
        <Text style={styles.time}>{formatDuration(positionSec)}</Text>
        <Text style={styles.time}>{formatDuration(duration)}</Text>
      </View>
    </View>
  );
}

export default function PlayerScreen() {
  useSettings((s) => s.accentColor); // re-render when accent changes
  useSettings((s) => s.appFont); // re-render when font changes
  const router = useRouter();
  const isFocused = useIsFocused();
  const song = usePlayerStore(currentSong);
  const live = useLiveInfo(song);
  const source = usePlayerStore((s) => s.source);
  const sourceHref = usePlayerStore((s) => s.sourceHref);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const rateSong = usePlayerStore((s) => s.rateSong);
  const openMenu = useSongMenu((s) => s.open);
  const openArtistPicker = useArtistPicker((s) => s.open);
  const t = useT();
  const showQualityBadge = useSettings((s) => s.showAudioQuality);
  const showRating = useSettings((s) => s.showRating);
  const showAlbumInfo = useSettings((s) => s.showAlbumInfo);
  const showLyricsCard = useSettings((s) => s.showLyricsCard);
  // Ignored on a local profile over a server: there is no heart there, so there
  // is nothing to swap and moving the ⋯ down would just leave the corner empty.
  const swapButtons = useSettings((s) => s.swapPlayerButtons);
  // Only the player honours this: in lists and grids letterboxing every cover
  // would leave each row a different size and look ragged.
  const fitCoverArt = useSettings((s) => s.fitCoverArt);
  const coverTapAction = useSettings((s) => s.coverTapAction);
  const marqueeTitles = useSettings((s) => s.marqueeTitles);
  const showQueueButton = useSettings((s) => s.showQueueButton);
  const showDevicesButton = useSettings((s) => s.showDevicesButton);
  const seekButtonsSec = useSettings((s) => s.seekButtonsSec);
  const offline = useAuthStore((s) => s.offline);
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const hasAccount = useAuthStore((s) => !!s.auth);
  const upnpDevice = useUpnp((s) => (s.connected ? s.deviceName : null));
  const jukeboxActive = useJukebox((s) => s.active);
  const remoteDevice = upnpDevice ?? (jukeboxActive ? t('Server speakers (Jukebox)') : null);
  const [outputOpen, setOutputOpen] = useState(false);
  // With local lyrics (.lrc/USLT/LRCLIB) offline mode also has lyrics;
  // only radio (direct url) is excluded. Hiding the card (setting) doesn't
  // disable lyrics: tapping cover art still opens the full screen.
  const canLyrics = !song?.url;
  const favIds = useFavoriteIds(!!song && (!song?.localUri || offline));

  // The data layer resolves the cover: from the server (online) or from the
  // local index by album (offline). Base64 is no longer stored per song.
  // A radio has no album, but the station may carry its own image (the server
  // holds it, so it's the same one every client shows).
  const coverOf = (s?: Song | null) =>
    s ? coverArtUrl(s.coverArt ?? (s.url ? undefined : s.albumId), 600) : undefined;
  const cover = coverOf(song);
  // Spotify-style background: gradient from the cover's dominant color
  // (toggle in Settings → Theme). The color transitions smoothly on song
  // change: a flat color is animated and the gradient toward the background is
  // a fixed overlay (same look as animating the gradient, which can't be done).
  const background = useSettings((s) => s.playerBackground);
  const colorBackground = background === 'color';
  const dominant = useDominantColor(colorBackground ? cover : undefined);
  // Under the blurred artwork the flat colour is irrelevant, but it still
  // paints the frame before the image decodes, so it stays dark rather than
  // flashing the old grey.
  const targetBg = colorBackground ? dominant : background === 'cover' ? colors.background : '#3a4042';
  const bgColor = useSharedValue(targetBg);
  useEffect(() => {
    // reduceMotion Never: the color fade is part of the look and some devices
    // (battery saver / "reduce motion") would skip it.
    bgColor.value = withTiming(targetBg, { duration: 600, reduceMotion: ReduceMotion.Never });
  }, [targetBg, bgColor]);
  const bgStyle = useAnimatedStyle(() => ({ backgroundColor: bgColor.value }));
  // Same query used by the lyrics card (cached): here only to know if there
  // are lyrics and let the card peek below the first page.
  const { data: lyrics } = useLyrics(canLyrics ? (song ?? undefined) : undefined);

  // The player is scrollable (like Spotify): the first "page" fills the
  // screen and the lyrics card peeks below. The real height comes from the
  // ScrollView's onLayout; until then, approximate it from the safe-area insets.
  // Only the top one: the ScrollView runs to the bottom edge of the screen so
  // the lyrics card does too, and it is the controls that keep clear of the
  // navigation bar (see `styles.bottom` below). A close-enough first guess keeps
  // the controls from dropping into place once measured.
  const insets = useSafeAreaInsets();
  const approxPageH = SCREEN_H - insets.top;
  const [pageH, setPageH] = useState(0);
  /**
   * Height left over for the cover once everything else has taken its share.
   * The cover is the ONLY elastic piece of the player: the title, the optional
   * rows (rating, album, quality badge) and the controls all have a fixed
   * height, so with every option enabled they stopped fitting. `coverWrap` is
   * `flex: 1`, so this measurement already discounts whatever is above and
   * below it — including any row added in the future, with no constants to
   * keep in sync.
   */
  const [coverBoxH, setCoverBoxH] = useState(0);
  const coverBoxHRef = useRef(0);
  /** Height of the rating row, measured so it can be subtracted from the slot. */
  const [starsH, setStarsH] = useState(0);
  // The cover's size and vertical offset both come from the measured slot
  // (`coverBoxH`) and the page height (`pageH`), neither known on the first
  // paint. Rendered eagerly, the cover flashes full-width pinned to the top and
  // then resizes/drops into place once measured — the visible "jump" on open.
  // Keep it hidden until the slot has been measured UNDER THE REAL page height
  // (not the first-paint approximation): revealing on the approximate measure
  // makes the cover settle a few px on screen on a fast reopen. We flip `stable`
  // from the cover slot's onLayout once the ScrollView's real height is known
  // (or right away if the approximation already matched it); a timeout is a
  // safety net so the cover can never stay hidden if the callbacks don't line up.
  const [coverStable, setCoverStable] = useState(false);
  const coverAppear = useSharedValue(0);
  useEffect(() => {
    if (coverStable) {
      coverAppear.value = withTiming(1, { duration: 200, reduceMotion: ReduceMotion.Never });
    }
  }, [coverStable, coverAppear]);
  useEffect(() => {
    const id = setTimeout(() => setCoverStable(true), 300);
    return () => clearTimeout(id);
  }, []);
  const coverAppearStyle = useAnimatedStyle(() => ({ opacity: coverAppear.value }));
  // The swipe-to-close gesture should only work when scrolled to the top;
  // otherwise it would steal the gesture when returning from the lyrics card.
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);

  // Cover art swipe: left → next, right → previous. It mirrors the prev/next
  // buttons, which don't wrap: you can't go back before the first track, and
  // forward stops at the last one — except with repeat 'all', which wraps
  // forward (same rule as `nextIndex` in the store). Wrapping backwards was
  // especially bad with autoplay on: from the first track it jumped to the last
  // (a freshly autoplay-added one), stranding the user far from the start (#35).
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const index = usePlayerStore((s) => s.index);
  const queueLen = usePlayerStore((s) => s.queue.length);
  const canPrev = queueLen > 1 && index > 0;
  const canNext = queueLen > 1 && (index < queueLen - 1 || repeat === 'all');
  // Neighbors in the queue, so the carousel can show them when dragging. Absent
  // at the edges (no wrap), so there's nothing to drag toward past the ends.
  // Stable references: only re-renders if the song changes.
  const prevSong = usePlayerStore((s) =>
    s.queue.length > 1 && s.index > 0 ? s.queue[s.index - 1] : undefined,
  );
  const nextSong = usePlayerStore((s) => {
    if (s.queue.length <= 1) return undefined;
    if (s.index < s.queue.length - 1) return s.queue[s.index + 1];
    return s.repeat === 'all' ? s.queue[0] : undefined;
  });
  const prevCover = coverOf(prevSong);
  const nextCover = coverOf(nextSong);
  const goNext = () => {
    const { queue, index: i, repeat: r } = usePlayerStore.getState();
    if (i < queue.length - 1) jumpTo(i + 1);
    else if (r === 'all' && queue.length > 1) jumpTo(0);
  };
  const goPrev = () => {
    const { index: i } = usePlayerStore.getState();
    if (i > 0) jumpTo(i - 1);
  };

  // Net committed advances of the carousel: integer mirror of `-offset/W` at
  // rest. Lives in React because it decides which song each panel shows.
  const [spins, setSpins] = useState(0);
  const offset = useSharedValue(0);
  const dragBase = useSharedValue(0);
  const commitSwipe = (advance: 1 | -1) => {
    setSpins((n) => n + advance);
    (advance === 1 ? goNext : goPrev)();
  };
  const coverPan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onStart(() => {
      dragBase.value = offset.value;
    })
    .onUpdate((e) => {
      // Dragging right reveals the previous track, left reveals the next. Past
      // the first/last track there's nowhere to go: the drag gets friction and
      // is clamped so no (absent) neighbor panel can slide into view.
      const goingPrev = e.translationX > 0;
      const blocked = goingPrev ? !canPrev : !canNext;
      const raw = dragBase.value + (blocked ? e.translationX / 4 : e.translationX);
      const min = canNext ? -(spins + 1) * SCREEN_W : -spins * SCREEN_W;
      const max = canPrev ? -(spins - 1) * SCREEN_W : -spins * SCREEN_W;
      offset.value = Math.min(max, Math.max(min, raw));
    })
    .onEnd((e) => {
      const wantNext = canNext && (e.translationX < -SWIPE_THRESHOLD || e.velocityX < -600);
      const wantPrev = canPrev && (e.translationX > SWIPE_THRESHOLD || e.velocityX > 600);
      const advance = wantNext ? 1 : wantPrev ? -1 : 0;
      const target = -(spins + advance) * SCREEN_W;
      if (advance !== 0) {
        // The carousel finishes the travel with the neighbor centered; the
        // track changes at the end. If React lags, it's not noticeable: the
        // centered panel already shows the right cover and the swap happens
        // in the hidden panel.
        offset.value = withTiming(
          target,
          { duration: 220, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) scheduleOnRN(commitSwipe, advance as 1 | -1);
          },
        );
      } else {
        offset.value = withSpring(target, { damping: 20, stiffness: 200 });
      }
    });
  // Cover tap shows lyrics (if any). Coexists with swipe: tap only wins if
  // there was no drag. `hasLyrics` is a boolean so it can be read from the
  // gesture's UI thread.
  const hasLyrics = !!lyrics;
  // What tap does based on setting: «inline» shows lyrics in place of the
  // cover (toggle), «screen» opens the full screen, «none» nothing.
  const [inlineLyrics, setInlineLyrics] = useState(false);
  // When the song changes, go back to the cover (each song is tapped separately).
  useEffect(() => {
    setInlineLyrics(false);
  }, [song?.id]);
  const openLyrics = () => {
    if (coverTapAction === 'inline') setInlineLyrics((v) => !v);
    else if (coverTapAction === 'screen') router.push('/lyrics');
  };
  const coverTap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((_e, success) => {
      if (success && hasLyrics) scheduleOnRN(openLyrics);
    });
  const coverGesture = Gesture.Race(coverPan, coverTap);
  const paneStyles = [usePaneStyle(offset, 0), usePaneStyle(offset, 1), usePaneStyle(offset, 2)];
  // Which song (current, next or previous) belongs to each panel based on
  // committed advances; same recycling formula as the UI position.
  const paneRel = (k: number) => k + 3 * Math.round((spins - k) / 3) - spins;

  // Swiping down closes the player (our own gesture: the native modal
  // doesn't support it on Android).
  const transY = useSharedValue(0);
  const closePlayer = () => router.back();
  const dismissPan = Gesture.Pan()
    .enabled(atTop)
    .activeOffsetY(15)
    .failOffsetX([-25, 25])
    .onUpdate((e) => {
      transY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_THRESHOLD || e.velocityY > 800) {
        transY.value = withTiming(SCREEN_H, { duration: 220 }, (f) => {
          if (f) scheduleOnRN(closePlayer);
        });
      } else {
        transY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });
  const rootStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: transY.value }],
  }));

  // If there's no song (e.g. after emptying the queue), close the player. In an
  // effect (not in render) to avoid updating the Stack while painting another
  // component, and only if the player is the visible screen: if the queue
  // screen is on top, let it show its empty state instead of closing it.
  useEffect(() => {
    if (!song && isFocused) router.back();
  }, [song, isFocused, router]);

  if (!song) return null;

  const isLocal = !!song.localUri;
  // The central list wins when loaded (refreshes when starred from any
  // screen); `song.starred` from the queue becomes stale, so it only serves
  // as a fallback for local songs or while loading.
  const favorited = favIds ? favIds.has(song.id) : !!song.starred;
  // Stars (setRating) are a Subsonic thing: enabled in Settings and require
  // a non-Jellyfin server account; not applicable to radio (direct url) or
  // the local profile (no account). Offline queues and uploads on reconnect.
  const canRate = showRating && hasAccount && serverType !== 'jellyfin' && !song.url;
  // Artist · Album · Year on a single line, but with two tap targets: the
  // artist name goes to the artist, and «Album · Year» to the album.
  // A radio announcing what it plays takes over both lines, same as it does
  // everywhere else. A stream that announces nothing leaves them as they were:
  // the station's name and "Radio".
  const title = live?.title ?? song.title;
  const artistName = live?.artist ?? song.artist ?? t('Unknown artist');
  // With the two lines above taken by the track, this one is all that is left to
  // say which station it is, so a radio puts its name here and does it whether
  // or not album info is on: this is not album info.
  const albumInfo = live
    ? song.title
    : showAlbumInfo
      ? [song.album, song.year].filter(Boolean).join(' · ')
      : '';
  // Square, capped at the width: it only shrinks when the height demands it, so
  // on a tall screen with few options it looks exactly as it did before. The
  // rating row shares the slot, so it comes off the top first.
  const coverSize = coverBoxH
    ? Math.max(COVER_MIN, Math.min(COVER_MAX, coverBoxH - (canRate ? starsH : 0)))
    : COVER_MAX;
  // Left-over height once the cover and the stars have taken their share, split
  // between the two sides. Padding doesn't feed back into the measurement: the
  // slot's height comes from `flex: 1`, not from its contents.
  const coverSlack = Math.max(0, coverBoxH - coverSize - (canRate ? starsH : 0));
  const coverTopPad = Math.round(coverSlack * COVER_TOP_SHARE);
  const duration = durationSec || song.duration || 0;
  const repeatActive = repeat !== 'off';

  return (
    <GestureDetector gesture={dismissPan}>
      <Animated.View style={[styles.root, rootStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, bgStyle]} />
        {background === 'cover' && cover ? (
          <>
            {/* The artwork itself, blurred, filling the screen. No
                `recyclingKey`: it blanks the view the moment the song changes,
                which is what put a black frame between one cover and the next.
                Left alone, the previous one stays up until the new one has
                decoded and the transition dissolves between the two. */}
            <Image
              source={{ uri: cover }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              blurRadius={60}
              transition={600}
            />
            {/* Scrim: blurring alone doesn't guarantee contrast — a bright or
                busy cover would swallow the white text. */}
            <View style={styles.coverScrim} />
          </>
        ) : null}
        <LinearGradient
          colors={[colors.background + '00', colors.background] as const}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, spacing.md) }}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            setPageH(h);
            // If the approximation already matched, the slot won't re-lay-out
            // (the cover's onLayout won't fire again), so its current measure is
            // already final: reveal it now.
            if (coverBoxHRef.current > 0 && Math.abs(h - approxPageH) < 1) {
              setCoverStable(true);
            }
          }}
          onScroll={(e) => {
            const next = e.nativeEvent.contentOffset.y <= 4;
            if (next !== atTopRef.current) {
              atTopRef.current = next;
              setAtTop(next);
            }
          }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
        <View
          style={{
            // Peek is reserved from `canLyrics` (known synchronously), not from
            // `lyrics` (resolved async): tying the first page's height to the
            // async result shrank it by LYRICS_PEEK the moment lyrics arrived,
            // which reflowed the cover slot and shoved the controls — the jump on
            // songs that have lyrics (and only those). Matching the card's own
            // render gate keeps the height stable from the first frame.
            height:
              (pageH || approxPageH) - (canLyrics && showLyricsCard ? LYRICS_PEEK : 0),
          }}
        >
        <View style={styles.topBar}>
          <CircleButton name="chevron-down" label={t('Close')} onPress={() => router.back()} />
          <Pressable
            style={styles.topTitleWrap}
            disabled={!sourceHref}
            accessibilityRole={sourceHref ? 'button' : undefined}
            onPress={() => {
              if (!sourceHref) return;
              router.back();
              router.navigate(sourceHref as never);
            }}
          >
            {source ? (
              <>
                <Text style={styles.topLabel}>{t('PLAYING FROM')}</Text>
                <Text style={styles.topSource} numberOfLines={1}>
                  {song?.url
                    ? t('Radio')
                    : source === SOURCE_FAVORITES
                      ? t('Favorites')
                      : source === SOURCE_HISTORY
                        ? t('History')
                        : source}
                </Text>
              </>
            ) : (
              <Text style={styles.topTitle}>{t('NOW PLAYING')}</Text>
            )}
          </Pressable>
          {isLocal && !offline ? (
            <View style={{ width: 40 }} />
          ) : swapButtons ? (
            // Swapped: the heart takes the corner. It only reports state here —
            // tapping it still works, it's just the awkward spot to reach.
            <View style={styles.topFavorite}>
              <FavoriteButton id={song.id} starred={favorited} size={24} />
            </View>
          ) : (
            <CircleButton name="ellipsis-vertical" label={t('More options')} onPress={() => openMenu(song, undefined, { showLyrics: hasLyrics })} />
          )}
        </View>

        <View
          style={[styles.coverWrap, { paddingTop: coverTopPad }]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            coverBoxHRef.current = h;
            setCoverBoxH(h);
            // `pageH` here is the render-time value: on the first paint it's 0
            // (this measure used the approximation, so don't reveal yet); once
            // the real height re-renders the page, this fires again with the
            // final measure and we reveal.
            if (pageH > 0) setCoverStable(true);
          }}
        >
          <GestureDetector gesture={coverGesture}>
            {/* Recycled carousel: the current cover centered and the neighbors at
                one screen, already entering on drag. No fade (transition 0): a
                panel's content only changes off-screen and a fade is pointless
                here. */}
            <Animated.View style={[{ width: coverSize, height: coverSize }, coverAppearStyle]}>
              {paneStyles.map((paneStyle, k) => {
                const rel = paneRel(k);
                const paneSong = rel === 0 ? song : rel === 1 ? nextSong : prevSong;
                const paneCover = rel === 0 ? cover : rel === 1 ? nextCover : prevCover;
                return (
                  <Animated.View key={k} style={[styles.coverPane, paneStyle]}>
                    {/* With lyrics in place the cover is hidden: the lyrics
                        (transparent background) sit on top of the player background. */}
                    {paneSong && !inlineLyrics ? (
                      <Cover
                        uri={paneCover}
                        size={coverSize}
                        contentFit={fitCoverArt ? 'contain' : 'cover'}
                        transition={0}
                        placeholderIcon={paneSong.url ? 'radio' : 'musical-notes'}
                      />
                    ) : null}
                  </Animated.View>
                );
              })}
            </Animated.View>
          </GestureDetector>
          {/* Lyrics in place of the cover (setting): same frame, on top. */}
          {inlineLyrics && hasLyrics ? (
            <View style={[styles.lyricsOverlay, { height: coverSize }]}>
              <CoverLyrics size={coverSize} onClose={() => setInlineLyrics(false)} />
            </View>
          ) : null}
          {/* Inside the slot and right after the cover, so it hangs from the
              artwork instead of from the title: the spare height falls below
              both. Its measured height is discounted from `coverSize`. */}
          {canRate ? (
            <View
              style={styles.belowCover}
              onLayout={(e) => setStarsH(e.nativeEvent.layout.height)}
            >
              <StarRating
                id={song.id}
                rating={song.userRating}
                size={20}
                onRated={(r) => rateSong(song.id, r)}
              />
            </View>
          ) : null}
        </View>

        {/* The safe area is kept here rather than on the SafeAreaView: the
            scroll has to reach the bottom edge for the lyrics card, and it is
            this block, the last thing on the first page, that must not end up
            under the navigation bar. */}
        <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.meta}>
            <View style={{ flex: 1 }}>
              {song.albumId ? (
                <Pressable
                  style={styles.tapText}
                  hitSlop={6}
                  onPress={() => router.push(`/album/${song.albumId}` as never)}
                >
                  <MarqueeText text={title} style={styles.title} enabled={marqueeTitles} />
                </Pressable>
              ) : (
                <MarqueeText text={title} style={styles.title} enabled={marqueeTitles} />
              )}
              {(() => {
                const targets = artistTargets(song);
                const goArtist =
                  targets.length === 0
                    ? undefined
                    : () =>
                        targets.length > 1
                          ? openArtistPicker(targets)
                          : router.push(`/artist/${targets[0].id}`);
                const goAlbum = song.albumId
                  ? () => router.push(`/album/${song.albumId}` as never)
                  : undefined;
                return (
                  <>
                    <Text
                      style={styles.artist}
                      numberOfLines={1}
                      onPress={goArtist}
                      suppressHighlighting
                    >
                      {artistName}
                    </Text>
                    {/* Its own line: next to the artist the two ran together and
                        the album was hard to pick out. */}
                    {albumInfo ? (
                      <Text
                        style={styles.album}
                        numberOfLines={1}
                        onPress={goAlbum}
                        suppressHighlighting
                      >
                        {albumInfo}
                      </Text>
                    ) : null}
                  </>
                );
              })()}
            </View>
            {isLocal && !offline ? null : swapButtons ? (
              <CircleButton
                name="ellipsis-vertical"
                label={t('More options')}
                onPress={() => openMenu(song, undefined, { showLyrics: hasLyrics })}
              />
            ) : (
              <FavoriteButton id={song.id} starred={favorited} size={26} />
            )}
          </View>

          {showQualityBadge ? (
            <View style={styles.subInfo}>
              <AudioQualityBadge song={song} />
            </View>
          ) : null}

          <PlayerProgress duration={duration} onSeek={seekTo} />

          <View style={styles.controls}>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Shuffle')}
              onPress={toggleShuffle}
            >
              <Ionicons
                name="shuffle"
                size={26}
                color={shuffle ? colors.accent : colors.text}
              />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Previous')}
              onPress={previous}
            >
              <Ionicons name="play-skip-back" size={34} color={colors.text} />
            </Pressable>
            {seekButtonsSec > 0 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Back {n} seconds', { n: seekButtonsSec })}
                onPress={() =>
                  seekTo(
                    Math.max(0, usePlayerStore.getState().positionSec - seekButtonsSec),
                  )
                }
              >
                <MaterialIcons
                  name={`replay-${seekButtonsSec}` as 'replay-10'}
                  size={28}
                  color={colors.text}
                />
              </Pressable>
            ) : null}
            <Pressable
              style={styles.playButton}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('Pause') : t('Play')}
              onPress={toggle}
               // Real stop: stops and clears queue, mini player and
               // notification. No need to close the player manually: the
               // "no song" effect already closes it, and the Undo toast stays
               // on the screen underneath.
              onLongPress={() => {
                haptic('medium');
                void usePlayerStore
                  .getState()
                  .stopAndClear()
                  .then((undo) => {
                    if (!undo) return;
                    useToast.getState().show(t('Playback stopped'), { label: t('Undo'), run: undo });
                  });
              }}
            >
              {isBuffering ? (
                <ActivityIndicator size="small" color="#101010" />
              ) : (
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={34}
                  color="#101010"
                  style={!isPlaying && { marginLeft: 3 }}
                />
              )}
            </Pressable>
            {seekButtonsSec > 0 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Forward {n} seconds', { n: seekButtonsSec })}
                onPress={() =>
                  // Cap before the end: skipping past didJustFinish manually
                  // would leave auto-advance without triggering.
                  seekTo(
                    duration > 0
                      ? Math.min(duration - 1, usePlayerStore.getState().positionSec + seekButtonsSec)
                      : usePlayerStore.getState().positionSec + seekButtonsSec,
                  )
                }
              >
                <MaterialIcons
                  name={`forward-${seekButtonsSec}` as 'forward-10'}
                  size={28}
                  color={colors.text}
                />
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Next')}
              onPress={next}
            >
              <Ionicons name="play-skip-forward" size={34} color={colors.text} />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Repeat')}
              onPress={cycleRepeat}
            >
              <MaterialIcons
                name={repeat === 'one' ? 'repeat-one' : 'repeat'}
                size={26}
                color={repeatActive ? colors.accent : colors.text}
              />
            </Pressable>
          </View>

          {showDevicesButton || showQueueButton || remoteDevice ? (
            <View style={styles.bottomRow}>
              <View style={styles.bottomSlot}>
                {/* Connected to a remote device it's always shown: it's the
                    only way to disconnect the cast. */}
                {showDevicesButton || remoteDevice ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('Devices')}
                    disabled={offline}
                    onPress={() => setOutputOpen(true)}
                    style={styles.deviceRow}
                  >
                    <MaterialIcons
                      name="devices"
                      size={22}
                      color={remoteDevice ? colors.accent : offline ? colors.textMuted : colors.text}
                    />
                    {remoteDevice ? (
                      <Text style={[styles.deviceName, { color: colors.accent }]} numberOfLines={1}>
                        {remoteDevice}
                      </Text>
                    ) : null}
                  </Pressable>
                ) : null}
              </View>
              {showQueueButton ? (
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('View queue')}
                  onPress={() => router.push('/queue')}
                >
                  <MaterialIcons name="queue-music" size={24} color={colors.text} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        </View>
        {canLyrics && showLyricsCard ? <LyricsCard /> : null}
        </ScrollView>
        </SafeAreaView>
        <OutputSheet visible={outputOpen} onClose={() => setOutputOpen(false)} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  // Darkens the blurred artwork so the white text keeps its contrast whatever
  // the cover is. Tuned by eye: any lighter and pale covers wash the title out.
  coverScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  // Horizontal padding lives in each section (not here): so the slider can
  // overshoot its internal margin without the ScrollView clipping the thumb.
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  circle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitleWrap: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  topTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  topLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  topSource: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  // The elastic slot: takes whatever the rest leaves over, and `coverSize` is
  // measured from here. `minHeight: 0` so it can actually shrink.
  // `flex-start` plus a computed `paddingTop` instead of `center`: this way the
  // split of the spare height is ours to decide (see COVER_TOP_SHARE) rather
  // than a fixed 50/50, which left too big a hole above the cover.
  coverWrap: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: spacing.lg,
  },
  // Carousel panels are absolute (usePaneStyle positions them); the row that
  // reserves the cover art slot is sized inline, since it's dynamic now.
  coverPane: { position: 'absolute', top: 0, left: 0 },
  // Lyrics overlay on top of the cover frame: same height (set inline, it
  // follows the cover) and horizontally centered (coverWrap is wider than the
  // cover; without this the lyrics would be left-aligned).
  lyricsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // Natural height (no `flex: 1`): the slack goes to `coverWrap`, which is what
  // gives it up when the options don't fit. `paddingBottom` is overridden at
  // the call site to add the safe area on top of it.
  bottom: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  // The tappable area fits the text (not the full width), to avoid navigating
  // when tapping the empty space on the right.
  // Hugs the text: the tappable area is just the title/artist, not the row.
  tapText: { alignSelf: 'flex-start', maxWidth: '100%' },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  // A step below the artist so the three lines read as a hierarchy
  // (title → artist → album) instead of three rows of the same weight.
  album: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  subInfo: { marginTop: -spacing.sm, marginBottom: spacing.xs },
  progress: { marginBottom: spacing.xs },
  // Compensates for the slider's internal margin (~15px, where the thumb is
  // centered at the extremes): the visible track goes edge to edge of the
  // content, like Spotify, and the thumb extends into the gap without being
  // clipped.
  slider: { marginHorizontal: -15 },
  // Snug against the bar: the slider brings lots of vertical space (touch area).
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  time: { color: colors.textMuted, fontSize: fontSize.xs },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  playButton: {
    backgroundColor: colors.text,
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stars centered below the cover (optional element).
  belowCover: { alignItems: 'center', marginTop: spacing.md },
  // Same footprint as the CircleButton it replaces when swapped, so the
  // centered title doesn't shift.
  topFavorite: { width: 40, alignItems: 'center', justifyContent: 'center' },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
  },
  // Flexible slot for the devices button: keeps the queue in place even if
  // the button is hidden, and lets the device name expand.
  bottomSlot: {
    flex: 1,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  // Like Spotify Connect: icon + device name in accent when casting.
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
    paddingRight: spacing.lg,
  },
  deviceName: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '600',
    flexShrink: 1,
  },
});
