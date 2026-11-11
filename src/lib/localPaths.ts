/**
 * Where the phone's music files are, as paths.
 *
 * The local catalog knows a song by its URI, which is a `file://` on the device
 * source and a SAF document URI on a chosen folder. Both carry the file's real
 * path, and a path is what browsing by folder and reading a playlist file are
 * made of. Pure functions, so they run on Node for the tests.
 */

/**
 * The path a song's URI stands for: `/storage/emulated/0/Music/a/b.mp3` for a
 * file, `primary:Music/a/b.mp3` for a SAF document.
 */
export function pathOfUri(uri: string): string {
  // The document id is the last piece and has its slashes encoded, so the raw
  // split cannot land on a folder that happens to be called "document".
  const doc = uri.lastIndexOf('/document/');
  const raw = doc >= 0 ? uri.slice(doc + '/document/'.length) : uri.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The path of the folder a tree URI was granted for (`primary:Music`). */
export function pathOfTree(treeUri: string): string {
  const tree = treeUri.lastIndexOf('/tree/');
  const raw = tree >= 0 ? treeUri.slice(tree + '/tree/'.length).split('/')[0] : treeUri;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The folder a path is in, or '' at the top. */
export function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/** The last piece of a path, with the volume of a SAF root taken off. */
export function baseOf(path: string): string {
  const leaf = path.slice(path.lastIndexOf('/') + 1);
  return leaf.slice(leaf.lastIndexOf(':') + 1) || leaf;
}

export interface FolderNode {
  dirs: Set<string>;
  /** Ids of the songs lying directly in it. */
  songs: string[];
  /** The album of one of them, whose cover the folder borrows. */
  albumId?: string;
}

/**
 * Every folder that has music somewhere under it, by path.
 *
 * Built from the songs alone: a folder with no music in it is not on this map,
 * which is also what keeps the rest of the phone out of it.
 */
export function folderTree(
  songs: { id: string; uri: string; albumId?: string }[],
): Map<string, FolderNode> {
  const tree = new Map<string, FolderNode>();
  const node = (path: string): FolderNode => {
    let found = tree.get(path);
    if (!found) {
      found = { dirs: new Set(), songs: [] };
      tree.set(path, found);
    }
    return found;
  };
  for (const song of songs) {
    let dir = dirOf(pathOfUri(song.uri));
    const own = node(dir);
    own.songs.push(song.id);
    own.albumId = own.albumId ?? song.albumId;
    // Up to the top, stopping where an earlier song already made the way.
    while (dir) {
      const parent = dirOf(dir);
      const above = node(parent);
      if (above.dirs.has(dir)) break;
      above.dirs.add(dir);
      dir = parent;
    }
  }
  return tree;
}

/** The deepest folder everything is under: where browsing starts when nobody
 *  chose one (the device source). */
export function commonRoot(tree: Map<string, FolderNode>): string {
  let path = '';
  for (;;) {
    const at = tree.get(path);
    if (!at || at.songs.length > 0 || at.dirs.size !== 1) return path;
    path = [...at.dirs][0];
  }
}

// ── Playlist files ──────────────────────────────────────────────────────────

/** The entries of an `.m3u`: one path per line, comments and blanks dropped. */
export function parseM3u(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function segments(path: string): string[] {
  let clean = path.replace(/\\/g, '/').replace(/^file:\/\//, '');
  if (/%[0-9a-f]{2}/i.test(clean)) {
    try {
      clean = decodeURIComponent(clean);
    } catch {
      // Not encoded after all: a name with a percent sign in it.
    }
  }
  const out: string[] = [];
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part.toLowerCase());
  }
  return out;
}

/**
 * Matches playlist entries to songs by where their files are.
 *
 * A playlist written on another machine names the same files by another road
 * (`D:\Music\a\b.mp3`, `../a/b.mp3`), so the match is from the file name
 * backwards: among the songs called the same, the one sharing the most folders
 * with the entry. A single candidate is taken on its name alone.
 */
export function m3uMatcher(
  songs: { id: string; uri: string }[],
): (entry: string, playlistDir: string) => string | undefined {
  const byName = new Map<string, { id: string; parts: string[] }[]>();
  for (const song of songs) {
    const parts = segments(pathOfUri(song.uri).replace(/^[^/:]*:/, ''));
    const name = parts[parts.length - 1];
    if (!name) continue;
    const list = byName.get(name);
    if (list) list.push({ id: song.id, parts });
    else byName.set(name, [{ id: song.id, parts }]);
  }
  return (entry, playlistDir) => {
    const absolute = /^([a-z]:)?[\\/]/i.test(entry) || /^file:/i.test(entry);
    const parts = segments(absolute ? entry : `${playlistDir.replace(/^[^/:]*:/, '')}/${entry}`);
    const candidates = byName.get(parts[parts.length - 1] ?? '');
    if (!candidates) return undefined;
    let best: string | undefined;
    let bestShared = 0;
    for (const c of candidates) {
      let shared = 0;
      while (
        shared < parts.length &&
        shared < c.parts.length &&
        parts[parts.length - 1 - shared] === c.parts[c.parts.length - 1 - shared]
      ) {
        shared++;
      }
      if (shared > bestShared) {
        bestShared = shared;
        best = c.id;
      }
    }
    return best;
  };
}

/** A path other players on the phone can open, where the URI gives one away. */
export function filePathOf(uri: string): string {
  const path = pathOfUri(uri);
  const volume = /^([^/:]+):(.*)$/.exec(path);
  if (!volume) return path;
  const root = volume[1] === 'primary' ? '/storage/emulated/0' : `/storage/${volume[1]}`;
  return `${root}/${volume[2]}`;
}

/** An extended `.m3u8` of these songs. */
export function buildM3u(
  songs: { title: string; artist?: string; duration?: number; localUri?: string }[],
): string {
  const lines = ['#EXTM3U'];
  for (const song of songs) {
    if (!song.localUri) continue;
    const name = song.artist ? `${song.artist} - ${song.title}` : song.title;
    lines.push(`#EXTINF:${Math.round(song.duration ?? -1)},${name}`, filePathOf(song.localUri));
  }
  return lines.join('\n') + '\n';
}
