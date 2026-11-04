/**
 * Lyric lines cut into words, for the karaoke that lights them as they are
 * sung (#165). Every source hands over the same thing in its own shape: an
 * OpenSubsonic server a byte offset per word, Jellyfin a character index,
 * TTML and enhanced LRC a timestamp in the middle of the text. What they all
 * come down to is where in the line each word starts, and when.
 */
import type { LyricBacking, LyricLine, LyricWord, SongLyrics } from '@/api/subsonic';

/** Where a word starts in its line (a string index) and when it is sung. */
export interface WordMark {
  at: number;
  start: number;
  end?: number;
}

/**
 * Cuts `text` at the marks. What lies between two words goes with the first
 * (a space, usually), and anything before the first word goes with it too, so
 * the words put back together are the line exactly as it reads.
 *
 * Marks out of order or outside the line are times that cannot be trusted:
 * none come back, and the line lights up whole as it always has.
 */
export function wordsAt(text: string, marks: WordMark[]): LyricWord[] | undefined {
  if (marks.length === 0) return undefined;
  for (let i = 0; i < marks.length; i++) {
    const { at } = marks[i];
    if (at < 0 || at >= text.length || (i > 0 && at <= marks[i - 1].at)) return undefined;
  }
  return marks.map((m, i) => ({
    start: m.start,
    ...(m.end !== undefined ? { end: m.end } : {}),
    value: text.slice(i === 0 ? 0 : m.at, i + 1 < marks.length ? marks[i + 1].at : undefined),
  }));
}

/**
 * The same for marks taken before the line was trimmed, which is how the
 * timestamps inside a text come out: read with the marks in it, trimmed after.
 * A mark with nothing after it is not a word but where the last one ends, and
 * two in the same place are one word, the later.
 */
export function trimmedWords(
  raw: string,
  marks: WordMark[],
): { value: string; words?: LyricWord[] } {
  const value = raw.trim();
  const lead = raw.length - raw.trimStart().length;
  const kept: WordMark[] = [];
  let end: number | undefined;
  for (const m of marks) {
    const at = Math.max(0, m.at - lead);
    if (at >= value.length) end = m.start;
    else if (kept.length > 0 && kept[kept.length - 1].at === at) kept[kept.length - 1] = { ...m, at };
    else kept.push({ ...m, at });
  }
  const words = wordsAt(value, kept);
  if (!words) return { value };
  const last = words[words.length - 1];
  if (end !== undefined && last.end === undefined) words[words.length - 1] = { ...last, end };
  return { value, words };
}

/**
 * When each word of a line is sung out, which is what the karaoke fills on.
 *
 * The source's own end when it sent one (TTML and Jellyfin do); the next
 * word's start when it did not, since words follow one another; for the last
 * word, the next line's start - how long the phrase is held - capped, because
 * that gap is often silence rather than a note, and a word that takes four
 * seconds to fill reads as one that never does. Nothing after the word at all:
 * a guess, which is all it can be.
 *
 * `handover` is when the line stops being the one on screen, in the same
 * clock these times are read in. Nothing fills past it: a word still filling
 * when its row stops being the active one would jump to full colour (and its
 * shine disappear) in front of whoever is watching. Nor past the next word,
 * whatever the source said - fills follow one another, they do not overlap.
 */
export function wordEnds(words: LyricWord[], handover?: number): number[] {
  const gone = handover ?? Infinity;
  return words.map((w, i) => {
    const next = words[i + 1]?.start;
    const until =
      next !== undefined
        ? Math.min(w.end ?? next, next)
        : (w.end ?? Math.min(gone, w.start + HELD_LIMIT_MS));
    return Math.max(Math.min(until, gone), w.start);
  });
}

/** The most the last word fills for when nothing says when it ends. */
const HELD_LIMIT_MS = 2500;

/**
 * The string index a UTF-8 byte offset lands on, which is what an
 * OpenSubsonic cue gives, or -1 when it falls inside a character.
 */
export function indexOfByte(text: string, byte: number): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    if (bytes === byte) return i;
    if (bytes > byte) return -1;
    const code = text.codePointAt(i)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (code > 0xffff) i++;
  }
  return -1;
}

/**
 * An OpenSubsonic cue line cut into its words (`songLyrics` version 2).
 *
 * By `byteStart`, which is what the spec fixes. A server that got the bytes
 * wrong still sent each word's text, so failing that they are looked for in
 * the line in order.
 */
export function wordsFromCues(
  text: string,
  cues: { start: number; end?: number; value?: string; byteStart?: number }[],
  offset = 0,
): LyricWord[] | undefined {
  const time = (c: { start: number; end?: number }) => ({
    start: Math.max(0, c.start - offset),
    ...(c.end !== undefined ? { end: Math.max(0, c.end - offset) } : {}),
  });
  const byBytes = wordsAt(
    text,
    cues.map((c) => ({
      at: c.byteStart === undefined ? -1 : indexOfByte(text, c.byteStart),
      ...time(c),
    })),
  );
  if (byBytes) return byBytes;
  let from = 0;
  return wordsAt(
    text,
    cues.map((c) => {
      const at = c.value ? text.indexOf(c.value, from) : -1;
      if (at >= 0) from = at + c.value!.length;
      return { at, ...time(c) };
    }),
  );
}

