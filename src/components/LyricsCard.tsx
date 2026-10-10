/**
 * Spotify/Apple Music style lyrics for the player: card below the controls
 * with the cover's dominant color. Inside, karaoke with auto-scroll if the
 * lyrics are synced (tapping a line seeks to that point) and animated focus on
 * the current line (the rest are dimmed). Button to expand to full screen
 * (/lyrics). If the song has no lyrics, nothing is rendered.
 */
import Icon from '@/components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  ReduceMotion,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
  type SharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { COVER, songCoverUrl } from '@/api/data';
import { useCoverRadius } from '@/components/Cover';
import { type LyricLine, type LyricWord } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { wordEnds } from '@/lib/lyricWords';
import { pushOnce } from '@/lib/pushOnce';
import { currentSong, usePlayerStore } from '@/store/player';
import { type LyricsSize, useSettings } from '@/store/settings';
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
 * and grows a little (spring), the rest are dimmed. Auto-scroll keeps the
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
  const current = usePlayerStore((s) => {
    // Small advance so the highlight doesn't lag behind the ear.
    const posMs = s.positionSec * 1000 + LINE_LEAD_MS;
    let at = -1;
    for (let i = 0; i < lines.length && (lines[i].start ?? 0) <= posMs; i++) at = i;
    return at;
  });
  const seekTo = usePlayerStore((s) => s.seekTo);
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
  const centered = useSettings((s) => s.lyricsAlign) === 'center';

  const onMeasure = useCallback((index: number, y: number, h: number) => {
    offsets.current[index] = { y, h };
    // Only the line being waited for, and only until it has been reached: one
    // render, not one per line.
    if (index === currentRef.current && placedFor.current !== index) setPlaced((n) => n + 1);
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
          cancelAnimation(targetY);
          if (resumeTimer.current) clearTimeout(resumeTimer.current);
        }}
        onScrollEndDrag={() => {
          resumeTimer.current = setTimeout(() => {
            userScroll.current = false;
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
        {lines.map((line, i) => (
          <LyricRow
            key={i}
            index={i}
            text={line.value.trim() || '♪'}
            words={line.words}
            active={i === current}
            past={current >= 0 && i < current}
            next={i === current + 1}
            handover={handoverOf(lines, i)}
            large={large}
            size={size}
            centered={centered}
            onMeasure={onMeasure}
          />
        ))}
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

/** A lyric line with animated focus (spring on activation). */
const LyricRow = memo(({
  index,
  text,
  words,
  active,
  past,
  next,
  handover,
  large,
  size,
  centered,
  onMeasure,
}: {
  index: number;
  text: string;
  words?: LyricWord[];
  active: boolean;
  /** Lines before the current one: same colour as active, slightly dimmer. */
  past: boolean;
  next: boolean;
  /** When the row stops being the active one, in the clock the words fill at. */
  handover?: number;
  large?: boolean;
  size: LyricsSize;
  centered: boolean;
  onMeasure: (index: number, y: number, h: number) => void;
}) => {
  // Memoized, so the screen repainting is not enough to bring this one along.
  useTheme();
  // Only the active line grows (spring) and is visible at 100%. Past lines are
  // nearly as bright; the next one is semi-dimmed; everything else is faint.
  const focus = useSharedValue(active ? 1 : 0);
  const dim = useSharedValue(past ? 0.85 : active ? 1 : next ? 0.55 : 0.3);
  // reduceMotion Never: the transition between lines (karaoke) is the essence
  // of the screen; without this, devices with "reduce motion" skip it.
  useEffect(() => {
    focus.value = withSpring(active ? 1 : 0, {
      damping: 20,
      stiffness: 180,
      mass: 0.5,
      reduceMotion: ReduceMotion.Never,
    });
  }, [active, focus]);
  useEffect(() => {
    dim.value = withTiming(past ? 0.85 : active ? 1 : next ? 0.55 : 0.3, {
      duration: motion.duration.enter,
      reduceMotion: motion.reduceMotion.essential,
    });
  }, [active, past, next, dim]);
  // The growth (8%) is compensated by the right margin of `content` so the
  // active line, scaling from the left, doesn't overflow the edge.
  const anim = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: [{ scale: 1 + focus.value * 0.08 }],
  }));
  return (
    <View
      onLayout={(e) => onMeasure(index, e.nativeEvent.layout.y, e.nativeEvent.layout.height)}
    >
      <Animated.Text style={[lyricsLineStyle(large, size, centered), centered ? styles.centerOrigin : styles.leftOrigin, anim]}>
        {active && words ? <SungWords words={words} handover={handover} /> : text}
      </Animated.Text>
    </View>
  );
});
LyricRow.displayName = 'LyricRow';

/** Ahead of the ear, like the line's own advance, but less: a word is short. */
const WORD_LEAD_MS = 100;

/** How far ahead of the ear a line is highlighted as the one being sung. */
const LINE_LEAD_MS = 300;

/**
 * When a line stops being the one on screen, in the clock the words fill at.
 *
 * The line is highlighted LINE_LEAD_MS before its own start and the words
 * fill WORD_LEAD_MS ahead of the ear, so from where the fill reads, the row
 * goes when the next line is LINE_LEAD_MS - WORD_LEAD_MS out. Ending words
 * there rather than at whatever the source says is what keeps the last word
 * of a phrase - the held one, the one this was all asked for - from jumping
 * to full colour (and its shine from vanishing) the moment its row stops
 * being the active one.
 */
function handoverOf(lines: LyricLine[], i: number): number | undefined {
  const next = lines[i + 1]?.start;
  return next === undefined ? undefined : next - LINE_LEAD_MS + WORD_LEAD_MS;
}

/**
 * How often JS reads the position and aims the fill at where the song will
 * be by the next read. Not how often the fill moves: that is every frame, on
 * the UI thread, between one read and the next.
 */
const TICK_MS = 50;

/**
 * The position the words fill at, as a shared value rather than as state.
 *
 * The player moves `positionSec` twice a second, which is fine for a line and
 * far too coarse for a word: a quick one used to light up late or not at all.
 * So between those updates this runs on by itself while playing, never more
 * than a second past the last real one in case they stop coming. Each read is
 * handed over as a timing aimed at where the next read will land, so the
 * value keeps moving at the song's own rate and arrives on every read: the
 * fill neither steps (as a value set raw every 50 ms would) nor lags (as one
 * aimed only at the present would, by a tick).
 */
function useSungPosition(): SharedValue<number> {
  const pos = useSharedValue(usePlayerStore.getState().positionSec * 1000 + WORD_LEAD_MS);
  useEffect(() => {
    let anchor = { sec: usePlayerStore.getState().positionSec, at: Date.now() };
    const unsubscribe = usePlayerStore.subscribe((s, prev) => {
      if (s.positionSec !== prev.positionSec) anchor = { sec: s.positionSec, at: Date.now() };
    });
    const read = () => {
      const { isPlaying, speed } = usePlayerStore.getState();
      const ahead = isPlaying ? Math.min((Date.now() - anchor.at) * (speed || 1), 1000) : 0;
      return anchor.sec * 1000 + ahead + WORD_LEAD_MS;
    };
    let last = pos.value;
    const timer = setInterval(() => {
      const { isPlaying, speed } = usePlayerStore.getState();
      const target = read() + TICK_MS * (isPlaying ? speed || 1 : 0);
      // A seek is somewhere else entirely: it lands there rather than
      // travelling, which would light up every word on the way through.
      if (Math.abs(target - last) > 1000) pos.value = target;
      else
        pos.value = withTiming(target, {
          duration: TICK_MS,
          easing: Easing.linear,
          // Same answer as the line's own transition: the fill is the
          // karaoke, not something decorating it.
          reduceMotion: motion.reduceMotion.essential,
        });
      last = target;
    }, TICK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [pos]);
  return pos;
}

/** The word's own colour at the 40% it waits at, as it always has been. */
function waitingColor(text: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(text);
  if (!m) return `${text}66`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.4)`;
}

/** Where a word is in its own span: before its start, past its end, between. */
function clamp01(value: number): number {
  // The fill calls this from a worklet, which runs on the UI thread: without
  // the directive it arrives there as a remote function and throws - hard
  // enough to take the whole app down with it.
  'worklet';
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * How long a word is sung before it counts as one sung slowly: nothing for a
 * word got through under a quarter of a second, everything for a note held
 * over a second. The case this was asked for - the last word of a phrase,
 * held while the line waits for the next one - lands at the far end of it.
 */
const QUICK_WORD_MS = 250;
const HELD_WORD_MS = 1200;

/** The shine: how much even a quick word gets, how far it spreads, how bright. */
const BLOOM_FLOOR = 0.2;
const BLOOM_RADIUS = 9;
const BLOOM_ALPHA = 0.6;

/** How long the shine lingers after the word it belongs to is out. */
const BLOOM_FADE_MS = 500;

/**
 * The least it is allowed to linger, for when the row hands over before the
 * full fade would have run: a shine cut off at full strength shows, one
 * dimmed over this is simply gone.
 */
const BLOOM_FADE_MIN_MS = 120;

/**
 * One word, filling with colour for as long as it is sung.
 *
 * Not a light switched on at its start: the fill is where the song is against
 * this word's own span, read on the UI thread every frame, so it moves at the
 * song's own rate and never steps. `slow` is how long the word is given, and
 * it is what the shine answers to - a word pronounced slowly blooms as it
 * fills, a quick one barely does. The shine is gone again shortly after the
 * word is out, and always before the row does, so what shines is the word
 * being sung and not the line it sits in.
 */
const SungWord = memo(function SungWord({
  value,
  start,
  end,
  handover,
  pos,
}: {
  value: string;
  start: number;
  end: number;
  /** When the row hands over, which the shine never outlives. */
  handover?: number;
  pos: SharedValue<number>;
}) {
  // Memoized, so the theme has to come in from here (like LyricRow's own).
  const theme = useTheme();
  const waiting = waitingColor(theme.text);
  const lit = theme.text;
  const dur = Math.max(end - start, 1);
  /** How slowly this word is sung: 0 for a quick one, 1 for a held note. */
  const slow = clamp01((dur - QUICK_WORD_MS) / (HELD_WORD_MS - QUICK_WORD_MS));
  // When the shine is out: the full fade when there is room for it, and
  // whatever room there is when there is not - but never past the handover,
  // where the row leaves the screen and it would vanish instead of dimming.
  const fadeEnd = Math.min(end + BLOOM_FADE_MS, handover ?? Infinity);
  const fadeStart = Math.min(end, fadeEnd - BLOOM_FADE_MIN_MS);
  const fadeDur = Math.max(fadeEnd - fadeStart, 1);
  const style = useAnimatedStyle(() => {
    const fill = clamp01((pos.value - start) / dur);
    const after = clamp01((pos.value - fadeStart) / fadeDur);
    const bloom = fill * (1 - after) * (BLOOM_FLOOR + (1 - BLOOM_FLOOR) * slow);
    return {
      color: interpolateColor(fill, [0, 1], [waiting, lit]),
      textShadowColor: `rgba(255, 255, 255, ${Math.round(bloom * BLOOM_ALPHA * 100) / 100})`,
      textShadowRadius: bloom * BLOOM_RADIUS,
    };
  }, [start, dur, fadeStart, fadeDur, waiting, lit, slow]);
  return (
    <Animated.Text style={[{ textShadowOffset: { width: 0, height: 0 } }, style]}>
      {value}
    </Animated.Text>
  );
});
SungWord.displayName = 'SungWord';

/**
 * The line being sung, word by word (#165): what has been sung is filled and
 * the rest waits, dimmer - each word taking as long to fill as it takes to
 * sing. Only the active line runs.
 */
function SungWords({ words, handover }: { words: LyricWord[]; handover?: number }) {
  const pos = useSungPosition();
  const ends = wordEnds(words, handover);
  return (
    <>
      {words.map((w, i) => (
        <SungWord
          key={i}
          value={w.value}
          start={w.start}
          end={ends[i]}
          handover={handover}
          pos={pos}
        />
      ))}
    </>
  );
}

/** Typography shared by the card and the full screen. */
export const lyricsStyles = themed((colors) => ({
  line: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '500',
    paddingVertical: spacing.xs,
  },
  lineLarge: { fontSize: 28, lineHeight: 40, paddingVertical: spacing.sm },
  lineLargeSmall: { fontSize: 22, lineHeight: 32, paddingVertical: spacing.sm },
  lineLargeLarge: { fontSize: 34, lineHeight: 48, paddingVertical: spacing.sm },
  centered: { textAlign: 'center' },
}));

/**
 * The line style with the reader's settings on it: the size only on the full
 * screen (`large`), the alignment everywhere lyrics are shown.
 */
export function useLyricsLineStyle(large?: boolean) {
  const size = useSettings((s) => s.lyricsSize);
  const centered = useSettings((s) => s.lyricsAlign) === 'center';
  return lyricsLineStyle(large, size, centered);
}

function lyricsLineStyle(large: boolean | undefined, size: LyricsSize, centered: boolean) {
  return [
    lyricsStyles.line,
    large &&
      (size === 'small'
        ? lyricsStyles.lineLargeSmall
        : size === 'large'
          ? lyricsStyles.lineLargeLarge
          : lyricsStyles.lineLarge),
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
