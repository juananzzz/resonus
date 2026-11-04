/**
 * Primuse-style word lyrics for React Native.
 *
 * The motion design is adapted from Primuse's MIT-licensed KaraokeLineView
 * (Copyright (c) 2026 Welape): a soft word-internal sweep, a small bottom-
 * anchored bounce, and layout-stable word wrapping. See THIRD_PARTY_NOTICES.md.
 */
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { LyricWord } from '@/api/subsonic';
import {
  lyricWordDurationMs,
  MIN_WORD_TRANSITION_MS,
  WORD_BOUNCE_SCALE,
  WORD_SWEEP_EDGE_FRACTION,
  WORD_SWEEP_LEAD_MS,
} from '@/lib/lyricMotion';
import { clamp01 } from '@/lib/lyricSweep';
import { wordGroups } from '@/lib/lyricWords';
import { usePlayerStore } from '@/store/player';

const CLOCK_RUNWAY_MS = 1200;

/**
 * Held-note shine: below this a word is got through too fast to glow, above
 * a second it blooms fully. What is sung slowly shines while it is sung and
 * lets go shortly after, never past the next row.
 */
const QUICK_WORD_MS = 250;
const HELD_WORD_MS = 1200;
/** How far the shine spreads at full bloom, how bright it gets. */
const BLOOM_RADIUS = 12;
const BLOOM_ALPHA = 1;
/** How long the shine lingers after the word it belongs to is out. */
const BLOOM_FADE_MS = 500;

interface KaraokeWordsProps {
  words: LyricWord[];
  active: boolean;
  centered: boolean;
  textStyle: StyleProp<TextStyle>;
  activeColor: string;
  inactiveColor: string;
  paddingVertical: number;
}

/**
 * Uses the same word-flow layout in active and inactive rows. Switching the
 * active line therefore never changes wrapping or measured row height.
 */
export const KaraokeWords = memo(function KaraokeWords({
  words,
  active,
  centered,
  textStyle,
  activeColor,
  inactiveColor,
  paddingVertical,
}: KaraokeWordsProps) {
  const label = words.map((word) => word.value).join('');
  const groups = wordGroups(words);
  const content = active ? (
    <ActiveWordFlow
      words={words}
      groups={groups}
      textStyle={textStyle}
      activeColor={activeColor}
      inactiveColor={inactiveColor}
    />
  ) : (
    inGroups(groups, (index) => {
      const word = words[index];
      const chars = splitChars(word.value);
      if (!chars) {
        return (
          <Text key={index} accessible={false} style={[textStyle, { color: activeColor }]}>
            {word.value}
          </Text>
        );
      }
      // Same split layout as the active row, without the clock behind it.
      return (
        <View key={index} style={styles.charRow}>
          {chars.map((ch, i) => (
            <Text key={i} accessible={false} style={[textStyle, { color: activeColor }]}>
              {ch}
            </Text>
          ))}
        </View>
      );
    })
  );

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.flow,
        centered && styles.flowCentered,
        { paddingVertical },
      ]}
    >
      {content}
    </View>
  );
});

/** Each group as one unbreakable box, a lone word as itself. */
function inGroups(groups: number[][], render: (index: number) => ReactNode) {
  return groups.map((group) =>
    group.length === 1 ? (
      render(group[0])
    ) : (
      <View key={`g${group[0]}`} style={styles.charRow}>
        {group.map(render)}
      </View>
    ),
  );
}

/** How far a letter rises at the peak of its wave. */
const CHAR_RISE_PX = 2;
/** Hold after a word is sung before its letters fall back, and over what span. */
const CHAR_FALL_DELAY_MS = 200;
const CHAR_FALL_MS = 350;

/** Scripts whose glyphs must not be cut apart: shaping and marks would break. */
const WHOLE_WORD_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF\u0E00-\u0EFF\u0F00-\u0FFF\u1000-\u109F]|\p{M}||/u;
const SPLITTABLE_RE = /^[\u0020-\u02FF\u0370-\u03FF\u0400-\u04FF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF\u00A0]*$/;

/**
 * A word cut into its letters for the rise wave, or null when the script
 * must stay whole. A trailing space rides as a non-breaking one so words
 * never glue together (same rule as the sweep word boxes).
 */
function splitChars(value: string): string[] | null {
  const display = value.endsWith(' ') ? value.slice(0, -1) + '\u00A0' : value;
  if (!SPLITTABLE_RE.test(display) || WHOLE_WORD_RE.test(display)) return null;
  return Array.from(display);
}

