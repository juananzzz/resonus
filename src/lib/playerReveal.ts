/**
 * The player being pulled up out of the mini player.
 *
 * While the finger is on the mini player and going up, the player screen is
 * already open (pushed with no animation of its own) and sits this far down
 * from the top, following the finger. -1 when no pull is driving it, which is
 * every other way of opening and closing it.
 */
import { makeMutable } from 'react-native-reanimated';

export const revealOffset = makeMutable(-1);

/**
 * Whether the player is the screen on top. A pull let go of closes the player
 * with a back, and a back with anything else on top closes that instead: the
 * push the pull asked for may not have landed yet, or was dropped by
 * `pushOnce` (#324).
 */
export const playerOnTop = { current: false };
