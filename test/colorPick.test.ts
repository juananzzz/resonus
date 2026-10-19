/** Picking the iOS accent (src/lib/colorPick.ts). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { darken, pickIosColor } from '@/lib/colorPick';

describe('pickIosColor', () => {
  it('takes a colored dominant area as is', () => {
    assert.equal(pickIosColor('#d02020', '#f0f0f0', undefined, undefined), '#d02020');
  });

  it('takes a vivid foreground past a white border', () => {
    assert.equal(pickIosColor('#f2f2f2', '#d02020', '#f0f0f0', undefined), '#d02020');
  });

  it('prefers order over a slightly more saturated foreground', () => {
    assert.equal(pickIosColor('#101010', '#c03030', '#e08010', undefined), '#c03030');
  });

  it('takes a vivid detail on a black void', () => {
    assert.equal(pickIosColor('#0a0a0a', '#e8e8e8', '#f0f0f0', '#e02020'), '#e02020');
  });

  it('keeps gray clouds gray instead of faint purple', () => {
    assert.equal(pickIosColor('#808080', '#7a6f9c', '#858585', undefined), '#808080');
  });

  it('keeps a black void black instead of faint brown', () => {
    assert.equal(pickIosColor('#0a0a0a', '#6f5347', undefined, undefined), '#0a0a0a');
  });
});

describe('darken', () => {
  it('mixes toward black keeping the hue', () => {
    assert.equal(darken('#c04040', 0.25), '#903030');
  });

  it('leaves zero amount alone', () => {
    assert.equal(darken('#c04040', 0), '#c04040');
  });

  it('returns unreadable input untouched', () => {
    assert.equal(darken('nope', 0.25), 'nope');
  });
});
