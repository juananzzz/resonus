/** How an album's plays are read off the plays of its songs. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { foldAlbumPlays } from '@/lib/albumPlays';

describe('foldAlbumPlays', () => {
  it('does not let a long record tried once outrank a short one played twice', () => {
    const long = Array.from({ length: 13 }, (_, i) => ({
      albumId: 'staind',
      playCount: 1,
      lastPlayed: `2026-11-01T10:00:${String(i).padStart(2, '0')}Z`,
    }));
    const short = Array.from({ length: 5 }, (_, i) => ({
      albumId: 'short',
      playCount: 2,
      lastPlayed: `2026-11-02T10:00:${String(i).padStart(2, '0')}Z`,
    }));

    const stats = foldAlbumPlays([...long, ...short]);
    const ranked = [...stats.keys()].sort(
      (a, b) => stats.get(b)!.count - stats.get(a)!.count,
    );

    assert.equal(stats.get('staind')!.count, 1);
    assert.equal(stats.get('short')!.count, 2);
    assert.deepEqual(ranked, ['short', 'staind']);
  });

  it('does not count the same track twice when the server repeats it across pages', () => {
    const song = { albumId: 'album', playCount: 3, lastPlayed: '2026-11-01T10:00:00Z' };
    const stats = foldAlbumPlays([song, song]);
    assert.equal(stats.get('album')!.count, 3);
    assert.equal(stats.get('album')!.played, '2026-11-01T10:00:00Z');
  });

  it('keeps the latest play no matter which page its song came from', () => {
    const stats = foldAlbumPlays([
      { albumId: 'album', playCount: 1, lastPlayed: '2026-11-03T10:00:00Z' },
      { albumId: 'album', playCount: 2, lastPlayed: '2026-11-01T10:00:00Z' },
      { albumId: 'album', playCount: 1, lastPlayed: '2026-11-02T10:00:00Z' },
    ]);
    assert.deepEqual(stats.get('album'), {
      count: 2,
      played: '2026-11-03T10:00:00Z',
    });
  });

  it('leaves out tracks that belong to no album', () => {
    const stats = foldAlbumPlays([
      { albumId: undefined, playCount: 9, lastPlayed: '2026-11-01T10:00:00Z' },
      { albumId: 'album', playCount: 1 },
    ]);
    assert.deepEqual([...stats.keys()], ['album']);
    assert.equal(stats.get('album')!.count, 1);
  });
});
