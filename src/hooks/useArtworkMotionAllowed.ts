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
  const cellular = useNetworkType((s) => s.cellular);
  const connected = useNetworkType((s) => s.connected);
  return artworkNetworkAllowed(wifiOnly, { cellular, connected });
}

/** On the visible screen. Enough for a GIF, whose bytes are already here. */
export function useArtworkAnimationAllowed(): boolean {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  const reducedMotion = useReducedMotion();
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused && active && !reducedMotion;
}

/** A clip has to be fetched, so it also needs the network to allow it. */
export function useArtworkMotionAllowed(): boolean {
  const visible = useArtworkAnimationAllowed();
  const networkAllowed = useArtworkNetworkAllowed();
  const offline = useAuthStore((s) => s.offline);
  return visible && networkAllowed && !offline;
}
