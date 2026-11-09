/**
 * Spotify/Apple Music style lyrics for the player: card below the controls
 * with the cover's dominant color. Inside, karaoke with auto-scroll if the
 * lyrics are synced (tapping a line seeks to that point) and animated focus on
 * the current line (the rest are dimmed). Button to expand to full screen
 * (/lyrics). If the song has no lyrics, nothing is rendered.
 */
import Icon from '@/components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import * as Font from 'expo-font';
import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
  type SharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { COVER, songCoverUrl } from '@/api/data';
import { useCoverRadius } from '@/components/Cover';
import { KaraokeWords } from '@/components/KaraokeWords';
import { type LyricLine, type LyricWord } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { lyricBlurRadius, WORD_SWEEP_LEAD_MS } from '@/lib/lyricMotion';
import { clamp01, hasGapAfter, hasIntroGap, lineEndMs } from '@/lib/lyricSweep';
import { pushOnce } from '@/lib/pushOnce';
import { currentSong, usePlayerStore } from '@/store/player';
import {
  LYRICS_SIZE_POINTS,
  APP_FONT_FAMILY,
  type LyricsSize,
  type LyricsWeight,
  useSettings,
} from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { motion } from '@/theme/motion';

export function LyricsCard() {
  const t = useT();
  const song = usePlayerStore(currentSong);
  const { data } = useLyrics(song ?? undefined);
  // Same setting as the full screen; without color, neutral gray (surface)
  // so the card still stands out from the player background.
  // Its own setting (no blurred-cover option): `bg` doubles as the solid
  // `fadeColor` the synced lyrics fade into, which an image can't provide.
  const tinted = useSettings((s) => s.lyricsCardBackground) !== 'none';
  const dominant = useDominantColor(
    // Without color the palette is not extracted (same savings the player does).
    tinted ? song ? songCoverUrl(song, COVER.card) : undefined : undefined,
  );
  const bg = tinted ? dominant : colors.surface;
  const lineStyle = useLyricsLineStyle();
  const centered = useSettings((s) => s.lyricsAlign) === 'center';

  if (!data) return null;

  return (
    <View style={[styles.card, { backgroundColor: bg }]}>
      <Text style={styles.title}>{t('Lyrics')}</Text>
      <View style={styles.body}>
        {data.synced ? (
          <SyncedLyricsView lines={data.lines} nested fadeColor={bg} />
        ) : (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.content, centered && styles.contentCentered]}
          >
            <Text style={lineStyle}>{data.lines.map((l) => l.value).join('\n')}</Text>
          </ScrollView>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [styles.expand, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('Lyrics')}
        hitSlop={8}
        onPress={() => pushOnce('/lyrics')}
      >
        <Icon name="expand-outline" size={16} color={colors.onInverse} />
      </Pressable>
    </View>
  );
}

/**
 * Lyrics in place of the cover art ("Lyrics on the cover" setting): occupies
 * the same box as the player cover. Same karaoke as the card, with a button
 * in the corner to go back to the cover. Shows a spinner while fetching and
 * an empty message if no lyrics are available.
 */