/**
 * One letter, rising as the sung frontier reaches it and staying up until the
 * whole row is sung: the wave travels left to right, then the row falls back
 * all at once instead of bobbing word by word.
 */
const WordChar = memo(function WordChar({ ch, textStyle, color, glow, clockMs, start, durationMs, lineEndMs, index, count, animated }: { ch: string; textStyle: StyleProp<TextStyle>; color: string; glow?: object; clockMs: SharedValue<number>; start: number; durationMs: number; lineEndMs: number; index: number; count: number; animated: boolean }) {
  const lift = useAnimatedStyle(() => {
    if (!animated) return { transform: [{ translateY: 0 }] };
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const fill = clamp01((clockMs.value - start) / duration);
    const rise = clamp01(fill * count - index);
    const release = clamp01((clockMs.value - (lineEndMs + CHAR_FALL_DELAY_MS)) / CHAR_FALL_MS);
    return { transform: [{ translateY: -CHAR_RISE_PX * rise * (1 - release) }] };
  });
  return (
    <Animated.Text
      accessible={false}
      style={[textStyle, { color, textShadowOffset: { width: 0, height: 0 } }, glow, lift]}
    >
      {ch}
    </Animated.Text>
  );
});
WordChar.displayName = 'WordChar';

function ActiveWordFlow({
  words,
  groups,
  textStyle,
  activeColor,
  inactiveColor,
}: Omit<KaraokeWordsProps, 'active' | 'centered' | 'paddingVertical'> & { groups: number[][] }) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const speed = usePlayerStore((s) => s.speed);
  const reduceMotion = useReducedMotion();
  const clockMs = useSharedValue(positionSec * 1000);

  useEffect(() => {
    cancelAnimation(clockMs);
    const start = positionSec * 1000;
    clockMs.value = start;
    if (isPlaying) {
      clockMs.value = withTiming(start + CLOCK_RUNWAY_MS * (speed || 1), {
        duration: CLOCK_RUNWAY_MS,
        easing: Easing.linear,
        // Highlight progress carries timing information and must not jump even
        // when decorative motion is disabled at the system level.
        reduceMotion: ReduceMotion.Never,
      });
    }
  }, [clockMs, isPlaying, positionSec, speed]);

  // The row lets go all at once: the latest word end in the line.
  const lineEndMs = words.reduce((latest, word, index) => {
    const end = word.end ?? word.start + lyricWordDurationMs(words, index);
    return Math.max(latest, end);
  }, 0);

  return inGroups(groups, (index) => (
    <TimedWord
      key={index}
      word={words[index]}
      durationMs={lyricWordDurationMs(words, index)}
      lineEndMs={lineEndMs}
      clockMs={clockMs}
      animateBounce={isPlaying && !reduceMotion}
      textStyle={textStyle}
      activeColor={activeColor}
      inactiveColor={inactiveColor}
    />
  ));
}

