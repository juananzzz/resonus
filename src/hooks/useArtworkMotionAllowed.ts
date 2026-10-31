import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { AppState } from 'react-native';
import { useNetworkType } from '@/store/networkType';
import { useSettings } from '@/store/settings';
import { artworkNetworkAllowed } from '@/lib/artworkMotionPolicy';
import { useAuthStore } from '@/store/auth';

export function useArtworkNetworkAllowed(): boolean {
  const wifiOnly = useSettings((s) => s.motionArtworkWifiOnly);
  const wifi = useNetworkType((s) => s.wifi);
  const connected = useNetworkType((s) => s.connected);
  return artworkNetworkAllowed(wifiOnly, { wifi, connected });
}

/** Decorative motion belongs only to the visible, online screen. */
export function useArtworkMotionAllowed(): boolean {
  const [focused, setFocused] = useState(false);
  const networkAllowed = useArtworkNetworkAllowed();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  const offline = useAuthStore((s) => s.offline);
  const reducedMotion = useReducedMotion();
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused && active && networkAllowed && !offline && !reducedMotion;
}
