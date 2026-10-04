import { useMemo } from 'react';

import { coverArtUrl, songCoverUrl } from '@/api/data';
import { useAuthStore } from '@/store/auth';

/**
 * `coverArtUrl` and `songCoverUrl`, for drawing with.
 *
 * Offline mode decides which URL a cover gets (see `CACHED_COVER`), and the
 * two read it from the store. The React Compiler takes them for pure, so a row
 * kept the URL it was first drawn with across a change of mode. These are new
 * functions whenever the mode changes, which is what tells it to ask again.
 */
export function useCoverUrls() {
  // Out of the compiler itself: the mode is what the memo is keyed on without
  // being read in it, and the compiler drops a dependency it does not see used.
  'use no memo';
  const offline = useAuthStore((s) => s.offline);
  const signedIn = useAuthStore((s) => !!s.auth);
  return useMemo(
    () => ({
      coverArtUrl: (...args: Parameters<typeof coverArtUrl>) => coverArtUrl(...args),
      songCoverUrl: (...args: Parameters<typeof songCoverUrl>) => songCoverUrl(...args),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offline, signedIn],
  );
}
