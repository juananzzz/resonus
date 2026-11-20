/** The rules over the saved queues (src/lib/savedQueues.ts). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Song } from '@/api/subsonic';
import {
  adopt,
  closedLive,
  entry as makeEntry,
  evict,
  fromBeginning,
  insert,
  isSavedQueueEntry,
  order,
  payloadOf,
  sameQueue,
  shelf,
  shelfStamp,
  signature,
  MAX_AUTO,
  MAX_MANUAL,
  SHELF,
  type QueueListening,
  type SavedQueueEntry,
  type StoredQueue,
} from '@/lib/savedQueues';

const song = (id: string, extra: Partial<Song> = {}): Song => ({ id, title: id, ...extra });
const list = (ids: string) => ids.split(' ').map((id) => song(id));
const ids = (q: StoredQueue | SavedQueueEntry) => q.queue.map((s) => s.id).join(' ');
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** What one queue holds, spelled out once and kept short in the tests below. */
function queueOf(ids: string, index = 0, positionSec = 0): StoredQueue {
  return {
    queue: ids.split(' ').map((id) => song(id)),
    index,
    positionSec,
    radioMode: false,
    radioSeed: null,
    source: null,
    sourceHref: null,
    shuffle: false,
    dealt: false,
    repeat: 'off',
    speed: 1,
    varispeed: false,
    savedAt: 1000,
  };
}

/** A queue on the shelf: what it holds plus what says where it sits. */
const entry = (id: string, ids: string, index = 0, extra: Partial<SavedQueueEntry> = {}) =>
  ({ ...queueOf(ids, index), id, updatedAt: 1000, ...extra }) as SavedQueueEntry;

const rows = (...what: string[]) => what.map((idsOf, i) => entry(`e${i}`, idsOf, i));

describe('payloadOf', () => {
  const listening: QueueListening = {
    queue: list('a b c d e'),
    index: 2,
    positionSec: 41.5,
    radioMode: true,
    radioSeed: song('b'),
    source: 'An album',
    sourceHref: '/album/1',
    shuffle: true,
    repeat: 'all',
    speed: 1.5,
    varispeed: true,
    queueDealt: false,
  };

  it('keeps what is behind the cursor, the cursor and how far the song got', () => {
    const saved = payloadOf(listening, 5000);
    assert.equal(ids(saved), 'a b c d e');
    assert.equal(saved.index, 2);
    assert.equal(saved.positionSec, 41.5);
    assert.equal(saved.savedAt, 5000);
    assert.equal(saved.radioMode, true);
    assert.equal(saved.repeat, 'all');
    assert.equal(saved.speed, 1.5);
  });

  it('holds at most 500 songs and moves the cursor back inside them', () => {
    const saved = payloadOf(
      {
        ...listening,
        queue: range(640).map((i) => song(`s${i}`)),
        index: 639,
      },
      1,
    );
    assert.equal(saved.queue.length, 500);
    assert.equal(saved.index, 499);
  });
});

describe('makeEntry marks what was saved by hand', () => {
  it('and says when it was put on the shelf', () => {
    const saved = makeEntry('x', { ...queueOf('a b', 1, 12), savedAt: 7000 }, true);
    assert.equal(saved.id, 'x');
    assert.equal(saved.updatedAt, 7000);
    assert.equal(saved.manual, true);
    assert.equal(saved.live, undefined);
  });
});

describe('insert keeps one entry per id and the newest first', () => {
  it('puts the new one ahead of the ones that were kept', () => {
    const next = insert(rows('a b', 'c d'), entry('new', 'e f'));
    assert.deepEqual(next.map((e) => e.id), ['new', 'e0', 'e1']);
  });

  it('replaces an older copy of the same queue instead of adding one', () => {
    const again = insert(rows('a b', 'c d'), entry('e0', 'a b x', 2));
    assert.deepEqual(again.map((e) => e.id), ['e0', 'e1']);
    assert.equal(ids(again[0]), 'a b x');
  });
});

