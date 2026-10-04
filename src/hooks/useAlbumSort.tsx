/**
 * Reusable sort for a list of albums the screen already holds, with its bottom
 * sheet menu. The album twin of `useSongSort`, and the same menu: by year or
 * by name, either way round (#147).
 *
 * Year is the one that needs a direction. A discography arrives newest first,
 * which is a fine way to look at an artist you are catching up with and the
 * wrong one for listening through a catalogue from the beginning, and there is
 * no telling from here which of the two anybody is doing.
 *
 * The choice is saved under `persistKey`, so it holds across visits: a list
 * that goes back to newest first every time you leave it is not an answer to
 * the question, it is the same question once per visit.
 */
import { type ReactNode, useMemo, useRef } from 'react';

import { type Album } from '@/api/subsonic';
import { SortSheet } from '@/components/SortSheet';
import { useSortPrefs, type AlbumSortField, type SortPref } from '@/store/sortPrefs';

const SORT_LABEL: Record<AlbumSortField, string> = {
  year: 'Year',
  alpha: 'Alphabetical',
};

const FIELDS: AlbumSortField[] = ['year', 'alpha'];

/** Newest first: the order these lists have always arrived in. */
export const DEFAULT_ALBUM_SORT: SortPref = { field: 'year', dir: 'desc' };

interface AlbumSortResult<T extends Album> {
  /** The albums in the visible order. */
  albums: T[];
  /** Opens the sort menu, for the header button. */
  openSort: () => void;
  /** The menu, to render in the tree. */
  sortSheet: ReactNode;
}

export function useAlbumSort<T extends Album>(source: T[], persistKey: string): AlbumSortResult<T> {
  const stored = useSortPrefs((s) => s.prefs[persistKey]);
  const setPref = useSortPrefs((s) => s.setPref);
  const openRef = useRef<() => void>(() => {});
  const { field, dir } = stored ?? DEFAULT_ALBUM_SORT;

  // Memoized, as in `useSongSort`: a stable array is also what keeps the
  // FlatList from re-evaluating every row on each render.
  const albums = useMemo(() => {
    const cmp = (a?: string, b?: string) => (a ?? '').localeCompare(b ?? '');
    // The direction goes inside the comparator instead of reversing the result:
    // reversing flips the tie-break too, and same-year albums running Z-A under
    // "descending by year" is not what that says.
    const sign = dir === 'asc' ? 1 : -1;
    const arr = [...source];
    if (field === 'alpha') arr.sort((a, b) => sign * cmp(a.name, b.name));
    // An album with no year at all counts as year zero, which is where it was
    // already going: the split that feeds these lists says the same.
    else
      arr.sort((a, b) => {
        const byYear = sign * ((a.year ?? 0) - (b.year ?? 0));
        return byYear !== 0 ? byYear : cmp(a.name, b.name);
      });
    return arr;
  }, [source, field, dir]);

  return {
    albums,
    openSort: () => openRef.current(),
    sortSheet: (
      <SortSheet
        options={FIELDS.map((f) => ({ key: f, label: SORT_LABEL[f] }))}
        field={field}
        dir={dir}
        onPick={(next, d) =>
          setPref(persistKey, { field: next as AlbumSortField, dir: d }, DEFAULT_ALBUM_SORT)
        }
        openRef={openRef}
      />
    ),
  };
}