export function CoverLyrics({ size, onClose }: { size: number; onClose: () => void }) {
  const t = useT();
  const corner = useCoverRadius(size);
  const song = usePlayerStore(currentSong);
  const { data, isLoading } = useLyrics(song ?? undefined);
  const lineStyle = useLyricsLineStyle();
  const centered = useSettings((s) => s.lyricsAlign) === 'center';

  return (
    // Transparent background: the lyrics go directly over the player background
    // (the cover is hidden while showing).
    <View style={[styles.coverBox, { width: size, height: size, borderRadius: corner }]}>
      <View style={styles.coverBody}>
        {isLoading ? (
          <View style={styles.coverStatus}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : data?.synced ? (
          <SyncedLyricsView lines={data.lines} nested />
        ) : data ? (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.content, centered && styles.contentCentered]}
          >
            <Text style={lineStyle}>{data.lines.map((l) => l.value).join('\n')}</Text>
          </ScrollView>
        ) : (
          <View style={styles.coverStatus}>
            <Text style={styles.coverEmpty}>{t('No lyrics available for this song.')}</Text>
          </View>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [styles.expand, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('Show cover')}
        hitSlop={8}
        onPress={onClose}
      >
        <Icon name="image-outline" size={16} color={colors.onInverse} />
      </Pressable>
    </View>
  );
}

/**
 * Reusable karaoke list (card and full screen): the current line lights up
 * and grows a little, the rest are dimmed. Auto-scroll keeps the
 * focus above; manual scroll pauses it for a few seconds. Tapping a line
 * seeks to that point in the song.
 */
export function SyncedLyricsView({
  lines,
  large,
  nested,
  fadeColor,
}: {
  lines: LyricLine[];
  /** Large typography (full screen). */
  large?: boolean;
  /** Inside another scroll (the player card). */
  nested?: boolean;
  /** Color to which the top/bottom edges fade (the background). */
  fadeColor?: string;
}) {
  // The line, not the position: the position moves twice a second and the
  // line every few, and only a new line has anything to redraw.
  // Word timing is already precise, so it only gets a small pre-roll.
  // Hand-tapped line LRC keeps a little more compensation for human reaction.
  const wordTimed = lines.some((line) => line.words && line.words.length > 0);
  const lead = wordTimed ? WORD_SWEEP_LEAD_MS : 250;
  const tickCurrent = usePlayerStore((s) => {
    const posMs = s.positionSec * 1000 + lead;
    let at = -1;
    for (let i = 0; i < lines.length && (lines[i].start ?? 0) <= posMs; i++) at = i;
    return at;
  });
  const seekTo = usePlayerStore((s) => s.seekTo);
  // Millisecond clock shared by the gap leaders: same runway pattern as the
  // karaoke words (re-anchored on every store beat, gliding between them),
  // one per list instead of one per row.
  const gapClock = useGapClock();
  // The store beats twice a second: a line whose first word is shorter than
  // the wait mounts already sung, and the sweep jumps straight past it. The
  // list clock glides on the UI thread instead, so the flip is derived from
  // it exactly at the boundary (same rule as the store pass, same lead). It
  // fires once per line, like before - only on time.
  const [liveCurrent, setLiveCurrent] = useState(-1);
  const startsRef = useSharedValue<number[]>([]);
  useEffect(() => {
    startsRef.value = lines.map((line) => line.start ?? 0);
    setLiveCurrent(-1);
  }, [lines, startsRef]);
  useAnimatedReaction(
    () => {
      const posMs = gapClock.value + lead;
      const starts = startsRef.value;
      let at = -1;
      for (let i = 0; i < starts.length && starts[i] <= posMs; i++) at = i;
      return at;
    },
    (at, prev) => {
      if (at !== prev) scheduleOnRN(setLiveCurrent, at);
    },
  );
  const current = liveCurrent >= 0 ? liveCurrent : tickCurrent;
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // Real scroll position (regardless of who moved it: user or auto-scroll).
  const liveY = useScrollViewOffset(scrollRef);
  // Auto-scroll target. Animated with Reanimated (not native smooth-scroll) for
  // two reasons: native respects the system animation scale (with "reduced
  // motion" it snaps abruptly) and while running, the ScrollView swallows taps
  // on the lines.
  const targetY = useSharedValue(0);
  const offsets = useRef<{ y: number; h: number }[]>([]);
  const userScroll = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewH, setViewH] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  /**
   * Bumped when the line being aimed at finally reports where it is.
   *
   * The positioning below waits for that, and reads it out of a ref, and a ref
   * filling up re-renders nothing: opening the lyrics part way through a song
   * left them at the top, because by the time the line answered there was
   * nothing listening. What ran the positioning next was the song moving on a
   * line, so they sat still and then travelled, one line late, every time. Now
   * the measurement says so itself.
   */
  const [placed, setPlaced] = useState(0);
  /** The line already positioned for, so a measurement only speaks up once. */
  const placedFor = useRef(-1);
  /** What `onMeasure` needs to know without being rebuilt on every line. */
  const currentRef = useRef(-1);

  currentRef.current = current;

  // In full screen we anchor the active line near the center (and pad
  // top/bottom) so that when the song starts, the lyrics begin centered and
  // readable, not stuck to the top edge. On the small card, higher up.
  const anchor = large ? 0.42 : 0.3;
  const size = useSettings((s) => s.lyricsSize);
  const weight = useSettings((s) => s.lyricsWeight);
  const centered = useSettings((s) => s.lyricsAlign) === 'center';
  const blurInactiveLyrics = useSettings((s) => s.blurInactiveLyrics);
  const blurEnabled = blurInactiveLyrics && !browsing;

  const onMeasure = useCallback((index: number, y: number, h: number) => {
    const previous = offsets.current[index];
    offsets.current[index] = { y, h };
    // The active row speaks once when it first appears, then again only if a
    // typography change actually moved or resized it. That recentres a line
    // immediately after the listener changes the font size without turning
    // every ordinary layout pass into another render.
    const changed = previous === undefined || previous.y !== y || previous.h !== h;
    if (index === currentRef.current && (placedFor.current !== index || changed)) {
      setPlaced((n) => n + 1);
    }
  }, []);

  // Each targetY change pushes the scroll from the UI thread.
  useAnimatedReaction(
    () => targetY.value,
    (y, prev) => {
      if (prev !== null && y !== prev) scrollTo(scrollRef, 0, y, false);
    },
  );

  // Tapping a line is an intentional seek: we cancel the auto-scroll pause
  // triggered by manual scroll (the user usually scrolled to reach this
  // line), so the focus recenters on the chosen line instantly.
  const onLineTap = useCallback(
    (sec: number) => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      userScroll.current = false;
      setBrowsing(false);
      seekTo(sec);
    },
    [seekTo],
  );

  // Taps are detected with a separate gesture (not each line's onPress): the
  // gesture coexists with scroll and works even while auto-scroll is active.
  // The line is located by vertical position using actual measurements.
  const handleTap = useCallback(
    (yInView: number) => {
      const contentY = yInView + liveY.value;
      for (let i = 0; i < lines.length; i++) {
        const m = offsets.current[i];
        if (m && contentY >= m.y && contentY < m.y + m.h) {
          if (lines[i].start !== undefined) onLineTap(lines[i].start! / 1000);
          return;
        }
      }
    },
    [lines, onLineTap, liveY],
  );

  const tapGesture = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e) => {
      scheduleOnRN(handleTap, e.y);
    });

  useEffect(() => {
    if (current < 0 || viewH === 0 || userScroll.current) return;
    const m = offsets.current[current];
    if (m === undefined) return;
    const dest = Math.max(0, m.y - viewH * anchor);
    cancelAnimation(targetY);
    placedFor.current = current;
    // We start from the real position (the user may have scrolled) and animate
    // ourselves: same path on any device, regardless of whether the system
    // ignores animations. Opening part way through a song is the same journey
    // as any other, taken as soon as there is somewhere to go rather than at
    // the next line.
    targetY.value = liveY.value;
    targetY.value = withTiming(dest, {
      duration: motion.duration.scroll,
      easing: motion.easing.move,
      reduceMotion: motion.reduceMotion.essential,
    });
  }, [current, viewH, anchor, targetY, liveY, placed]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  const fadeH = large ? 56 : 36;

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={tapGesture}>
      <Animated.ScrollView
        ref={scrollRef}
        nestedScrollEnabled={nested}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onScrollBeginDrag={() => {
          userScroll.current = true;
          setBrowsing(true);
          cancelAnimation(targetY);
          if (resumeTimer.current) clearTimeout(resumeTimer.current);
        }}
        onScrollEndDrag={() => {
          resumeTimer.current = setTimeout(() => {
            userScroll.current = false;
            setBrowsing(false);
          }, 3000);
        }}
        contentContainerStyle={[
          styles.content,
          centered && styles.contentCentered,
          // Padding so the first/last line can rest at the anchor (center)
          // instead of being stuck at the top/bottom. Full screen only.
          large && viewH > 0 ? { paddingTop: viewH * anchor, paddingBottom: viewH * (1 - anchor) } : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {hasIntroGap(lines) && (lines[0].start ?? 0) > 0 ? (
          <GapDots start={0} end={lines[0].start ?? 0} pos={gapClock} large={large} />
        ) : null}
        {lines.map((line, i) => {
          // Computed here so the leader below reads the same silence the
          // scroll lead was derived from.
          const gap = hasGapAfter(lines, i) ? gapBounds(lines, i) : null;
          return (
          // Fragment, not a View: LyricRow's own onLayout must report `y`
          // relative to the scroll content. A wrapper would reset every row
          // to y≈0 and both auto-scroll and tap-to-seek would aim at the top.
          <Fragment key={i}>
          <LyricRow
            key={i}
            index={i}
            text={line.value.trim() || '♪'}
            words={line.words}
            active={i === current}
            past={current >= 0 && i < current}
            blurRadius={lyricBlurRadius(i, current, blurEnabled)}
            large={large}
            size={size}
            weight={weight}
            centered={centered}
            onMeasure={onMeasure}
          />
            {gap ? <GapDots start={gap.start} end={gap.end} pos={gapClock} large={large} /> : null}
          </Fragment>
          );
        })}
      </Animated.ScrollView>
      </GestureDetector>
      {fadeColor ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={[fadeColor, `${fadeColor}00`]}
            style={[styles.fade, { top: 0, height: fadeH }]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[`${fadeColor}00`, fadeColor]}
            style={[styles.fade, { bottom: 0, height: fadeH }]}
          />
        </>
      ) : null}
    </View>
  );
}

