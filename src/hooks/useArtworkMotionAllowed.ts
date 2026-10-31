import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { useAuthStore } from '@/store/auth';

/** Decorative motion belongs only to the visible, online screen. */
export function useArtworkMotionAllowed(): boolean {
  const [focused, setFocused] = useState(false);
  const offline = useAuthStore((s) => s.offline);
  const reducedMotion = useReducedMotion();
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused && !offline && !reducedMotion;
}
