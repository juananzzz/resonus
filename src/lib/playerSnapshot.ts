import type { PlayerState } from '@/store/player';

/**
 * The fields that say what is playing, and that a "put it back" has to take
 * and restore as one set.
 *
 * Both spellings of "back" read this: a queue that failed to start restores
 * the one that was playing, and the previous button restores the context it
 * was pushed from. Keeping the field list here, once, is what stops one of
 * them capturing a field the other forgets to write — the radio pair used to
 * be captured and never restored.
 */
export const PLAYER_SNAPSHOT_FIELDS = [
  'queue',
  'index',
  'queuedCount',
  'positionSec',
  'durationSec',
  'originalQueue',
  'queueDealt',
  'source',
  'sourceHref',
  'radioMode',
  'radioSeed',
  'shuffle',
] as const;

export type PlayerSnapshot = Pick<PlayerState, (typeof PLAYER_SNAPSHOT_FIELDS)[number]>;

/** Copies the snapshot fields off a full player state. */
export function captureSnapshot(state: PlayerSnapshot): PlayerSnapshot {
  return Object.fromEntries(
    PLAYER_SNAPSHOT_FIELDS.map((key) => [key, state[key]]),
  ) as PlayerSnapshot;
}

/**
 * The state that puts a snapshot back.
 *
 * `restart` is for the previous button: it loads the restored track afresh, so
 * the clock and the pending block start at zero rather than where the old
 * session left them. Every other field is written from the snapshot.
 */
export function restoreSnapshot(
  entry: PlayerSnapshot,
  opts: { restart?: boolean } = {},
): PlayerSnapshot {
  const restored = captureSnapshot(entry);
  if (opts.restart) {
    restored.queuedCount = 0;
    restored.positionSec = 0;
    restored.durationSec = 0;
  }
  return restored;
}
