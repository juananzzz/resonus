/** The Settings search (src/lib/settingsSearch.ts) and the index it reads. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

import type { SettingEntry } from '@/lib/settingsIndex.generated';
import { searchSettings } from '@/lib/settingsSearch';

const index: SettingEntry[] = [
  { label: 'Player', screen: 'player', root: 'player', path: [] },
  { label: 'Lyrics size', screen: 'lyrics', root: 'player', path: ['Player', 'Lyrics'] },
  { label: 'Show rating', screen: 'player', root: 'player', path: ['Player'] },
  { label: 'Download quality', screen: 'downloads', root: 'downloads', path: ['Downloads & offline'] },
];
const es: Record<string, string> = { 'Lyrics size': 'Tamaño de la letra', Lyrics: 'Letra', Player: 'Reproductor' };
const t = (k: string) => es[k] ?? k;
const all = new Set(['player', 'downloads']);
const labels = (q: string, roots = all) => searchSettings(q, t, roots, index).map((h) => h.label);

describe('settings search', () => {
  it('matches the translated name, without accents or case', () => {
    assert.deepEqual(labels('tamano'), ['Tamaño de la letra']);
  });

  it('puts names before the settings that are merely on a matching screen', () => {
    assert.deepEqual(labels('repro'), ['Reproductor', 'Tamaño de la letra', 'Show rating']);
  });

  it('leaves out the categories this profile does not have', () => {
    assert.deepEqual(labels('quality', new Set(['player'])), []);
  });

  it('finds nothing for an empty query', () => {
    assert.deepEqual(labels('  '), []);
  });

  it('reads an index that matches the screens', () => {
    execFileSync('node', ['scripts/settings-index.mjs', '--check'], { stdio: 'pipe' });
  });
});