describe('the cap keeps the automatic ten and the hand-saved ten', () => {
  const many = (n: number, manual = false) =>
    range(n).map((i) => entry(`q${i}`, 'a b', 0, manual ? { manual: true } : {}));

  it('drops the automatic ones that got the least attention, newest first', () => {
    const kept = evict(many(MAX_AUTO + 4));
    assert.equal(kept.length, MAX_AUTO);
    assert.deepEqual(kept.map((e) => e.id), range(MAX_AUTO).map((i) => `q${i}`));
  });

  it('keeps hand-saved ones past the ten automatic queues that came after', () => {
    const kept = evict([...many(MAX_AUTO + 4), ...many(2, true)]);
    assert.equal(kept.length, MAX_AUTO + 2);
    assert.deepEqual(kept.filter((e) => e.manual).map((e) => e.id), ['q0', 'q1']);
  });

  it('still drops the hand-saved ones that stopped being ten', () => {
    const kept = evict(many(MAX_MANUAL + 3, true));
    assert.equal(kept.length, MAX_MANUAL);
  });
});

describe('sameQueue asks about the listening, not the timestamp', () => {
  it('calls the two copies of one queue the same queue, position aside', () => {
    assert.equal(
      sameQueue(entry('x', 'a b c', 1, { positionSec: 12 }), entry('y', 'a b c', 1, { positionSec: 40 })),
      true,
    );
  });

  it('does when the cursor moved or a song did', () => {
    assert.equal(sameQueue(entry('x', 'a b c', 1), entry('y', 'a b c', 2)), false);
    assert.equal(sameQueue(entry('x', 'a b c', 1), entry('y', 'a b x', 1)), false);
  });
});

describe('adopt brings a queue back without starting a copy of it', () => {
  it('keeps the id of the entry that is already on the list', () => {
    const was = entry('keep', 'a b c', 1, { live: true, positionSec: 30 });
    const out = adopt([was], 'keep', { ...queueOf('a b c', 1, 12), savedAt: 2000 }, 'fresh');
    assert.deepEqual(out.entries.map((e) => e.id), ['keep']);
    assert.equal(out.liveId, 'keep');
    assert.equal(out.entries[0].live, true);
    // The copy that is further on is the fresher one: a boot read that lags
    // must not put the song back.
    assert.equal(out.entries[0].positionSec, 30);
    assert.equal(out.entries[0].updatedAt, 2000);
  });

  it('adds one when nothing on the list is that queue', () => {
    const out = adopt([entry('other', 'x y')], null, { ...queueOf('a b c', 1), savedAt: 3000 }, 'fresh');
    assert.deepEqual(out.entries.map((e) => e.id), ['fresh', 'other']);
    assert.equal(out.liveId, 'fresh');
    assert.equal(out.entries[0].live, true);
  });

  // An archive read that came late adopts what the session already had up, and
  //  those entries are mostly queues that ended: they keep their place without
  //  becoming the live one.
  it('keeps the place of one that comes back ended', () => {
    const out = adopt([entry('a', 'a b c', 1), entry('b', 'd e')], 'b', { ...queueOf('a b c', 1, 12), savedAt: 2000 }, 'a', false);
    assert.deepEqual(out.entries.map((e) => e.id), ['a', 'b']);
    assert.equal(out.liveId, 'b');
    assert.equal(out.entries[0].live, undefined);
    assert.equal(out.entries[0].positionSec, 12);
  });

  it('a queue the list never had comes in without taking the live mark', () => {
    const out = adopt([entry('other', 'x y')], 'other', { ...queueOf('a b c', 1), savedAt: 2000 }, 'fresh', false);
    assert.deepEqual(out.entries.map((e) => e.id), ['fresh', 'other']);
    assert.equal(out.liveId, 'other');
    assert.equal(out.entries[0].live, undefined);
  });

  it('the live entry it matches loses the mark when the copy says ended', () => {
    const out = adopt([entry('a', 'a b c', 1, { live: true })], 'a', { ...queueOf('a b c', 1), savedAt: 2000 }, 'a', false);
    assert.equal(out.liveId, null);
    assert.equal(out.entries[0].live, undefined);
  });
});

describe('closedLive takes the live mark away', () => {
  it('leaves the other entries alone', () => {
    const next = closedLive([entry('b', 'c d', 0, { live: true }), entry('a', 'e f')]);
    assert.equal(next[0].live, undefined);
    assert.equal(next[1].live, undefined);
  });
});

