/**
 * The previous control: the app's button restarts the song before leaving it,
 * a headset/watch/car "previous track" button always steps (#307).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { previousAction } from '@/lib/previousAction';

describe('previousAction', () => {
  it('restarts from the app button past a few seconds, as it always has', () => {
    assert.equal(previousAction(12, 'restart'), 'restart');
    assert.equal(previousAction(12, 'always'), 'previous');
    assert.equal(previousAction(2, 'restart'), 'previous');
  });

  it('always steps back from a remote control, whatever the mode or position', () => {
    assert.equal(previousAction(12, 'restart', true), 'previous');
    assert.equal(previousAction(2, 'restart', true), 'previous');
    assert.equal(previousAction(12, 'always', true), 'previous');
  });

  it('restarts at exactly the threshold and steps before it', () => {
    assert.equal(previousAction(3, 'restart'), 'previous');
    assert.equal(previousAction(3.01, 'restart'), 'restart');
  });
});