/** A lyric line with animated focus. */
const LyricRow = memo(({
  index,
  text,
  words,
  active,
  past,
  blurRadius,
  large,
  size,
  weight,
  centered,
  onMeasure,
}: {
  index: number;
  text: string;
  words?: LyricWord[];
  active: boolean;
  /** Lines before the current one: same colour as active, slightly dimmer. */
  past: boolean;
  /** Primuse-style depth blur; zero keeps the row's filter layer disabled. */
  blurRadius: number;
  large?: boolean;
  size: LyricsSize;
  weight: LyricsWeight;
  centered: boolean;
  onMeasure: (index: number, y: number, h: number) => void;
}) => {
  // Memoized, so the screen repainting is not enough to bring this one along.
  useTheme();
  // Same custom-font rule as the style hook below: with a user font file the
  // weight is dropped or iOS falls back to the system font.
  const appFont = useSettings((s) => s.appFont);
  const customFontFamily = useSettings((s) => s.customFontFamily);
  const customFont = appFont === 'custom' && !!customFontFamily;
  // Animated texts skip the global family injection (it only patches `Text`),
  // so the karaoke words carry the resolved family explicitly. Unloaded custom
  // files resolve to nothing and the system font stands in until they load.
  const fontFamily =
    appFont === 'custom'
      ? (customFontFamily && Font.isLoaded(customFontFamily) ? customFontFamily : undefined)
      : APP_FONT_FAMILY[appFont];
  // The line takeover coordinates scale and opacity with auto-scroll.
  // Blur takes a gentler path because a fast change reads as the completed
  // line suddenly losing focus.
  const focus = useSharedValue(active ? 1 : 0);
  const dim = useSharedValue(active ? 1 : past ? 0.36 : 0.46);
  const blur = useSharedValue(blurRadius);
  useEffect(() => {
    focus.value = withTiming(active ? 1 : 0, {
      duration: motion.duration.scroll,
      easing: motion.easing.move,
      reduceMotion: motion.reduceMotion.essential,
    });
  }, [active, focus]);
  useEffect(() => {
    dim.value = withTiming(active ? 1 : past ? 0.36 : 0.46, {
      duration: motion.duration.scroll,
      easing: motion.easing.move,
      reduceMotion: motion.reduceMotion.essential,
    });
  }, [active, past, dim]);
  useEffect(() => {
    blur.value = withTiming(blurRadius, {
      duration: motion.duration.depth,
      easing: motion.easing.depth,
      reduceMotion: motion.reduceMotion.essential,
    });
  }, [blur, blurRadius]);
  // The growth (8%) is compensated by the right margin of `content` so the
  // active line, scaling from the left, doesn't overflow the edge. iOS is
  // left out of the magnification: like the word bounce, scaling rasterized
  // masked text softens the glyphs, so there the takeover is dim only.
  const anim = useAnimatedStyle(() => {
    const radius = blur.value;
    return {
      opacity: dim.value,
      transform: Platform.OS === 'ios' ? [] : [{ scale: 1 + focus.value * 0.08 }],
      // RN's Android filter clips descendants. Omitting it entirely at zero
      // keeps the active word bounce free to rise outside its glyph box.
      filter: radius > 0.01 ? [{ blur: radius }] : undefined,
    };
  });
  const lineStyle = lyricsLineStyle(large, size, weight, centered, customFont);
  const flattened = StyleSheet.flatten(lineStyle) as TextStyle;
  // No `undefined` keys, ever: RN's flatten copies them over earlier styles,
  // which would wipe the injected font family (killing custom fonts) and the
  // Android weight fix. Only set keys carry over.
  const wordTextStyle: TextStyle = {
    ...(fontFamily ? { fontFamily } : {}),
    fontSize: flattened.fontSize,
    ...(flattened.fontStyle ? { fontStyle: flattened.fontStyle } : {}),
    ...(flattened.fontWeight ? { fontWeight: flattened.fontWeight } : {}),
    ...(flattened.letterSpacing ? { letterSpacing: flattened.letterSpacing } : {}),
    lineHeight: flattened.lineHeight,
  };
  const paddingVertical = typeof flattened.paddingVertical === 'number'
    ? flattened.paddingVertical
    : 0;

  return (
    <View
      onLayout={(e) => onMeasure(index, e.nativeEvent.layout.y, e.nativeEvent.layout.height)}
    >
      <Animated.View style={[centered ? styles.centerOrigin : styles.leftOrigin, anim]}>
        {words && words.length > 0 ? (
          <KaraokeWords
            words={words}
            active={active}
            centered={centered}
            textStyle={wordTextStyle}
            activeColor={colors.text}
            inactiveColor={`${colors.text}6B`}
            paddingVertical={paddingVertical}
          />
        ) : (
          <Text style={lineStyle}>{text}</Text>
        )}
      </Animated.View>
    </View>
  );
});
LyricRow.displayName = 'LyricRow';

