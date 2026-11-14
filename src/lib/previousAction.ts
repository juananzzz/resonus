import type { PreviousButtonMode } from '@/store/settings';

/** What pressing "previous" should do. */
export type PreviousAction = 'restart' | 'previous';

/**
 * The player's own previous button restarts the song once it is past a few
 * seconds, unless the user asked it to always step back. That rule is about
 * the button on the screen, where the icon sits beside play/pause and a second
 * press leaves the song.
 *
 * A remote control does not work that way. A headset, a watch or a bike
 * computer calls the control "previous track", and the press arrives as one
 * event with no way to press it again a moment later to step back. Restarting
 * the song there is indistinguishable from the button doing nothing (#307).
 * So a remote previous press always steps, even while the on-screen button
 * keeps the restart-first behavior.
 */
export function previousAction(
  positionSec: number,
  mode: PreviousButtonMode,
  fromRemote = false,
): PreviousAction {
  if (fromRemote) return 'previous';
  return mode !== 'always' && positionSec > 3 ? 'restart' : 'previous';
}
