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

/**
 * How far the player has been pulled down during a dismiss swipe, as a 0→1
 * fraction of the screen height. 0 when the player is fully open or not being
 * dismissed; grows toward 1 as the finger drags down. GlobalMiniPlayer reads
 * this to fade back in while the player is still on screen, so there is no
 * blank gap before navigation completes.
 */
export const dismissProgress = makeMutable(0);
