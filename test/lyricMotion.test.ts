import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  lyricBlurRadius,
  lyricBounceProgress,
  lyricSweepProgress,
  lyricWordDurationMs,
} from '@/lib/lyricMotion';

describe('word lyric motion', () => {
  it('keeps explicit word durations and gives very short words time to travel', () => {
    assert.equal(
      lyricWordDurationMs([{ start: 1_000, end: 1_700, value: 'held' }], 0),
      700,
    );
    assert.equal(
      lyricWordDurationMs([{ start: 1_000, end: 1_030, value: 'a' }], 0),
      180,
    );
  });

  it('caps an inferred duration across a silent gap', () => {
    const words = [
      { start: 1_000, value: 'Hi ' },
      { start: 5_000, value: 'again' },
    ];
    assert.equal(lyricWordDurationMs(words, 0), 490);
    assert.equal(lyricWordDurationMs([{ start: 5_000, value: 'again' }], 0), 700);
  });

  it('starts the sweep early with ease-out but starts the bounce on the beat', () => {
    assert.equal(lyricSweepProgress(899, 1_000, 400), 0);
    assert.ok(lyricSweepProgress(1_000, 1_000, 400) > 0);
    assert.equal(lyricSweepProgress(1_400, 1_000, 400), 1);

    assert.equal(lyricBounceProgress(999, 1_000, 400), 0);
    assert.equal(lyricBounceProgress(1_200, 1_000, 400), 0.5);
    assert.equal(lyricBounceProgress(1_400, 1_000, 400), 1);
  });
});

describe('lyric depth effect', () => {
  it('keeps the current row and disabled states sharp', () => {
    assert.equal(lyricBlurRadius(3, 3, true), 0);
    assert.equal(lyricBlurRadius(4, 3, false), 0);
    assert.equal(lyricBlurRadius(4, -1, true), 0);
  });

  it('adds gentle depth to upcoming rows and caps the radius', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((distance) =>
        Number(lyricBlurRadius(10 + distance, 10, true).toFixed(2)),
      ),
      [0.55, 1.1, 1.65, 2.2, 2.2],
    );
  });

  it('places passed rows only slightly behind upcoming rows', () => {
    assert.equal(lyricBlurRadius(7, 8, true), 0.6875);
    assert.equal(lyricBlurRadius(9, 8, true), 0.55);
  });
});