/** Runway a shared ms clock glides over between store beats (no timer). */
const GAP_CLOCK_RUNWAY_MS = 1200;

/** List-level song clock for the gap leaders, mirroring the karaoke words. */
function useGapClock(): SharedValue<number> {
  // Driven by usePlayerStore.subscribe rather than reactive selectors so that
  // positionSec beats (every ~500ms) do not trigger re-renders in LyricList
  // and all its row children. The SharedValue is updated directly on each beat
  // and Reanimated worklets read it on the UI thread with no React involvement.
  const clockMs = useSharedValue(usePlayerStore.getState().positionSec * 1000);
  useEffect(() => {
    const advanceClock = (positionSec: number, playing: boolean, speed: number) => {
      cancelAnimation(clockMs);
      const start = positionSec * 1000;
      clockMs.value = start;
      if (playing) {
        clockMs.value = withTiming(start + GAP_CLOCK_RUNWAY_MS * (speed || 1), {
          duration: GAP_CLOCK_RUNWAY_MS,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        });
      }
    };

    const { positionSec, isPlaying, speed } = usePlayerStore.getState();
    advanceClock(positionSec, isPlaying, speed);

    let prevPos = positionSec, prevPlaying = isPlaying, prevSpeed = speed;
    return usePlayerStore.subscribe((s) => {
      if (s.positionSec === prevPos && s.isPlaying === prevPlaying && s.speed === prevSpeed) return;
      prevPos = s.positionSec;
      prevPlaying = s.isPlaying;
      prevSpeed = s.speed;
      advanceClock(s.positionSec, s.isPlaying, s.speed);
    });
  }, [clockMs]);
  return clockMs;
}

