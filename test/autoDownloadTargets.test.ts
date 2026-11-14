/** Keys for everything the Library can keep downloaded automatically. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  autoDownloadKey,
  isAutoDownloaded,
  parseAutoDownloadKey,
} from '@/lib/autoDownloadTargets';

describe('autoDownloadKey', () => {
  it('keeps plain playlist ids as they are, so saved choices survive', () => {
    assert.equal(autoDownloadKey({ kind: 'playlist', id: 'pl-42' }), 'pl-42');
  });

  it('namespaces albums and artists so they cannot be taken for playlists', () => {
    assert.equal(autoDownloadKey({ kind: 'album', id: 'al-1' }), 'album:al-1');
    assert.equal(autoDownloadKey({ kind: 'artist', id: 'ar-1' }), 'artist:ar-1');
  });

  it('round-trips every kind', () => {
    for (const target of [
      { kind: 'playlist', id: 'pl-42' },
      { kind: 'album', id: 'al-1' },
      { kind: 'artist', id: 'ar-1' },
    ] as const) {
      assert.deepEqual(parseAutoDownloadKey(autoDownloadKey(target)), target);
    }
  });
});

describe('isAutoDownloaded', () => {
  const ids = { 'pl-42': true, 'album:al-1': true } as const;

  it('finds the flagged target and no other', () => {
    assert.equal(isAutoDownloaded(ids, { kind: 'playlist', id: 'pl-42' }), true);
    assert.equal(isAutoDownloaded(ids, { kind: 'album', id: 'al-1' }), true);
    assert.equal(isAutoDownloaded(ids, { kind: 'album', id: 'al-2' }), false);
    assert.equal(isAutoDownloaded(ids, { kind: 'artist', id: 'ar-1' }), false);
  });

  it('does not mistake an album key for a playlist with that id', () => {
    assert.equal(isAutoDownloaded(ids, { kind: 'playlist', id: 'album:al-1' }), false);
  });
});
