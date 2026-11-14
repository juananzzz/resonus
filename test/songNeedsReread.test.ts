import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songNeedsReread } from '../src/lib/songReread';

// #338: a forced rescan reads again only the files whose date moved since the
// last read. A file whose date cannot be read keeps its stored tags.
test('a file whose date has not moved is reused', () => {
  assert.equal(songNeedsReread({ addedAt: 1000 }, 1000), false);
});

test('a retagged file (date moved) is read again', () => {
  assert.equal(songNeedsReread({ addedAt: 1000 }, 2000), true);
});

test('a file with no stored date is read again, once', () => {
  assert.equal(songNeedsReread({}, 2000), true);
});

test('a date that cannot be read keeps the stored tags', () => {
  assert.equal(songNeedsReread({ addedAt: 1000 }, 0), false);
  assert.equal(songNeedsReread({}, 0), false);
});
