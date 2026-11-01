/** How the library lists are ordered and filtered. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { byArtistSortName, byCodepoint, byLibraryName, matches, normQ, sortItems } from '@/lib/librarySort';

interface Row {
  name: string;
  at: number;
}

const rows: Row[] = [
  { name: 'Zebra', at: 10 },
  { name: 'apple', at: 30 },
  { name: 'Mango', at: 0 },
  { name: 'Éclair', at: 30 },
  { name: 'banana', at: 0 },
];

const names = (list: Row[]) => list.map((r) => r.name);

describe('sortItems', () => {
  it('orders alphabetically with the locale, accents and case included', () => {
    const out = sortItems(rows, 'alpha', (r) => r.name, (r) => r.at);
    assert.deepEqual(names(out), ['apple', 'banana', 'Éclair', 'Mango', 'Zebra']);
  });

  it('orders by score descending, ties and the never-played alphabetically', () => {
    const out = sortItems(rows, 'recent', (r) => r.name, (r) => r.at);
    assert.deepEqual(names(out), ['apple', 'Éclair', 'Zebra', 'banana', 'Mango']);
  });

  it('does not ask for a score when sorting alphabetically', () => {
    let asked = 0;
    sortItems(rows, 'alpha', (r) => r.name, () => ++asked);
    assert.equal(asked, 0);
  });

  it('computes each score once, not once per comparison', () => {
    let asked = 0;
    sortItems(rows, 'added', (r) => r.name, (r) => (asked++, r.at));
    assert.equal(asked, rows.length);
  });

  it('takes another name ordering', () => {
    const out = sortItems([{ name: '[b]', at: 0 }, { name: '+a', at: 0 }, { name: 'c', at: 0 }], 'alpha', (r) => r.name, (r) => r.at, byCodepoint);
    assert.deepEqual(names(out), ['+a', '[b]', 'c']);
  });

  it('leaves the input untouched', () => {
    const copy = rows.slice();
    sortItems(rows, 'alpha', (r) => r.name, (r) => r.at);
    assert.deepEqual(rows, copy);
  });
});

describe('byCodepoint', () => {
  it('puts a leading "+" before a leading "[" and before letters', () => {
    assert.ok(byCodepoint('+Pinned', '[Later]') < 0);
    assert.ok(byCodepoint('[Later]', 'Alpha') < 0);
  });

  it('ignores case', () => {
    assert.equal(byCodepoint('ABC', 'abc'), 0);
    assert.ok(byCodepoint('abc', 'ABD') < 0);
  });
});

describe('byLibraryName', () => {
  it('keeps "+" playlists on top and accents among the letters', () => {
    const out = ['Zoo', 'Álbum', '[x]', '+pin', 'Beta'].sort(byLibraryName);
    assert.deepEqual(out, ['+pin', '[x]', 'Álbum', 'Beta', 'Zoo']);
  });
});

describe('normQ', () => {
  it('lowercases and drops accents', () => {
    assert.equal(normQ('Café Niño'), 'cafe nino');
  });
});

describe('matches', () => {
  it('matches everything on an empty query', () => {
    assert.equal(matches('', 'anything'), true);
    assert.equal(matches('', undefined), true);
  });

  it('looks for the query in any of the fields, accents set aside', () => {
    assert.equal(matches('nino', 'Café', 'Niño Rojo'), true);
    assert.equal(matches('rojo', undefined, 'Niño Rojo'), true);
  });

  it('is false when no field holds it', () => {
    assert.equal(matches('xyz', 'Café', undefined), false);
  });

  it('matches words in any order', () => {
    assert.equal(matches('rojo nino', 'Niño Rojo'), true);
    assert.equal(matches('nino rojo', 'Niño Rojo'), true);
  });

  it('matches a missing letter', () => {
    assert.equal(matches('madona', 'Madonna'), true);
    assert.equal(matches('madnna', 'Madonna'), true);
  });

  it('matches a swapped pair', () => {
    assert.equal(matches('teh', 'The Who'), true);
    assert.equal(matches('madnoa', 'Madonna'), true);
  });

  it('matches a partial word', () => {
    assert.equal(matches('madon', 'Madonna'), true);
  });

  it('does not match short words an edit away', () => {
    assert.equal(matches('u3', 'U2'), false);
    assert.equal(matches('ab', 'ac dc'), false);
  });

  it('is false when a query word lands nowhere', () => {
    assert.equal(matches('madonna xyz', 'Madonna'), false);
  });

  it('skips stopwords instead of failing on them', () => {
    assert.equal(matches('metal of', 'Heavy Metal'), true);
  });

  it('forgives three edits in a long word', () => {
    assert.equal(matches('abXdeYghiZ', 'Abcdefghij'), true);
  });

  it('takes one slip in a short word, not two', () => {
    assert.equal(matches('qeen', 'Queen'), true);
    assert.equal(matches('drake', 'Brave'), false);
    assert.equal(matches('queen', 'Green'), false);
  });
});

describe('byArtistSortName', () => {
  it('files an artist under its sort name, the name where there is none (#275)', () => {
    const artists = [
      { name: 'The Knife', sortName: 'knife' },
      { name: 'Air' },
      { name: 'The Beatles', sortName: 'Beatles, The' },
      { name: 'Muse', sortName: 'muse' },
    ];
    assert.deepEqual(
      artists.slice().sort(byArtistSortName).map((a) => a.name),
      ['Air', 'The Beatles', 'The Knife', 'Muse'],
    );
  });
});
