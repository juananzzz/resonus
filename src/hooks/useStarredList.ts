/**
 * The whole favorites answer as one query, so a section kept to favorites can
 * list them: `useFavoriteIds` answers only whether one id is hearted, which is
 * all a row needs, while a list of favorites needs the rows themselves — and
 * filtering the browse pages instead would only see whatever has scrolled in
 * so far. Same `['starred']` key, so the list and the hearts on it are one
 * request and one cache entry, and the star/unstar invalidation that already
 * exists repaints both together.
 *
 * `enabled` is the section's heart: with it off the request never goes out.
 */
import { useQuery } from '@tanstack/react-query';

import { getStarred } from '@/api/data';
import { useAuthStore } from '@/store/auth';

export function useStarredList(enabled = true) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  return useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: enabled && canFetch,
  });
}
