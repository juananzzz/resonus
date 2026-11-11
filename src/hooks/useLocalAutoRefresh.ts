/**
 * Keeps the local profile's catalog up with the files: a look at the folders
 * when the app opens and when it comes back to the front.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { refreshLocal } from '@/api/data';
import { useT } from '@/i18n';
import { useToast } from '@/store/toast';
import { useLocalProfile } from './useLocalProfile';

const BOOT_DELAY_MS = 4000;

export function useLocalAutoRefresh(): void {
  const local = useLocalProfile();
  const t = useT();
  const toast = useToast((s) => s.show);
  useEffect(() => {
    if (!local) return;
    const check = () =>
      void refreshLocal().then((changed) => {
        if (changed) toast(t('Library updated'));
      });
    // Not in the way of the app starting: the walk can wait for the first
    // screen and the restored queue.
    const first = setTimeout(check, BOOT_DELAY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, [local, t, toast]);
}
