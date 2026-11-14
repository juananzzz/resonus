/**
 * The recap's arithmetic: which listens belong to a month or a year, and what
 * they add up to. The screen only draws these numbers, so this is where the
 * answer is either right or wrong.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeRecap,
  recapRange,
  UNKNOWN_ARTIST,
  UNKNOWN_GENRE,
  type RecapListen,
} from '@/lib/recap';

function listen(over: Partial<RecapListen> & { songId: string }): RecapListen {
  return {
    title: over.songId,
    seconds: 180,
    playedAt: new Date(2026, 2, 10, 12).getTime(),
    ...over,
  };
}

describe('recapRange', () => {
  const now = new Date(2026, 2, 18, 15, 42, 7, 500); // 18 March 2026, local

  it('covers the calendar month containing the moment', () => {
    assert.deepEqual(recapRange('month', now), {
      start: new Date(2026, 2, 1).getTime(),
      end: new Date(2026, 3, 1).getTime(),
    });
  });

  it('covers the calendar year containing the moment', () => {
    assert.deepEqual(recapRange('year', now), {
      start: new Date(2026, 0, 1).getTime(),
      end: new Date(2027, 0, 1).getTime(),
    });
  });

  it("rolls December's month over into the next year", () => {
    assert.deepEqual(recapRange('month', new Date(2026, 11, 31, 23)), {
      start: new Date(2026, 11, 1).getTime(),
      end: new Date(2027, 0, 1).getTime(),
    });
  });
});

describe('computeRecap', () => {
  const range = recapRange('year', new Date(2026, 5, 1));

  it('drops plays outside the range and before the start on the first day', () => {
    const recap = computeRecap(
      [
        listen({ songId: 'before', playedAt: new Date(2025, 11, 31, 23, 59).getTime() }),
        listen({ songId: 'first', playedAt: new Date(2026, 0, 1, 0, 0).getTime(), seconds: 60 }),
        listen({ songId: 'last', playedAt: new Date(2026, 11, 31, 23, 59).getTime(), seconds: 90 }),
        listen({ songId: 'after', playedAt: new Date(2027, 0, 1, 0, 0).getTime() }),
      ],
      range,
    );
    assert.equal(recap.plays, 2);
    assert.equal(recap.seconds, 150);
  });

  it('adds up plays and seconds per artist, song and genre', () => {
    const recap = computeRecap(
      [
        listen({ songId: 'a1', title: 'One', artist: 'A', artistId: 'artist-a', genre: 'Rock', seconds: 200 }),
        listen({ songId: 'a2', title: 'Two', artist: 'A', artistId: 'artist-a', genre: 'Rock', seconds: 100 }),
        listen({ songId: 'b1', title: 'Three', artist: 'B', artistId: 'artist-b', genre: 'Jazz', seconds: 400 }),
        listen({ songId: 'a1', title: 'One', artist: 'A', artistId: 'artist-a', genre: 'Rock', seconds: 50 }),
      ],
      range,
    );
    assert.equal(recap.plays, 4);
    assert.equal(recap.seconds, 750);

    assert.deepEqual(recap.topArtists[0], { key: 'id:artist-a', name: 'A', plays: 3, seconds: 350 });
    assert.deepEqual(recap.topArtists[1], { key: 'id:artist-b', name: 'B', plays: 1, seconds: 400 });

    assert.deepEqual(recap.topSongs[0], {
      key: 'song:a1',
      name: 'One',
      subtitle: 'A',
      plays: 2,
      seconds: 250,
    });
    assert.equal(recap.topSongs[1].name, 'Three');

    assert.deepEqual(recap.topGenres[0], { key: 'genre:rock', name: 'Rock', plays: 3, seconds: 350 });
    assert.deepEqual(recap.topGenres[1], { key: 'genre:jazz', name: 'Jazz', plays: 1, seconds: 400 });
  });

  it('keeps untagged listens in their own named buckets', () => {
    const recap = computeRecap([listen({ songId: 'x', title: 'X', seconds: 30 })], range);
    assert.equal(recap.topArtists[0].name, UNKNOWN_ARTIST);
    assert.equal(recap.topGenres[0].name, UNKNOWN_GENRE);
    assert.equal(recap.topSongs[0].subtitle, UNKNOWN_ARTIST);
  });

  it('ranks by plays, then by time, then by name, and honours the limit', () => {
    const recap = computeRecap(
      [
        listen({ songId: 's1', title: 'Zed', artist: 'Same', artistId: 'same', seconds: 10 }),
        listen({ songId: 's2', title: 'Alpha', artist: 'Same', artistId: 'same', seconds: 90 }),
        listen({ songId: 's3', title: 'Other', artist: 'Other', artistId: 'other', seconds: 500 }),
      ],
      range,
      2,
    );
    assert.equal(recap.topArtists.length, 2);
    assert.deepEqual(
      recap.topSongs.map((s) => s.name),
      ['Other', 'Alpha'],
    );
  });

  it('ignores a broken duration instead of poisoning the total', () => {
    const recap = computeRecap(
      [listen({ songId: 'ok', seconds: 40 }), listen({ songId: 'bad', seconds: Number.NaN })],
      range,
    );
    assert.equal(recap.seconds, 40);
    assert.equal(recap.plays, 2);
  });

  it('is empty when nothing was played in the range', () => {
    assert.deepEqual(computeRecap([], range), {
      plays: 0,
      seconds: 0,
      topArtists: [],
      topSongs: [],
      topGenres: [],
    });
  });
});
