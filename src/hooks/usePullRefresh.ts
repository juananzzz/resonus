/**
 * Pulling a list down asks it again: the lists the Library's sections show are
 *  the phone's copy of what the server has, so a pull is how you say "read it
 *  again" without leaving the screen. What is on screen stays put while the
 *  request runs, and stays put when it fails — a failed pull is one line of
 *  toast, never the list going empty (the old favourites tab lost a whole
 *  screen that way, and the empty screen looked like an empty library).
 *
 * `reload` is the request for whichever list is actually on screen, so the
 *  caller picks it: a section's heart swaps which one that is (its favourites
 *  answer is one full request, the browse window is the paginated one), and
 *  asking the wrong one would refresh a list you are not looking at.
 *
 * `failure` is the key the toast writes when the pull's own request failed.
 */
import { useState } from 'react';

import { useToast } from '@/store/toast';
import { useT } from '@/i18n';

export function usePullRefresh(reload: () => unknown, failure: string) {
  const t = useT();
  const toast = useToast((s) => s.show);
  const [refreshing, setRefreshing] = useState(false);

  function onRefresh() {
    // A pull that is already running ignores the next flick of the same drag.
    if (refreshing) return;
    setRefreshing(true);
    void (async () => {
      try {
        await reload();
      } catch {
        toast(t(failure));
      } finally {
        setRefreshing(false);
      }
    })();
  }

  return { refreshing, onRefresh };
}
