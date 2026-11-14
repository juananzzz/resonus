/**
 * What the Library can keep downloaded automatically.
 *
 * Playlists were the first thing the setting applied to, so their ids are kept
 * exactly as they always were: a saved choice from an older version still
 * reads. Albums and artists are prefixed, which is what keeps them apart from
 * a playlist id (and from each other) in the one map the store persists.
 */
export type AutoDownloadTarget =
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string };

const PREFIX = {
  playlist: 'playlist:',
  album: 'album:',
  artist: 'artist:',
} as const;

/**
 * The key this target is stored under.
 *
 * A playlist id is kept as it always was — a saved choice from an older
 * version still reads — unless it begins with one of the prefixes above. Such
 * an id would otherwise read back as an album or artist, so it is escaped with
 * `playlist:`; the store never produced one, and a real Subsonic id does not
 * contain a colon.
 */
export function autoDownloadKey(target: AutoDownloadTarget): string {
  if (target.kind === 'playlist') {
    const escaped = Object.values(PREFIX).some((p) => target.id.startsWith(p));
    return escaped ? `${PREFIX.playlist}${target.id}` : target.id;
  }
  return `${PREFIX[target.kind]}${target.id}`;
}

/** The target a stored key names. A key with no known prefix is a playlist. */
export function parseAutoDownloadKey(key: string): AutoDownloadTarget {
  if (key.startsWith(PREFIX.playlist)) {
    return { kind: 'playlist', id: key.slice(PREFIX.playlist.length) };
  }
  if (key.startsWith(PREFIX.album)) {
    return { kind: 'album', id: key.slice(PREFIX.album.length) };
  }
  if (key.startsWith(PREFIX.artist)) {
    return { kind: 'artist', id: key.slice(PREFIX.artist.length) };
  }
  return { kind: 'playlist', id: key };
}

/** Is this target among the ones marked for automatic download? */
export function isAutoDownloaded(
  ids: Record<string, true | undefined>,
  target: AutoDownloadTarget,
): boolean {
  return !!ids[autoDownloadKey(target)];
}
