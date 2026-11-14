/**
 * Ordering a folder's songs by the name of the file, not by the tags in it.
 *
 * Folder browsing is the view of the actual directory tree, so a person who
 * numbers their files ("01 …", "02 …") expects that order even when the tracks
 * are tagged differently — or not tagged at all. The default order stays the
 * one the screen has always used; this is the option beside it (#348).
 *
 * Pure functions, so they run on Node for the tests.
 */
import { baseOf, pathOfUri } from './localPaths';

/** The two orders the folder view offers. */
export type FolderSort = 'default' | 'filename';

interface FileNamed {
  title: string;
  /** The phone's own file, on the local profile. */
  localUri?: string;
  /** The server's path to the file, on a Subsonic-compatible server. */
  path?: string;
}

/**
 * The file's own name: from the local URI or the server path, whichever this
 * song carries. A song with neither (a podcast, a radio entry) falls back to
 * its title, which is all there is to order it by.
 */
export function fileNameOf(song: FileNamed): string {
  const at = song.localUri ?? song.path;
  if (!at) return song.title;
  // `pathOfUri` understands SAF document URIs and `file://`; a server's path
  // is already a plain path, and Windows servers may send backslashes.
  return baseOf(pathOfUri(at.replace(/\\/g, '/'))) || song.title;
}

/**
 * Compares two songs by file name. Numeric so "2 two" comes before "10 ten",
 * and case-insensitive because a directory listing is not a dictionary.
 */
export function byFileName(a: FileNamed, b: FileNamed): number {
  return fileNameOf(a).localeCompare(fileNameOf(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}
