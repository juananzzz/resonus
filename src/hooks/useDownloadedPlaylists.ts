import { useQuery } from '@tanstack/react-query';

import { downloadedPlaylistIds } from '@/api/data';
import { profileScopeId } from '@/store/auth';
import { useDownloads } from '@/store/downloads';

/** The playlists with every song on the phone; undefined while it is worked out. */
export function useDownloadedPlaylists(): Set<string> | undefined {
  const fileCount = useDownloads((s) => Object.keys(s.files).length);
  const { data } = useQuery({
    queryKey: ['downloadedPlaylists', profileScopeId(), fileCount],
    queryFn: downloadedPlaylistIds,
  });
  return data;
}
