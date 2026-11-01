/**
 * How a library list is ordered and filtered.
 *
 * Lifted out of "Your library" when the Explore tab grew a playlists section:
 * both lists are the same rows sorted the same three ways, and the second one
 * was not worth a second copy of this. Pure functions only, so neither screen
 * has to import the other.
 */
// `import type`, not an inline `type` specifier: the statement is then erased
// outright, so importing these pure functions does not drag the settings store
// (and through it the locales, and expo-secure-store) in behind them. It is
// what lets `test/librarySort.test.ts` run on Node with nothing stubbed.
import type { LibrarySort } from '@/store/settings';

export const SORT_LABELS: Record<LibrarySort, string> = {
  recent: 'Recents',
  added: 'Recently added',
  alpha: 'Alphabetical',
};

/** Locale-aware name compare: right for accents/ñ (albums, artists). */
const byLocale = (a: string, b: string) => a.localeCompare(b);

/**
 * Case-insensitive code-point compare. Leading symbols sort before letters by
 * code point ("+" < "[" < a…), so playlists prefixed with "+" to pin them to
 * the top land there — matching Navidrome, Feishin and other clients.
 * localeCompare instead orders "[" before "+", burying the "+" playlists.
 */
export function byCodepoint(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * For a list that mixes playlists with everything else: names led by a symbol
 * first and by code point (see byCodepoint), the rest locale-aware.
 */
export function byLibraryName(a: string, b: string): number {
  const named = /^[\p{L}\p{N}]/u;
  const x = named.test(a);
  const y = named.test(b);
  if (x !== y) return x ? 1 : -1;
  return x ? byLocale(a, b) : byCodepoint(a, b);
}

/**
 * Sorts by the chosen criterion: alphabetical by name, or by descending score
 * (last play timestamp / added timestamp) with alphabetical tie-break — the
 * never-played ones end up last, in A-Z. `compare` picks the name ordering
 * (locale-aware by default; code point for playlists, see byCodepoint).
 */
export function sortItems<T>(
  items: T[],
  sort: LibrarySort,
  name: (x: T) => string,
  score: (x: T) => number,
  compare: (a: string, b: string) => number = byLocale,
): T[] {
  // Keys computed once per item, not inside the comparator. A sort asks for
  // them about `2·n·log n` times, and `score` here parses a date or walks the
  // play history, so a couple of thousand favourites meant tens of thousands
  // of date parses on every render of the tab (#50).
  const keyed = items.map((item) => ({
    item,
    name: name(item),
    score: sort === 'alpha' ? 0 : score(item),
  }));
  const byName = (a: (typeof keyed)[number], b: (typeof keyed)[number]) =>
    compare(a.name, b.name);
  keyed.sort(sort === 'alpha' ? byName : (a, b) => b.score - a.score || byName(a, b));
  return keyed.map((k) => k.item);
}

/**
 * Normalizes for filtering: lowercase and without accents, so "Nino" finds
 * "Niño" and "cafe" finds "Café".
 */
export function normQ(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * How many edits a query word forgives: two letters or less none (they match
 * half the library), then one slip up to five letters, two up to nine and
 * three past that. Two slips in a five-letter word is a different word
 * ("drake" and "brave", "queen" and "green"), not a typo.
 */
function allowedEdits(len: number): number {
  if (len <= 2) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

/**
 * Edit distance with adjacent transpositions, giving up past `max`: what a
 * typo is — a missing, extra or wrong letter, or two neighbours swapped.
 * Words here are a handful of characters, so the plain matrix with an early
 * exit is plenty fast enough.
 */
function wordDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let prevPrev: number[] = [];
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[m];
}

/** One query word against the words of a field: contained, or an edit away. */
function matchWord(qw: string, words: string[]): boolean {
  for (const fw of words) {
    // Partial typing ("madon" for Madonna) never needs the distance.
    if (fw.includes(qw)) return true;
  }
  const max = allowedEdits(qw.length);
  if (max === 0) return false;
  for (const fw of words) {
    if (wordDistance(qw, fw, max) <= max) return true;
    // A typo'd start of a longer word ("beatls" for "beatles"): compare
    // against its head too, not only the whole of it.
    if (fw.length > qw.length && wordDistance(qw, fw.slice(0, qw.length + max), max) <= max) {
      return true;
    }
  }
  return false;
}

/**
 * Does any of the fields match the query? The whole query as it was typed
 * first; failing that, every query word has to land somewhere (in any order,
 * so "rojo nino" finds "Niño Rojo"), each as a substring or a typo away.
 * One- and two-letter words ("of", "di", "y") are left out of that second
 * pass: requiring them would make every query carrying a stopword fail.
 * Fields are normalized here; the query is too, so callers can hand over what
 * the box holds.
 */
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = normQ(query.trim());
  if (!q) return true;
  const hay = fields.filter((f): f is string => !!f).map(normQ);
  if (hay.some((f) => f.includes(q))) return true;
  const words = q.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return false;
  const split = hay.map((f) => f.split(/\s+/));
  return words.every((qw) => split.some((ws) => matchWord(qw, ws)));
}

/** An artist's place in A-Z order: its sort name where the server sent one. */
export function byArtistSortName(
  a: { name?: string; sortName?: string },
  b: { name?: string; sortName?: string },
): number {
  const ka = a.sortName || a.name || '';
  const kb = b.sortName || b.name || '';
  return ka.localeCompare(kb, undefined, { sensitivity: 'base' }) || (a.name ?? '').localeCompare(b.name ?? '');
}
