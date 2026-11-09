/** The rules of the play queue (src/lib/queue.ts). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Song, SubsonicAuth } from '@/api/subsonic';
import {
  appendEnd,
  dealt,
  indexInOriginal,
  insertNext,
  moveIn,
  nextPlayable,
  queuedAfterMove,
  queueKeyFor,
  removeFrom,
  restoreRemoved,
  shuffleOn,
  unshuffled,
  type QueueState,
} from '@/lib/queue';

const song = (id: string, extra: Partial<Song> = {}): Song => ({ id, title: id, ...extra });
const list = (ids: string) => ids.split(' ').map((id) => song(id));
const ids = (q: Song[]) => q.map((s) => s.id).join(' ');
/** Five songs, the second playing, nothing queued by hand. */
const album = (): QueueState => ({ queue: list('a b c d e'), index: 1, queuedCount: 0 });

describe('Play next and Add to queue (#184)', () => {
  it('Play next goes right after the current song and grows the block', () => {
    const once = insertNext(album(), [song('x')]);
    assert.equal(ids(once.queue), 'a b x c d e');
    assert.equal(once.queuedCount, 1);
    const twice = insertNext(once, [song('y')]);
    assert.equal(ids(twice.queue), 'a b y x c d e');
    assert.equal(twice.queuedCount, 2);
    assert.equal(twice.index, 1);
  });

  it('Add to queue goes to the very end and leaves the block alone', () => {
    const st = insertNext(album(), [song('x')]);
    assert.equal(ids(appendEnd(st.queue, [song('z')])), 'a b x c d e z');
  });

  it('marks songs as added by hand and drops the mix mark', () => {
    const [added] = appendEnd([], [song('m', { fromMix: true })]);
    assert.equal(added.queued, true);
    assert.equal(added.fromMix, undefined);
  });

  it('inserts many at once in their order', () => {
    const st = insertNext(album(), list('x y z'));
    assert.equal(ids(st.queue), 'a b x y z c d e');
    assert.equal(st.queuedCount, 3);
  });
});

describe('removeFrom and restoreRemoved', () => {
  const queued = (): QueueState => ({ queue: list('a b x y c'), index: 1, queuedCount: 2 });

  it('ignores an index outside the queue', () => {
    assert.equal(removeFrom(album(), 9), null);
    assert.equal(removeFrom(album(), -1), null);
  });

  it('removing one already played moves the index back', () => {
    const r = removeFrom(album(), 0)!;
    assert.equal(ids(r.state.queue), 'b c d e');
    assert.equal(r.state.index, 0);
    assert.equal(r.wasCurrent, false);
  });

  it('removing one from the block shrinks it', () => {
    const r = removeFrom(queued(), 3)!;
    assert.equal(r.inQueuedBlock, true);
    assert.equal(r.state.queuedCount, 1);
  });

  it('removing one after the block leaves it alone', () => {
    const r = removeFrom(queued(), 4)!;
    assert.equal(r.inQueuedBlock, false);
    assert.equal(r.state.queuedCount, 2);
  });

  it('removing the current one plays the next and consumes the block by one', () => {
    const r = removeFrom(queued(), 1)!;
    assert.equal(r.wasCurrent, true);
    assert.equal(r.state.queue[r.state.index].id, 'x');
    assert.equal(r.state.queuedCount, 1);
  });

  it('removing the last song, playing, falls back to the one before', () => {
    const r = removeFrom({ queue: list('a b'), index: 1, queuedCount: 0 }, 1)!;
    assert.equal(r.state.index, 0);
  });

  it('removing the only song leaves an empty queue', () => {
    assert.equal(removeFrom({ queue: list('a'), index: 0, queuedCount: 0 }, 0)!.state.queue.length, 0);
  });

  it('undo puts the song back where it was, block included', () => {
    const before = queued();
    const r = removeFrom(before, 2)!;
    assert.deepEqual(restoreRemoved(r.state, 2, before.queue[2], r.inQueuedBlock), before);
  });

  it('undo of one already played keeps the index on the same song', () => {
    const before = album();
    const r = removeFrom(before, 0)!;
    const back = restoreRemoved(r.state, 0, before.queue[0], r.inQueuedBlock);
    assert.equal(back.queue[back.index].id, 'b');
  });
});

describe('moveIn', () => {
  it('refuses moves that are not one', () => {
    assert.equal(moveIn(album(), 2, 2), null);
    assert.equal(moveIn(album(), 0, 5), null);
    assert.equal(moveIn(album(), -1, 0), null);
  });

  it('the index follows the playing song', () => {
    for (const [from, to] of [[1, 4], [0, 3], [4, 0], [3, 4]]) {
      const st = moveIn(album(), from, to)!;
      assert.equal(st.queue[st.index].id, 'b', `${from} -> ${to}`);
    }
  });

  it('a song dragged into the block joins it, one dragged out leaves it', () => {
    const st: QueueState = { queue: list('a b x y c d'), index: 1, queuedCount: 2 };
    assert.equal(moveIn(st, 5, 2)!.queuedCount, 3);
    assert.equal(moveIn(st, 2, 5)!.queuedCount, 1);
    assert.equal(moveIn(st, 2, 3)!.queuedCount, 2);
  });

  it('touching the current song or what played dissolves the block', () => {
    const st: QueueState = { queue: list('a b x y c d'), index: 1, queuedCount: 2 };
    assert.equal(moveIn(st, 1, 4)!.queuedCount, 0);
    assert.equal(moveIn(st, 0, 3)!.queuedCount, 0);
  });
});

