import assert from 'node:assert/strict';
import test from 'node:test';

import type { Song } from '@/api/backend';
import {
  captureSnapshot,
  PLAYER_SNAPSHOT_FIELDS,
  restoreSnapshot,
  type PlayerSnapshot,
} from '@/lib/playerSnapshot';

const song = (id: string) => ({ id, title: id } as unknown as Song);

/** A radio that was interrupted by whatever pushed the back history. */
const playing: PlayerSnapshot = {
  queue: [song('a'), song('b')],
  index: 1,
  queuedCount: 2,
  positionSec: 42,
  durationSec: 180,
  originalQueue: [song('a'), song('b')],
  queueDealt: true,
  source: 'album',
  sourceHref: '/album/1',
  radioMode: true,
  radioSeed: song('seed'),
  shuffle: true,
};

test('restore writes back every field the capture took', () => {
  const captured = captureSnapshot(playing);
  assert.deepEqual(Object.keys(captured).sort(), [...PLAYER_SNAPSHOT_FIELDS].sort());

  const restored = restoreSnapshot(captured);
  for (const key of PLAYER_SNAPSHOT_FIELDS) {
    assert.deepEqual(restored[key], captured[key], `restore dropped ${key}`);
  }
});

test('an interrupted radio comes back as a radio', () => {
  const restored = restoreSnapshot(captureSnapshot(playing));
  assert.equal(restored.radioMode, true);
  assert.deepEqual(restored.radioSeed, song('seed'));
});

test('the previous button restarts the track, radio flags included', () => {
  const restored = restoreSnapshot(captureSnapshot(playing), { restart: true });
  assert.equal(restored.queuedCount, 0);
  assert.equal(restored.positionSec, 0);
  assert.equal(restored.durationSec, 0);
  assert.equal(restored.radioMode, true);
  assert.deepEqual(restored.radioSeed, song('seed'));
});
