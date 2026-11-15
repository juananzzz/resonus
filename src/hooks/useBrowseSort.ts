/**
 * The order a browse screen (all artists, albums, songs) opens on, remembered
 * across visits (#226). Only a field: these orders have no direction.
 *
 * A Home shelf that says which order it was showing wins for that visit, but
 * doesn't overwrite what was saved; picking one on the screen does. An order
 * the list no longer offers — another server's, or the filters over a section
 * answering a smaller set of orders — falls back to `fallback`.
 */
import { useState } from 'react';

import { useSortPrefs, type SortField } from '@/store/sortPrefs';

export function useBrowseSort<T extends string>(
  key: string,
  offered: readonly T[],
  fallback: T,
  fromRoute?: T,
): [T, (next: T) => void] {
  const stored = useSortPrefs((s) => s.prefs[key]?.field) as string | undefined;
  const setPref = useSortPrefs((s) => s.setPref);
  const [picked, setPicked] = useState<T | undefined>(fromRoute);
  const saved = offered.find((s) => s === stored);
  // What was picked during this visit belongs to the list as it was offered
  //  then. The filters over a section change the set a list answers to at all
  //  (a downloaded one has no server default, a favourited one no play counts),
  //  and an order that is no longer offered would stay selected under a row
  //  that cannot name it and a menu that has nothing left to choose. So it
  //  follows the list off, the way the saved order above already does.
  const chosen = picked !== undefined && offered.some((s) => s === picked) ? picked : undefined;
  const sort = chosen ?? saved ?? fallback;

  function set(next: T) {
    setPicked(next);
    // The store is typed for the list sorts; the browse orders share the map.
    setPref(
      key,
      { field: next as unknown as SortField, dir: 'asc' },
      { field: fallback as unknown as SortField, dir: 'asc' },
    );
  }

  return [sort, set];
}
