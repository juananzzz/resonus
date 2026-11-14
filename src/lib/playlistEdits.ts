/**
 * Whether a hand may rewrite a playlist on the server.
 *
 * Two things say it, and servers disagree about which of them they tell you.
 *  Whose list it is comes as the owner, and a server that sends no owner says
 *  nothing rather than "nobody", which counts as yours - the reading `isEditable`
 *  below makes, and no caller should decide it again on its own. Whether the list has an order of yours to rewrite
 *  at all comes as `readonly` on the servers that speak OpenSubsonic: a smart
 *  playlist's songs come out of the rules it was built with on the server, so
 *  moving a row in one would not move a song but ask the server to forget its
 *  rules, and a list somebody else owns is only ever read to you.
 */
import type { Playlist } from '@/api/subsonic';

/** Yours, both for the server that says so and for the one that says nothing. */
export function isMine(
  playlist: Playlist | undefined,
  username: string | undefined,
): boolean {
  return !playlist?.owner || playlist.owner === username;
}

/** Whether a hand may rewrite the list: it is yours, and the server did not
 *  say it cannot be edited.
 */
export function isEditable(
  playlist: Playlist | undefined,
  username: string | undefined,
): boolean {
  return !playlist?.readonly && isMine(playlist, username);
}
