/**
 * Sharing lyrics (#315): the pure half. The full-screen lyrics page owns the
 * selection (which lines are picked, how they are highlighted); this turns a
 * selection into the text the system share sheet gets.
 *
 * Whole lyrics are shared when there is no selection, so the same formatter
 * serves both "share everything" and "share these lines".
 */
import type { LyricLine } from '@/api/subsonic';

/** What a lyric share needs from the song: its credits, nothing else. */
export interface LyricShareSong {
  title?: string;
  artist?: string;
}

/**
 * Adds or removes one line from a selection, returning a new set. Keeping it
 * immutable means React sees a new value on every tap, and a screen that
 * cancels can drop the selection without touching the one it started from.
 */
export function toggleLyricLine(selected: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(selected);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/**
 * The text for the share sheet: `Title — Artist`, a blank line, then the
 * lyrics. Lines keep the order they have in the song, even if they were picked
 * bottom-up; blank ones (a stanza gap, or an untimed placeholder) are left out,
 * as are indexes the lyrics no longer have.
 *
 * With no selection every line goes in. `''` means there is nothing worth
 * sharing, and the caller should not open the sheet at all.
 */
export function lyricShareText(
  song: LyricShareSong,
  lines: LyricLine[],
  selected?: ReadonlySet<number>,
): string {
  const values = lines
    .filter((_, index) => !selected || selected.has(index))
    .map((line) => line.value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) return '';

  const credit = [song.title?.trim(), song.artist?.trim()].filter(Boolean).join(' — ');
  return credit ? `${credit}\n\n${values.join('\n')}` : values.join('\n');
}