const TimedWord = memo(function TimedWord({
  word,
  durationMs,
  lineEndMs,
  clockMs,
  animateBounce,
  textStyle,
  activeColor,
  inactiveColor,
}: {
  word: LyricWord;
  durationMs: number;
  lineEndMs: number;
  clockMs: SharedValue<number>;
  animateBounce: boolean;
  textStyle: StyleProp<TextStyle>;
  activeColor: string;
  inactiveColor: string;
}) {
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const chars = splitChars(word.value);

  // The word-level bounce under the letter wave: a small bottom-anchored
  // swell riding the whole sung word - landing exactly as the word ends -
  // then held up like the letters until the row lets go at once. iOS only
  // lifts (magnifying rasterized masked text turns the glyphs soft);
  // shifting stays sharp.
  const motionStyle = useAnimatedStyle(() => {
    if (!animateBounce) return { transform: [{ scale: 1 }] };
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const raw = Math.max(0, Math.min(1, (clockMs.value - word.start) / duration));
    const lift = Math.sin(raw * Math.PI * 0.5);
    const release = clamp01((clockMs.value - (lineEndMs + CHAR_FALL_DELAY_MS)) / CHAR_FALL_MS);
    if (Platform.OS === 'ios') {
      return { transform: [{ translateY: -height.value * 0.04 * lift * (1 - release) }] };
    }
    const scale = 1 + WORD_BOUNCE_SCALE * lift;
    return {
      transform: [{ translateY: -height.value * (scale - 1) * 0.5 * (1 - release) }, { scale: 1 + (scale - 1) * (1 - release) }],
    };
  });

  const solidStyle = useAnimatedStyle(() => {
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const start = word.start - WORD_SWEEP_LEAD_MS;
    const end = word.start + duration;
    const raw = Math.max(0, Math.min(1, (clockMs.value - start) / (end - start)));
    const eased = 1 - (1 - raw) * (1 - raw);
    const edge = width.value * WORD_SWEEP_EDGE_FRACTION;
    return { width: Math.max(0, width.value * eased - edge * 0.5) };
  });

  const edgeStyle = useAnimatedStyle(() => {
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const start = word.start - WORD_SWEEP_LEAD_MS;
    const end = word.start + duration;
    const raw = Math.max(0, Math.min(1, (clockMs.value - start) / (end - start)));
    const eased = 1 - (1 - raw) * (1 - raw);
    const filled = width.value * eased;
    const edge = width.value * WORD_SWEEP_EDGE_FRACTION;
    const left = Math.max(0, filled - edge * 0.5);
    return {
      left,
      width: Math.min(edge, Math.max(0, filled * 2), Math.max(0, width.value - left)),
    };
  });

  // Held notes bloom: a halo around the word while it is sung, stronger the
  // longer the note, gone shortly after. Quick words barely light.
  const glowStyle = useAnimatedStyle(() => {
    if (!animateBounce) return { textShadowColor: 'transparent', textShadowRadius: 0 };
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const slow = Math.max(0, Math.min(1, (duration - QUICK_WORD_MS) / (HELD_WORD_MS - QUICK_WORD_MS)));
    if (slow <= 0) return { textShadowColor: 'transparent', textShadowRadius: 0 };
    const wordEnd = word.end ?? word.start + duration;
    const fill = Math.max(0, Math.min(1, (clockMs.value - word.start) / duration));
    const after = Math.max(0, Math.min(1, (clockMs.value - wordEnd) / BLOOM_FADE_MS));
    const bloom = fill * (1 - after) * slow;
    return {
      textShadowColor: `rgba(255, 255, 255, ${(bloom * BLOOM_ALPHA).toFixed(2)})`,
      textShadowRadius: bloom * BLOOM_RADIUS,
    };
  });

  // The wave on the visible copy and on the mask copy share nothing but
  // their inputs, so both ride the same letters in step.
  const base = chars ? (
    <View style={styles.charRow}>
      {chars.map((ch, i) => (
        <WordChar
          key={i}
          ch={ch}
          textStyle={textStyle}
          color={inactiveColor}
          glow={glowStyle}
          clockMs={clockMs}
          start={word.start}
          durationMs={durationMs}
          lineEndMs={lineEndMs}
          index={i}
          count={chars.length}
          animated={animateBounce}
        />
      ))}
    </View>
  ) : (
    <Animated.Text
      accessible={false}
      style={[textStyle, { color: inactiveColor, textShadowOffset: { width: 0, height: 0 } }, glowStyle]}
    >
      {word.value}
    </Animated.Text>
  );
  const mask = chars ? (
    <View style={styles.charRow}>
      {chars.map((ch, i) => (
        <WordChar
          key={i}
          ch={ch}
          textStyle={textStyle}
          color={activeColor}
          clockMs={clockMs}
          start={word.start}
          durationMs={durationMs}
          lineEndMs={lineEndMs}
          index={i}
          count={chars.length}
          animated={animateBounce}
        />
      ))}
    </View>
  ) : (
    <Text accessible={false} style={textStyle}>
      {word.value}
    </Text>
  );
  return (
    <Animated.View
      style={motionStyle}
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width;
        height.value = event.nativeEvent.layout.height;
      }}
    >
      {base}
      <MaskedView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        maskElement={mask}
      >
        <View style={styles.sweepCanvas}>
          <Animated.View style={[styles.sweepSolid, { backgroundColor: activeColor }, solidStyle]} />
          <Animated.View style={[styles.sweepEdge, edgeStyle]}>
            <LinearGradient
              colors={[activeColor, `${activeColor}00`]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      </MaskedView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  flow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  flowCentered: { justifyContent: 'center' },
  // Letters of one word never wrap apart: the word stays the unit the outer
  // row wraps, exactly like the single text it replaces.
  charRow: { flexDirection: 'row', flexWrap: 'nowrap' },
  sweepCanvas: { flex: 1 },
  sweepSolid: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  sweepEdge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
