/** The quality a sharing link asks the server for (#276). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shareEncoding } from '@/lib/shareQuality';

describe('shareEncoding', () => {
  it('asks for the original file when the quality is Original', () => {
    assert.deepEqual(shareEncoding(0, 'mp3'), { format: '', maxBitRate: 0 });
    assert.deepEqual(shareEncoding(-1, 'opus'), { format: '', maxBitRate: 0 });
    assert.deepEqual(shareEncoding(Number.NaN, 'aac'), { format: '', maxBitRate: 0 });
  });

  it('keeps the chosen cap and codec for a transcoded link', () => {
    assert.deepEqual(shareEncoding(192, 'opus'), { format: 'opus', maxBitRate: 192 });
    assert.deepEqual(shareEncoding(320, 'mp3'), { format: 'mp3', maxBitRate: 320 });
  });

  it('leaves the codec to the server when none was chosen', () => {
    assert.deepEqual(shareEncoding(128, ''), { format: '', maxBitRate: 128 });
  });

  it('rounds a fractional cap to whole kbps', () => {
    assert.deepEqual(shareEncoding(191.6, 'aac'), { format: 'aac', maxBitRate: 192 });
  });
});
