/**
 * Reusable sort for a song list (the order it came in / Alphabetical…, plus
 * direction) with its bottom sheet menu. Used by playlist and favorites.
 *
 * Returns the already-sorted list, the mapping to original indices (for actions
 * like "remove from list"), a trigger to open the menu, and the menu itself as
 * a node to render. With `persistKey` the chosen sort is saved to disk and
 * remembered across visits.
 */
import { type ReactNode, useMemo, useRef, useState } from 'react';

import { type Song } from '@/api/subsonic';
import { SortSheet } from '@/components/SortSheet';
import { useDownloads } from '@/store/downloads';
import { DEFAULT_SORT, useSortPrefs, type SongSortField, type SortPref } from '@/store/sortPrefs';

/**
 * `recent` is the order the list arrived in, which is what "Default" says
 * everywhere else in the app. It is not "Recent": that word is taken, and it
 * means what you played or opened last. Screens where the order it arrived in
 * has a name of its own give it one (see `labels`).
 */
const SORT_LABEL: Record<SongSortField, string> = {
  recent: 'Default',
  added: 'Recently added',
  alpha: 'Alphabetical',
  artist: 'Artist',
  album: 'Album',
  downloaded: 'Downloaded',
};

/** Default offered fields (favorites): 'recent' = server order. */
const DEFAULT_FIELDS: SongSortField[] = ['recent', 'alpha', 'artist', 'album', 'downloaded'];

interface SortOptions {
  /** Which fields to offer and in which order (the first is equivalent to "unsorted"). */
  fields?: SongSortField[];
  /** Custom labels per field (e.g. 'recent' → "Custom" in playlists). */
  labels?: Partial<Record<SongSortField, string>>;
  /** Default sort if the user hasn't chosen one. */
  defaultSort?: SortPref;
  /** Every field already says which way it runs, so the sheet asks no direction. */
  noDirection?: boolean;
}

interface SortResult {
  /** Songs in the visible order. */
  songs: Song[];
  /** Original index (on the server) of each visible song. */
  indices: number[];
  /** Opens the sort menu. */
  openSort: () => void;
  /** The sort menu, to render in the tree. */
  sortSheet: ReactNode;
  /** Current sort preference (field + direction). */
  sort: SortPref;
  /** Changes the sort preference (e.g. force manual order). */
  setSort: (pref: SortPref) => void;
}

/** Stable stand-in for the downloads map when the sort doesn't look at it: a
 *  fresh `{}` each time would defeat the whole point. */
const NO_FILES: Record<string, string> = {};

export function useSongSort(
  source: Song[],
  persistKey?: string,
  options?: SortOptions,
): SortResult {
  const fields = options?.fields ?? DEFAULT_FIELDS;
  const fallback = options?.defaultSort ?? DEFAULT_SORT;
  const stored = useSortPrefs((s) => (persistKey ? s.prefs[persistKey] : undefined));
  const setPref = useSortPrefs((s) => s.setPref);
  const [local, setLocal] = useState<SortPref>(fallback);
  const openRef = useRef<() => void>(() => {});

  const pref = persistKey ? (stored ?? fallback) : local;
  const field = pref.field;
  const dir = options?.noDirection ? 'asc' : pref.dir;
  // For the 'downloaded' sort (group downloaded songs together), and ONLY for
  // it. The map is replaced with every song that finishes downloading, and it
  // feeds the memo below, so subscribing to it always meant re-mapping and
  // re-sorting the whole list on each one, on every screen that sorts, plus new
  // array identities for the FlatList to chew on. On a long list with
  // auto-download on that is thousands of full sorts (#50). Sorting BY
  // downloads does have to follow them, and there the re-sort is the point.
  const files = useDownloads((s) => (field === 'downloaded' ? s.files : NO_FILES));
  function update(next: SortPref) {
    if (persistKey) setPref(persistKey, next, fallback);
    else setLocal(next);
  }

  // 'recent' leaves the raw server order (= manual playlist order).
  // Memoized: sorting on every render is noticeable in large lists.
  const ordered = useMemo(() => {
    const cmp = (a?: string, b?: string) => (a ?? '').localeCompare(b ?? '');
    const arr = source.map((song, idx) => ({ song, idx }));
    // 'added' = order in which they are added to the playlist. The server adds
    // them at the end, so their position already encodes it: reverse = latest on top.
    if (field === 'added') arr.reverse();
    if (field === 'alpha') arr.sort((a, b) => cmp(a.song.title, b.song.title));
    if (field === 'artist')
      arr.sort((a, b) => cmp(a.song.artist, b.song.artist) || cmp(a.song.title, b.song.title));
    if (field === 'album')
      // albumId separates same-name albums from different artists; disc before
      // track because in multi-disc albums `track` values repeat per disc,
      // and without that key the songs interleave "randomly".
      arr.sort(
        (a, b) =>
          cmp(a.song.album, b.song.album) ||
          cmp(a.song.albumId, b.song.albumId) ||
          (a.song.discNumber ?? 0) - (b.song.discNumber ?? 0) ||
          (a.song.track ?? 0) - (b.song.track ?? 0) ||
          cmp(a.song.title, b.song.title),
      );
    // 'downloaded' groups downloaded songs at the top preserving the original
    // order within each group (stable sort in Hermes). With dir 'desc' they go to the bottom.
    if (field === 'downloaded')
      arr.sort((a, b) => (files[a.song.id] ? 0 : 1) - (files[b.song.id] ? 0 : 1));
    if (dir === 'desc') arr.reverse();
    return arr;
  }, [source, field, dir, files]);

  const sortSheet = (
    <SortSheet
      options={fields.map((f) => ({ key: f, label: options?.labels?.[f] ?? SORT_LABEL[f] }))}
      field={field}
      dir={options?.noDirection ? undefined : dir}
      onPick={(next, d) => update({ field: next as SongSortField, dir: d })}
      openRef={openRef}
    />
  );

  // Stable identity so the FlatList that receives them doesn't re-evaluate rows.
  const songs = useMemo(() => ordered.map((o) => o.song), [ordered]);
  const indices = useMemo(() => ordered.map((o) => o.idx), [ordered]);

  return {
    songs,
    indices,
    openSort: () => openRef.current(),
    sortSheet,
    sort: { field, dir },
    setSort: update,
  };
}
