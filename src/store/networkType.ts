/**
 * Current connection type, cached in a store to decide the streaming bitrate
 * synchronously (`sourceFor` can't await an async) and so the UI reacts if the
 * network changes.
 */
import * as Network from 'expo-network';
import { create } from 'zustand';

interface NetworkTypeState {
  /** true if the active connection is cellular. */
  cellular: boolean;
  /** Explicit Wi-Fi detection; false until the initial network check finishes. */
  wifi: boolean;
  /**
   * true if there is a network at all. Not the same as the app's offline mode,
   * which is about the music server: a local profile has no server and every
   * bit of internet in the world.
   */
  connected: boolean;
}

/**
 * `connected` starts true on purpose. Everything that reads it is deciding
 * whether to try something over the network, and the answer while nobody has
 * looked yet should be "try", not "don't": the attempt fails at worst, and the
 * watcher only takes a moment to say otherwise.
 */
export const useNetworkType = create<NetworkTypeState>(() => ({
  cellular: false,
  wifi: false,
  connected: true,
}));

function apply(state: Network.NetworkState) {
  const cellular = state.type === Network.NetworkStateType.CELLULAR;
  // `isInternetReachable` is the stricter of the two on Android (a validated
  // connection), but it is also the one that goes undefined; `isConnected`
  // backs it up, and an unknown answer is treated as connected.
  const connected = state.isInternetReachable ?? state.isConnected ?? true;
  const wifi = state.type === Network.NetworkStateType.WIFI;
  const current = useNetworkType.getState();
  if (current.cellular !== cellular || current.connected !== connected || current.wifi !== wifi) {
    useNetworkType.setState({ cellular, connected, wifi });
  }
}

/**
 * Whether the phone is off any local network right now: on mobile data, or on
 * nothing at all. Asked fresh rather than read from the store, whose
 * `connected` is about the internet, which a speaker on the LAN never needed.
 * A connection of another or unknown kind (a VPN over Wi-Fi) still counts as on.
 */
export async function offLocalNetwork(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return (
      s.isConnected === false ||
      s.type === Network.NetworkStateType.NONE ||
      s.type === Network.NetworkStateType.CELLULAR
    );
  } catch {
    return false;
  }
}

let started = false;

/** Starts the watcher (idempotent; from the root layout). */
export function initNetworkType(): void {
  if (started) return;
  started = true;
  // Initial state: the listener only fires on changes.
  Network.getNetworkStateAsync()
    .then(apply)
    .catch(() => {}); // when in doubt, default to `cellular: false` (Wi-Fi quality)
  Network.addNetworkStateListener(apply);
}
