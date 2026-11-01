/**
 * Startup tab.
 *
 * On cold start, if the default tab is not Home, jump to it. Coming back from
 * the background leaves the app where it was, however long it was away (#225).
 *
 * Renders nothing; only orchestrates navigation. Mounted with an active session.
 */
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { mark } from '@/lib/perfLog';
import { useAutoDownloads } from '@/store/autoDownloads';
import { useSettings, type DefaultTab } from '@/store/settings';
import { refreshAutoDownloadShows } from '@/api/podcasts';

const TAB_HREF: Record<DefaultTab, '/' | '/search' | '/library' | '/explore'> = {
  index: '/',
  search: '/search',
  library: '/library',
  explore: '/explore',
};

export function AppStartupTab() {
  const router = useRouter();
  const chosenTab = useSettings((s) => s.defaultTab);
  const bottomTabs = useSettings((s) => s.bottomTabs);
  /**
   * The tab to open on, which is not always the one that was chosen: it can
   * have been taken off the bar since (Settings › Navigation bar). Opening on
   * a screen with no way back to it is worse than opening on the first one
   * that is there, and Home always is.
   */
  const defaultTab = bottomTabs.some((t) => t.key === chosenTab && t.enabled)
    ? chosenTab
    : 'index';
  const didInitial = useRef(false);
  const pathname = usePathname();

  /**
   * How long the thread takes to come back after a screen changes.
   *
   * This is the number everybody has been arguing about and nobody had: the
   * complaint is "half a second between tapping and the screen being there",
   * and everything measured so far has been how long single operations take,
   * which is not the same thing.
   *
   * The clock starts when the route changes and stops on the next frame the
   * thread manages to run, so what it counts is the new screen's first render
   * plus whatever else was in the way. It says nothing about the animation:
   * that is native, and if this number comes back small while the app still
   * feels slow, the animation is where to look next.
   *
   * By section rather than by route, or every album would be a line of its own.
   */
  useEffect(() => {
    const started = Date.now();
    const section = pathname === '/' ? '/' : `/${pathname.split('/')[1] ?? ''}`;
    const frame = requestAnimationFrame(() => mark(`nav ${section}`, Date.now() - started));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  // Cold start: if the default tab is not Home, jump to it.
  useEffect(() => {
    if (didInitial.current) return;
    didInitial.current = true;
    if (defaultTab !== 'index') {
      if (router.canDismiss()) router.dismissAll();
      router.navigate(TAB_HREF[defaultTab]);
    }
    // On mount only; the value lives in the guard ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // On return, sync auto-download playlists (catch what was added from
      // another client while the app was in the background).
      if (state === 'active') {
        void useAutoDownloads.getState().reconcileAll();
        void refreshAutoDownloadShows().catch(() => {});
      }
    });
    void refreshAutoDownloadShows().catch(() => {});
    return () => sub.remove();
  }, []);

  return null;
}