/** One dot of an instrumental gap leader, lit as the silence travels. */
const GapDot = memo(function GapDot({
  start,
  end,
  dot,
  pos,
  large,
}: {
  start: number;
  end: number;
  dot: number;
  pos: SharedValue<number>;
  large?: boolean;
}) {
  const theme = useTheme();
  const lit = theme.text;
  const style = useAnimatedStyle(() => {
    const through = clamp01((pos.value - start) / Math.max(end - start, 1));
    const litAt = clamp01(through * 3 - dot);
    // Each dot hops as the silence reaches its third of the gap, over a
    // gentle continuous bob tied to the song clock (frozen on pause, like
    // everything else karaoke).
    const hop = Math.sin(Math.PI * clamp01(through * 3 - dot));
    const bob = Math.sin(pos.value / 350 + dot * 2.094);
    return {
      opacity: 0.25 + 0.75 * litAt,
      transform: [{ translateY: -(hop * 4) + bob * 1.5 }, { scale: 0.76 + 0.24 * litAt }],
      backgroundColor: lit,
    };
  }, [start, end, dot, lit]);
  return <Animated.View style={[styles.gapDot, large && styles.gapDotLarge, style]} />;
});
GapDot.displayName = 'GapDot';

/** How early the dots zoom in before the silence, how late they leave after. */
const GAP_LEAD_MS = 400;
const GAP_TAIL_MS = 600;
/** The zoom itself: fast both ways. */
const GAP_ZOOM_MS = 220;