/** One voice of a server `structuredLyrics` entry (OpenSubsonic `songLyrics`). */
export interface ServerCue {
  start: number;
  end?: number;
  value?: string;
  byteStart?: number;
}

/** A timed line of a server `structuredLyrics` entry. */
export interface ServerCueLine {
  /** The `line` it times; backing voices share their lead line's index. */
  index?: number;
  value?: string;
  cue?: ServerCue[];
}

/** A server `structuredLyrics` entry, as `getLyricsBySongId` answers it. */
export interface ServerStructuredLyrics {
  kind?: string;
  synced?: boolean;
  /** Global offset in ms; positive = lyrics should appear earlier. */
  offset?: number;
  line?: { start?: number; value?: string }[];
  cueLine?: ServerCueLine[];
}

/**
 * A backing vocal from a server cue line that shares its lead line's index.
 *
 * The spec puts the main voice first and the backing ones after it. Without
 * word timings the segment still shows, timed at line level from its cues.
 */
function backingFromCue(cl: ServerCueLine, offset: number): LyricBacking | null {
  const value = cl.value;
  if (!value || !cl.cue?.length) return null;
  const words = wordsFromCues(value, cl.cue, offset);
  if (words?.length) {
    const last = words[words.length - 1];
    return {
      start: words[0].start,
      ...(last.end !== undefined ? { end: last.end } : {}),
      value,
      words,
    };
  }
  let start = Infinity;
  let end = -Infinity;
  for (const c of cl.cue) {
    if (Number.isFinite(c.start)) start = Math.min(start, c.start);
    if (c.end !== undefined && Number.isFinite(c.end)) end = Math.max(end, c.end);
  }
  if (!Number.isFinite(start)) return null;
  return {
    start: Math.max(0, start - offset),
    ...(end > start ? { end: Math.max(0, end - offset) } : {}),
    value,
  };
}

/**
 * A server `structuredLyrics` entry cut into singable lines, backing vocals
 * included. Pure (no network) so the mapping is testable: `getLyricsBySongId`
 * only picks the entry and hands it over.
 */
export function structuredSongLyrics(pick: ServerStructuredLyrics): SongLyrics | null {
  if (!pick.line?.length) return null;
  const synced = !!pick.synced;
  const offset = pick.offset ?? 0;
  // Every cue line of each index, in order: the first is the lead voice, the
  // rest are the backing ones sharing its line.
  const cues = new Map<number, ServerCueLine[]>();
  if (synced) {
    pick.cueLine?.forEach((cl, i) => {
      const at = cl.index ?? i;
      const list = cues.get(at);
      if (list) list.push(cl);
      else cues.set(at, [cl]);
    });
  }
  const lines = pick.line.map((ln, i): LyricLine => {
    const all = cues.get(i) ?? [];
    const text = all[0]?.value;
    const cue = all[0]?.cue;
    const words = text && cue?.length ? wordsFromCues(text, cue, offset) : undefined;
    const backing: LyricBacking[] = [];
    for (const extra of all.slice(1)) {
      const seg = backingFromCue(extra, offset);
      if (seg) backing.push(seg);
    }
    return {
      // The cue line's own text when it has words, since they are cut out of
      // it, and `line` may carry the backing vocals alongside.
      value: words && text ? text : (ln.value ?? ''),
      ...(synced && ln.start !== undefined
        ? { start: Math.max(0, ln.start - offset) }
        : {}),
      ...(words ? { words } : {}),
      ...(backing.length > 0 ? { backing } : {}),
    };
  });
  return { synced, lines: synced ? inTimeOrder(lines) : lines };
}

/**
 * Synced lines in the order they are sung. The server hands them over in the
 * order it stored them, which for some files is not that: a chorus written
 * once with several timestamps, or sections moved around. The player looks
 * for the line being sung by walking forward until a line starts later, so
 * one late line near the top kept the first line lit for the whole song, while
 * tapping a line still jumped to the right place. Stable, and a line with no
 * time stays after the one before it.
 */
function inTimeOrder(lines: LyricLine[]): LyricLine[] {
  let last = 0;
  const keyed = lines.map((line, i) => {
    if (line.start !== undefined) last = line.start;
    return { line, at: line.start ?? last, i };
  });
  keyed.sort((a, b) => a.at - b.at || a.i - b.i);
  return keyed.map((k) => k.line);
}

/** Scripts written without spaces, where a line may break between any two timed words. */
const UNSPACED_RE = /[\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF00-\uFFEF]/;

/**
 * Word indices grouped into what a line may not break inside: syllables of
 * one word come as separate timed words with no space between them (#312).
 */
export function wordGroups(words: LyricWord[]): number[][] {
  const groups: number[][] = [];
  words.forEach((word, i) => {
    const prev = words[i - 1]?.value;
    const joined =
      prev != null &&
      !/\s$/.test(prev) &&
      !/^\s/.test(word.value) &&
      !UNSPACED_RE.test(prev.slice(-1)) &&
      !UNSPACED_RE.test(word.value.charAt(0));
    if (joined) groups[groups.length - 1].push(i);
    else groups.push([i]);
  });
  return groups;
}
