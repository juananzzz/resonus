/** Sorting a folder's songs by the file names on disk instead of their tags. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { byFileName, fileNameOf } from '@/lib/folderSort';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3AMusic';
const doc = (path: string) => `${TREE}/document/${encodeURIComponent(`primary:Music/${path}`)}`;

const song = (title: string, file: string, extra: { localUri?: string; path?: string } = {}) => ({
  title,
  localUri: doc(file),
  ...extra,
});

describe('fileNameOf', () => {
  it('reads the file name out of a local URI, accents and spaces decoded', () => {
    assert.equal(fileNameOf(song('Anything', 'Álbum/01 Canción.mp3')), '01 Canción.mp3');
  });

  it('reads it out of a server path, Windows separators included', () => {
    assert.equal(
      fileNameOf({ title: 'Anything', path: 'D:\\Music\\Artist\\02 - Track.flac' }),
      '02 - Track.flac',
    );
    assert.equal(fileNameOf({ title: 'Anything', path: 'Music/Artist/03 Track.mp3' }), '03 Track.mp3');
  });

  it('falls back to the title when no file is known', () => {
    assert.equal(fileNameOf({ title: 'A title' }), 'A title');
  });
});

describe('byFileName', () => {
  it('orders by the file, not by the tags it carries', () => {
    // Tag order would be A, B, C; the files are deliberately in another order.
    const songs = [
      song('Zebra', '01 First.mp3'),
      song('Apple', '02 Second.mp3'),
      song('Mango', '10 Tenth.mp3'),
    ];
    assert.deepEqual(
      songs.slice().sort(byFileName).map((s) => s.title),
      ['Zebra', 'Apple', 'Mango'],
    );
  });

  it('puts numbered files in numeric order', () => {
    const songs = [
      song('Ten', '10 ten.mp3'),
      song('Two', '2 two.mp3'),
      song('One', '1 one.mp3'),
    ];
    assert.deepEqual(
      songs.slice().sort(byFileName).map((s) => s.title),
      ['One', 'Two', 'Ten'],
    );
  });

  it('ignores case, and falls back to the title for a song with no file', () => {
    const songs = [song('B', 'b.mp3'), { title: 'A' }, song('C', 'c.mp3')];
    assert.deepEqual(
      songs.slice().sort(byFileName).map((s) => s.title),
      ['A', 'B', 'C'],
    );
  });
});
