/**
 * Stable read of the root route segment.
 *
 * `useSegments()` from expo-router delivers a new array reference on every
 * navigation event — tab switches included — causing every subscriber to
 * re-render even when nothing the subscriber cares about changed. Storing just
 * `segments[0]` (a primitive string) here means that the 63+ callers of
 * `useTabBarShown` / `useMiniPlayerShown` / `useScreenBottomPadding` only
 * re-render when the root route actually changes (e.g. entering or leaving the
 * player, queue, or lyrics screens), not on every tab switch.
 */
import { create } from 'zustand';

interface NavState {
  rootSegment: string | undefined;
  _setRootSegment: (s: string | undefined) => void;
}

export const useNavState = create<NavState>((set) => ({
  rootSegment: undefined,
  _setRootSegment: (rootSegment) => set({ rootSegment }),
}));