/**
 * Instrumental silence worth showing: three dots that zoom in just before
 * the silence, ride it out hopping one after another, and zoom away once the
 * singing resumes. The row collapses when closed so the lines below glide
 * instead of jumping over a hole. Full size on the lyrics screen, smaller on
 * cards, relative to the text.
 */
function GapDots({ start, end, pos, large }: { start: number; end: number; pos: SharedValue<number>; large?: boolean }) {
  const height = useSharedValue(0);
  const open = useSharedValue(0);
  const essential = motion.reduceMotion.essential;
  useAnimatedReaction(
    () => (pos.value >= start - GAP_LEAD_MS && pos.value < end + GAP_TAIL_MS ? 1 : 0),
    (show, prev) => {
      if (show !== prev) {
        open.value = withTiming(show, {
          duration: GAP_ZOOM_MS,
          easing: motion.easing.move,
          reduceMotion: essential,
        });
      }
    },
  );
  const zoom = useAnimatedStyle(() => ({
    height: height.value * open.value,
    opacity: open.value,
    transform: [{ scale: 0.7 + 0.3 * open.value }],
  }));
  return (
    <Animated.View style={[styles.gapClip, zoom]}>
      <View
        onLayout={(e) => {
          height.value = e.nativeEvent.layout.height;
        }}
        style={[styles.gapRow, large && styles.gapRowLarge]}
      >
        {[0, 1, 2].map((d) => (
          <GapDot key={d} start={start} end={end} dot={d} pos={pos} large={large} />
        ))}
      </View>
    </Animated.View>
  );
}

