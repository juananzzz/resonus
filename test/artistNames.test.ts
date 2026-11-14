/** Splitting an artist tag that credits more than one artist (#332). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { artistRefs, splitArtistNames } from '@/lib/artistNames';

describe('splitArtistNames', () => {
  it('treats a comma-separated artist tag as separate artists', () => {
    assert.deepEqual(splitArtistNames('Artist1, Artist2'), ['Artist1', 'Artist2']);
  });

  it('trims the names and drops empty entries', () => {
    assert.deepEqual(splitArtistNames(' Artist1 ,  , Artist2 , '), ['Artist1', 'Artist2']);
  });

  it('keeps a single artist name whole', () => {
    assert.deepEqual(splitArtistNames('Radiohead'), ['Radiohead']);
    assert.deepEqual(splitArtistNames(''), []);
    assert.deepEqual(splitArtistNames(undefined), []);
  });

  it('does not repeat a name credited twice', () => {
    assert.deepEqual(splitArtistNames('Artist1, artist1, Artist2'), ['Artist1', 'Artist2']);
  });
});

describe('artistRefs', () => {
  it('gives each split name its own navigable id', () => {
    const idOf = (name: string) => name.toLowerCase();
    assert.deepEqual(artistRefs('Artist1, Artist2', idOf), [
      { id: 'artist1', name: 'Artist1' },
      { id: 'artist2', name: 'Artist2' },
    ]);
  });
});
