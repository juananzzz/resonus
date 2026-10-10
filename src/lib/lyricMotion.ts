/**
 * Timing rules for the word-level lyric sweep.
 *
 * The visual treatment is adapted from Primuse's MIT-licensed karaoke lyric
 * renderer (Copyright (c) 2026 Welape), expressed here in milliseconds for
 * Resonus' lyric model. Keeping the rules outside React also makes the edge
 * cases testable without a native runtime.
 */
import type { LyricWord } from '@/api/subsonic';

/** The sweep starts just before the timestamp so it meets the singer's attack. */
export const WORD_SWEEP_LEAD_MS = 100;

/** Very short source timings would otherwise flash instead of travelling. */
export const MIN_WORD_TRANSITION_MS = 180;

/** The portion of a word occupied by the soft leading edge of the sweep. */
export const WORD_SWEEP_EDGE_FRACTION = 0.12;

/** Peak scale of the syllable bounce: 1 -> 1.05 -> 1. */
export const WORD_BOUNCE_SCALE = 0.05;

/**
 * Primuse's depth model, calibrated for Android's stronger Gaussian filter.
 * Keeping the first step subtle prevents a newly completed line from looking
 * as though it snaps out of focus, while the cap still separates distant rows.
 */
const LYRIC_BLUR_STEP = 0.55;
const MAX_LYRIC_BLUR = 2.2;
const PAST_LINE_DEPTH_OFFSET = 0.25;

/**
 * Progressive blur for synchronized lyric rows. Passed rows sit just behind
 * equally distant upcoming rows, while the active row stays sharp.
 */
export function lyricBlurRadius(
  rowIndex: number,
  activeRowIndex: number,
  enabled: boolean,
): number {
  if (!enabled || rowIndex < 0 || activeRowIndex < 0 || rowIndex === activeRowIndex) return 0;
  const distance = Math.abs(rowIndex - activeRowIndex);
  const depth = distance + (rowIndex < activeRowIndex ? PAST_LINE_DEPTH_OFFSET : 0);
  return Math.min(MAX_LYRIC_BLUR, depth * LYRIC_BLUR_STEP);
}

/**
 * Start-only formats use the next word as this word's end. A long silence
 * before that next marker must not turn into a multi-second slow fill.
 */
function inferredDurationLimit(value: string): number {
  const significant = Array.from(value).filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
  return Math.min(900, 420 + Math.max(0, significant - 1) * 70);
}

/** Returns the visual duration of one word in milliseconds. */
export function lyricWordDurationMs(words: LyricWord[], index: number): number {
  const word = words[index];
  if (!word) return MIN_WORD_TRANSITION_MS;

  const nextStart = words[index + 1]?.start;
  const end = word.end ?? nextStart;
  const recorded = end === undefined ? 0 : Math.max(0, end - word.start);
  const duration = Math.max(recorded, MIN_WORD_TRANSITION_MS);

  // An explicit end is authored timing and remains authoritative. A duration
  // inferred from the next start is capped so silence does not keep sweeping.
  if (word.end !== undefined) return duration;
  const inferredLimit = inferredDurationLimit(word.value);
  return nextStart === undefined ? inferredLimit : Math.min(duration, inferredLimit);
}

/** Primuse's ease-out sweep, useful for deterministic tests and previews. */
export function lyricSweepProgress(
  positionMs: number,
  startMs: number,
  durationMs: number,
): number {
  const transitionStart = startMs - WORD_SWEEP_LEAD_MS;
  const transitionEnd = startMs + Math.max(MIN_WORD_TRANSITION_MS, durationMs);
  if (positionMs <= transitionStart) return 0;
  if (positionMs >= transitionEnd) return 1;
  const raw = (positionMs - transitionStart) / (transitionEnd - transitionStart);
  return 1 - (1 - raw) * (1 - raw);
}

/** The bounce starts on the timestamp (without the sweep's look-ahead). */
export function lyricBounceProgress(
  positionMs: number,
  startMs: number,
  durationMs: number,
): number {
  const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
  if (positionMs <= startMs) return 0;
  if (positionMs >= startMs + duration) return 1;
  return (positionMs - startMs) / duration;
}
