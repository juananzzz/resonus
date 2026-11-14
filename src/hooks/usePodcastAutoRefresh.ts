/**
 * Keeps the hearted shows up with their feeds: a look at the stale ones when
 *  the app opens and when it comes back to the front.
 *
 * Same shape as `useLocalAutoRefresh`: the hook decides when to look, and
 *  `refreshStaleFavoriteShows` decides which shows are due — a heart read
 *  within the past day stays put, so a show costs at most one read a day.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { refreshStaleFavoriteShows } from '@/api/podcasts';

const BOOT_DELAY_MS = 4000;

export function usePodcastAutoRefresh(): void {
  useEffect(() => {
    const check = () => void refreshStaleFavoriteShows().catch(() => {});
    // Not in the way of the app starting: the feeds wait for the first
    // screen and the restored queue, the same four seconds the walk takes.
    const first = setTimeout(check, BOOT_DELAY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, []);
}
