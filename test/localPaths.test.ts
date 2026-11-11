/** Paths out of local URIs: folder browsing and playlist files. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { baseOf, buildM3u, commonRoot, filePathOf, folderTree, m3uMatcher, parseM3u, pathOfTree, pathOfUri } from '@/lib/localPaths';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3AMusic';
const doc = (path: string) => `${TREE}/document/${encodeURIComponent(`primary:Music/${path}`)}`;

const songs = [
  { id: 'a', uri: doc('Rojuu/CiTY ROc/01 uno.mp3'), albumId: 'f1' },
  { id: 'b', uri: doc('Rojuu/CiTY ROc/02 dos.mp3'), albumId: 'f1' },
  { id: 'c', uri: doc('document/02 dos.mp3'), albumId: 'f2' },
  { id: 'd', uri: doc('suelta.mp3') },
];

describe('paths', () => {
  it('reads the path out of a SAF document and out of a file', () => {
    assert.equal(pathOfUri(songs[0].uri), 'primary:Music/Rojuu/CiTY ROc/01 uno.mp3');
    assert.equal(pathOfUri(songs[2].uri), 'primary:Music/document/02 dos.mp3');
    assert.equal(pathOfUri('file:///storage/emulated/0/Music/a%20b.mp3'), '/storage/emulated/0/Music/a b.mp3');
    assert.equal(pathOfTree(TREE), 'primary:Music');
    assert.equal(baseOf('primary:Music'), 'Music');
    assert.equal(filePathOf(songs[3].uri), '/storage/emulated/0/Music/suelta.mp3');
  });

  it('builds the folders from the songs', () => {
    const tree = folderTree(songs);
    const root = tree.get('primary:Music');
    assert.deepEqual([...root!.dirs].sort(), ['primary:Music/Rojuu', 'primary:Music/document']);
    assert.deepEqual(root!.songs, ['d']);
    assert.deepEqual(tree.get('primary:Music/Rojuu/CiTY ROc')!.songs, ['a', 'b']);
    assert.equal(tree.get('primary:Music/Rojuu/CiTY ROc')!.albumId, 'f1');
    assert.equal(commonRoot(tree), 'primary:Music');
  });
});

describe('m3u', () => {
  it('drops comments and blank lines', () => {
    assert.deepEqual(parseM3u('\uFEFF#EXTM3U\r\n#EXTINF:1,x\r\na/b.mp3\r\n\r\n'), ['a/b.mp3']);
  });

  it('matches relative, absolute and foreign paths', () => {
    const match = m3uMatcher(songs);
    assert.equal(match('Rojuu/CiTY ROc/01 uno.mp3', 'primary:Music'), 'a');
    assert.equal(match('../Rojuu/CiTY ROc/02 dos.mp3', 'primary:Music/Listas'), 'b');
    assert.equal(match('/storage/emulated/0/Music/document/02 dos.mp3', 'primary:Music'), 'c');
    assert.equal(match('D:\\Musica\\Rojuu\\CiTY ROc\\02 DOS.mp3', 'primary:Music'), 'b');
    assert.equal(match('nada.mp3', 'primary:Music'), undefined);
  });

  it('writes one that reads back', () => {
    const text = buildM3u([{ title: 'uno', artist: 'Rojuu', duration: 61.4, localUri: songs[0].uri }]);
    assert.equal(text, '#EXTM3U\n#EXTINF:61,Rojuu - uno\n/storage/emulated/0/Music/Rojuu/CiTY ROc/01 uno.mp3\n');
    assert.equal(m3uMatcher(songs)(parseM3u(text)[0], 'x'), 'a');
  });
});
