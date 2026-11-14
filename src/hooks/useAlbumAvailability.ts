/**
 * What the downloads say about an album you kept: whether it is whole on the
 * phone (the ↓ badge), and whether offline there is nothing here to play at all
 * (dim the row, or drop it in hide mode). Dimming and hiding are a server
 * account's problem — on the local profile everything is on the phone — and the
 * shelf is read once per download change, not per row.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { type Album } from '@/api/data';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { getDownloadShelf, useDownloads } from '@/store/downloads';

/** `enabled` is the mode that asks: the badges and the dimming belong to the
 *  favorited list, and nothing else wants the shelf read. */
export function useAlbumAvailability(enabled = true): {
  downloaded: (album: Album) => boolean;
  unavailable: (album: Album) => boolean;
} {
  const files = useDownloads((s) => s.files);
  const fileCount = useMemo(() => Object.keys(files).length, [files]);
  const offline = useAuthStore((s) => s.offline && !!s.auth);
  const { data: shelf } = useQuery({
    queryKey: ['downloadShelf', profileScopeId(), fileCount],
    queryFn: async () =>
      new Map((await getDownloadShelf()).albums.map((a) => [a.id, a.songCount ?? 0])),
    staleTime: Infinity,
    enabled,
  });
  return useMemo(
    () => ({
      downloaded: (a: Album) => (shelf?.get(a.id) ?? 0) >= (a.songCount || Infinity),
      unavailable: (a: Album) => offline && !!shelf && !shelf.has(a.id),
    }),
    [shelf, offline],
  );
}