describe('fromBeginning puts the queue at the top', () => {
  it('keeps the entry and its songs, moves the cursor and the position away', () => {
    const heard = entry('x', 'a b c', 2, { positionSec: 55 });
    const restarted = fromBeginning(heard);
    assert.equal(restarted.index, 0);
    assert.equal(restarted.positionSec, 0);
    assert.equal(ids(restarted), ids(heard));
    assert.equal(restarted.id, heard.id);
  });
});

describe('what comes back from disk is checked', () => {
  it('accepts an entry and refuses a shape it does not know', () => {
    assert.equal(isSavedQueueEntry(entry('x', 'a b')), true);
    assert.equal(isSavedQueueEntry({ id: 'x', updatedAt: 1 }), false);
    assert.equal(isSavedQueueEntry({ id: 'x', updatedAt: 1, queue: [{ title: 'no id' }] }), false);
    assert.equal(isSavedQueueEntry('a b c'), false);
  });
});

describe('order and signature answer the update’s two questions', () => {
  it('the order says which song sits where, the signature the rest of it', () => {
    assert.equal(order(entry('x', 'a b c', 1)), '1/a,b,c');
    const moved = { ...entry('x', 'a b c', 1), source: 'Another' };
    assert.notEqual(signature(entry('x', 'a b c', 1)), signature(moved));
  });

  it('ignores the position, since a tick is not a change worth writing for', () => {
    assert.equal(
      signature(entry('x', 'a b c', 1, { positionSec: 3 })),
      signature(entry('x', 'a b c', 1, { positionSec: 91 })),
    );
  });
});

describe('shelf draws the newest of what is kept, and never forgets a hand-saved one', () => {
  it('never more than ten, and the queue that was updated is a newer one', () => {
    const kept = rows('a b', 'c d', 'e f');
    assert.equal(shelf(kept).length, 3);
    assert.equal(shelf(kept, 2).length, 2);
    assert.equal(shelf(kept)[0].id, 'e0');
  });

  it('holds ten when more were kept', () => {
    const kept = range(SHELF + 4).map((i) => entry(`q${i}`, 'a b'));
    assert.equal(shelf(kept).length, SHELF);
    assert.equal(shelf(kept, 20).length, SHELF + 4);
  });

  // `Save queue` says of a queue that it is worth keeping, and Home's row is
  //  the only way back to one: an entry that stayed on file but left the row
  //  could never be resumed again.
  it('a queue kept by hand is on the row though the ten after it came later', () => {
    const kept = [
      ...range(SHELF).map((i) => entry(`q${i}`, 'a b')),
      entry('kept', 'c d', 0, { manual: true }),
    ];
    assert.equal(shelf(kept).length, SHELF);
    assert.equal(shelf(kept).some((e) => e.id === 'kept'), true);
    // Of the automatic ones it is the oldest that takes its place.
    assert.equal(shelf(kept).some((e) => e.id === `q${SHELF - 1}`), false);
    // Newest first all the same: the row reads as the listening came last.
    assert.equal(shelf(kept)[0].id, 'q0');
  });

  it('more kept by hand than the row holds keeps the newest of them', () => {
    const kept = range(SHELF + 3).map((i) => entry(`q${i}`, 'a b', 0, { manual: true }));
    assert.deepEqual(shelf(kept).map((e) => e.id), range(SHELF).map((i) => `q${i}`));
  });
});

describe('the stamp says when the shelf would look the same', () => {
  it('a queue that only got further into its song does not ask for a redraw', () => {
    const one = entry('q1', 'a b c', 0, { source: 'Blue trains' });
    const again = entry('q1', 'a b c', 0, { source: 'Blue trains' });
    assert.equal(shelfStamp([one]), shelfStamp([again]));
  });

  it('the cursor, the song the card wears and the count all move it', () => {
    const atTop = entry('q1', 'a b c');
    const further = entry('q1', 'a b c', 1);
    const longer = entry('q1', 'a b c d');
    assert.notEqual(shelfStamp([atTop]), shelfStamp([further]));
    assert.notEqual(shelfStamp([atTop]), shelfStamp([longer]));
  });
});