/** Bounds of the silence after line `i`, for its dot leader. */
function gapBounds(lines: LyricLine[], i: number): { start: number; end: number } {
  const nextStart = lines[i + 1]?.start ?? 0;
  return { start: lineEndMs(lines[i], nextStart) ?? nextStart, end: nextStart };
}

/** Typography shared by the card and the full screen. */
export const lyricsStyles = themed((colors) => ({
  line: {
    color: colors.text,
    paddingVertical: spacing.xs,
  },
  lineLarge: { paddingVertical: spacing.sm },
  centered: { textAlign: 'center' },
}));

/**
 * The line style with the reader's size, weight and alignment on every lyrics
 * surface. Compact cards scale the chosen full-screen size proportionally.
 */
export function useLyricsLineStyle(large?: boolean) {
  const size = useSettings((s) => s.lyricsSize);
  const weight = useSettings((s) => s.lyricsWeight);
  const centered = useSettings((s) => s.lyricsAlign) === 'center';
  // A user-picked font file holds a single face: on iOS naming both it and a
  // weight makes CoreText miss the file and fall back to the system font, so
  // the custom font would never apply to lyrics. With one, the weight goes.
  const appFont = useSettings((s) => s.appFont);
  const customFontFamily = useSettings((s) => s.customFontFamily);
  const customFont = appFont === 'custom' && !!customFontFamily;
  return lyricsLineStyle(large, size, weight, centered, customFont);
}

function lyricsLineStyle(
  large: boolean | undefined,
  size: LyricsSize,
  weight: LyricsWeight,
  centered: boolean,
  customFont: boolean,
) {
  // The setting is expressed in full-screen points. Compact surfaces retain
  // the old 20:28 ratio, so the default is visually unchanged while every
  // other size still follows the listener's choice.
  const points = LYRICS_SIZE_POINTS[size];
  const textSize = large
    ? points
    : Math.max(16, Math.round((points * 20) / LYRICS_SIZE_POINTS.normal));
  const lineHeight = Math.round(textSize * (large ? 10 / 7 : 1.5));
  return [
    lyricsStyles.line,
    large && lyricsStyles.lineLarge,
    // No weight key at all with a custom font file (see above): even an
    // `undefined` would read as set here.
    { fontSize: textSize, lineHeight, ...(customFont ? {} : { fontWeight: weight }) },
    centered && lyricsStyles.centered,
  ];
}

const CARD_BODY_H = 280;

const styles = themed((colors) => ({
  card: {
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    // The player no longer has global horizontal padding (because of the
    // slider): the card supplies its own margin.
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', marginBottom: spacing.sm },
  body: { height: CARD_BODY_H, overflow: 'hidden' },
  // Lyrics in place of the cover: box exactly the size of the cover.
  coverBox: { overflow: 'hidden', padding: spacing.lg },
  coverBody: { flex: 1, overflow: 'hidden' },
  coverStatus: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverEmpty: { color: colors.textSecondary, fontSize: fontSize.md, textAlign: 'center' },
  wrap: { flex: 1 },
  // Right margin so the active line (which grows 8% from the left) doesn't get
  // clipped against the edge.
  content: { paddingBottom: spacing.xl, paddingRight: '10%' },
  leftOrigin: { transformOrigin: 'left center' },
  centerOrigin: { transformOrigin: 'center center' },
  // Centred, the 8% growth spills to both sides, so the margin is split.
  contentCentered: { paddingRight: '5%', paddingLeft: '5%' },
  // Instrumental gap leaders: full size on the lyrics screen, smaller on
  // cards, relative to the text. The row collapses when the dots zoom away.
  gapClip: { overflow: 'hidden' },
  gapRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md, paddingLeft: spacing.xs },
  gapRowLarge: { gap: spacing.md, paddingVertical: spacing.lg },
  gapDot: { width: 8, height: 8, borderRadius: 4 },
  gapDotLarge: { width: 14, height: 14, borderRadius: 7 },
  fade: { position: 'absolute', left: 0, right: 0 },
  expand: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
