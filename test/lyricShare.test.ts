/**
 * Sharing lyrics (#315): which lines a selection covers, and the text the
 * system share sheet gets. The screen only decides when to call these; what a
 * shared lyric reads like is the part that is silently wrong when it is wrong.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LyricLine } from '@/api/subsonic';
import { lyricShareText, toggleLyricLine } from '@/lib/lyricShare';

const lines: LyricLine[] = [
  { start: 0, value: 'Is this the real life?' },
  { start: 4000, value: 'Is this just fantasy?' },
  { start: 8000, value: '' },
  { start: 12000, value: 'Caught in a landslide' },
  { start: 16000, value: 'No escape from reality' },
];

const song = { title: 'Bohemian Rhapsody', artist: 'Queen' };

describe('toggleLyricLine', () => {
  it('adds and removes without mutating the old selection', () => {
    const empty = new Set<number>();
    const one = toggleLyricLine(empty, 2);
    assert.deepEqual([...one], [2]);
    assert.deepEqual([...empty], []);

    const none = toggleLyricLine(one, 2);
    assert.deepEqual([...none], []);
    assert.deepEqual([...one], [2]);
  });
});

describe('lyricShareText', () => {
  it('shares only the selected lines, in lyric order', () => {
    const selected = new Set([4, 0, 1]);
    assert.equal(
      lyricShareText(song, lines, selected),
      'Bohemian Rhapsody — Queen\n\nIs this the real life?\nIs this just fantasy?\nNo escape from reality',
    );
  });

  it('ignores blank lines and indexes the lyrics do not have', () => {
    const selected = new Set([2, 3, 99]);
    assert.equal(
      lyricShareText(song, lines, selected),
      'Bohemian Rhapsody — Queen\n\nCaught in a landslide',
    );
  });

  it('shares the whole song when there is no selection', () => {
    assert.equal(
      lyricShareText(song, lines),
      'Bohemian Rhapsody — Queen\n\nIs this the real life?\nIs this just fantasy?\nCaught in a landslide\nNo escape from reality',
    );
  });

  it('falls back to whichever credit it has, and to none', () => {
    assert.equal(lyricShareText({ title: 'Untitled' }, lines.slice(0, 1)), 'Untitled\n\nIs this the real life?');
    assert.equal(lyricShareText({ artist: 'Queen' }, lines.slice(0, 1)), 'Queen\n\nIs this the real life?');
    assert.equal(lyricShareText({}, lines.slice(0, 1)), 'Is this the real life?');
  });

  it('is empty when there is nothing to share', () => {
    assert.equal(lyricShareText(song, []), '');
    assert.equal(lyricShareText(song, lines, new Set([2])), '');
    assert.equal(lyricShareText(song, [{ start: 0, value: '   ' }]), '');
  });
});
