/** Grid card measurement, which has to follow a turned screen (#131). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gridCardWidth } from '@/lib/gridLayout';

const GAP = 8;
const PAD = 24;

describe('gridCardWidth', () => {
  it('splits the width available after padding and gaps between the cards', () => {
    assert.equal(gridCardWidth(390, 2, GAP, PAD), (390 - PAD * 2 - GAP) / 2);
    assert.equal(gridCardWidth(1280, 5, GAP, PAD), (1280 - PAD * 2 - GAP * 4) / 5);
  });

  it('grows the cards when the same grid is given a landscape width', () => {
    const portrait = gridCardWidth(411, 2, GAP, PAD);
    const landscape = gridCardWidth(891, 2, GAP, PAD);
    assert.ok(landscape > portrait);
    // A full row still fits exactly inside the landscape screen.
    assert.equal(landscape * 2 + GAP + PAD * 2, 891);
  });

  it('never leaves a negative width when there are too many columns', () => {
    assert.equal(gridCardWidth(90, 8, GAP, PAD), 0);
  });
});