describe('queuedAfterMove', () => {
  it('advancing by one consumes one, jumping dissolves it', () => {
    const st = { index: 1, queuedCount: 2 };
    assert.equal(queuedAfterMove(st, 2), 1);
    assert.equal(queuedAfterMove(st, 4), 0);
    assert.equal(queuedAfterMove(st, 0), 0);
    assert.equal(queuedAfterMove(st, 1), 2);
  });
});

describe('nextPlayable', () => {
  const q = list('a b c');

  it('goes on to the next, and stops at the end', () => {
    assert.equal(nextPlayable(q, 0, 'off'), 1);
    assert.equal(nextPlayable(q, 2, 'off'), null);
    assert.equal(nextPlayable(q, 2, 'one'), null);
  });

  it('wraps round with repeat all', () => {
    assert.equal(nextPlayable(q, 2, 'all'), 0);
  });

  it('skips what cannot play, and repeats a lone playable song', () => {
    assert.equal(nextPlayable(q, 0, 'off', (i) => i === 2), 2);
    assert.equal(nextPlayable(q, 1, 'all', (i) => i === 1), 1);
    assert.equal(nextPlayable(q, 1, 'all', () => false), null);
  });
});

describe('shuffle', () => {
  const reversed = (l: Song[]) => [...l].reverse();
  const marked = () => [song('a'), song('b'), song('x', { queued: true }), song('m', { fromMix: true })];

  it('puts the playing song first and deals the rest', () => {
    const st = shuffleOn(list('a b c d'), 1, false, reversed);
    assert.equal(ids(st.queue), 'b d c a');
    assert.equal(st.index, 0);
  });

  it('with UPnP keeps what played in place and deals only what is coming', () => {
    const st = shuffleOn(list('a b c d'), 1, true, reversed);
    assert.equal(ids(st.queue), 'a b d c');
    assert.equal(st.index, 1);
  });

  it('takes both marks off', () => {
    const st = shuffleOn(marked(), 0, false, reversed);
    assert.ok(st.queue.every((s) => !s.queued && !s.fromMix));
  });

  it('turned off, finds the playing song in the original order', () => {
    const original = list('a b c d');
    assert.equal(indexInOriginal(original, song('c')), 2);
    assert.equal(indexInOriginal(original, song('zz')), 0);
  });

  it('shuffle off keeps what was added since and leaves out what was removed', () => {
    const original = list('a b c d');
    const x = song('x');
    // Shuffled, `b` removed, `x` added by hand and now playing.
    const st = unshuffled([song('c'), song('a'), x, song('d')], original, x);
    assert.equal(ids(st.queue), 'a c d x');
    assert.equal(st.index, 3);
    assert.equal(unshuffled(list('d c a'), original, song('c')).index, 1);
  });

  it('shuffle off with a second copy of a song added keeps both', () => {
    const st = unshuffled(list('b a b'), list('a b'), song('a'));
    assert.equal(ids(st.queue), 'a b b');
    assert.equal(st.index, 0);
  });

  it('deals every song exactly once, without touching the list', () => {
    const l = list('a b c d e f');
    const out = dealt(l);
    assert.equal(ids(l), 'a b c d e f');
    assert.equal(ids([...out].sort((x, y) => x.id.localeCompare(y.id))), 'a b c d e f');
  });
});

describe('queueKeyFor: the queue belongs to a profile, not to a mode', () => {
  const account = (url: string, username: string): SubsonicAuth => ({
    serverUrl: url,
    username,
    token: 't',
    salt: 's',
  });
  const one = account('https://one.example.com:8443', 'anna');
  const two = account('https://two.example.com:8443', 'bertha');

  it('an account that fell into offline mode is still the same account', () => {
    assert.equal(queueKeyFor(one, true), queueKeyFor(one, false));
  });

  it('two accounts offline get two queues, not one shared one', () => {
    assert.notEqual(queueKeyFor(one, true), queueKeyFor(two, true));
    assert.notEqual(queueKeyFor(one, true), queueKeyFor(null, true));
  });

  it('the local profile, which has no account, owns the offline key', () => {
    assert.equal(queueKeyFor(null, true), 'resonus.queue.offline');
  });

  it('no session has nothing to write to', () => {
    assert.equal(queueKeyFor(null, false), null);
  });

  it('the queue does not move when the active network does', () => {
    const onTheRoad = { ...one, serverUrl: 'http://192.168.1.10:8080', urls: ['https://one.example.com:8443'] };
    assert.equal(queueKeyFor(onTheRoad, false), queueKeyFor(one, false));
  });

  it('a profile keeps the name it was filed under, ahead of its addresses', () => {
    const moved = {
      ...one,
      serverUrl: 'http://192.168.1.10:8080',
      urls: ['http://192.168.1.10:8080'],
      scopeUrl: 'https://one.example.com:8443',
    };
    assert.equal(queueKeyFor(moved, false), queueKeyFor(one, false));
  });
});
