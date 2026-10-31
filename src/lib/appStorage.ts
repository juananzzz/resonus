/**
 * What the app keeps on this phone besides the music, measured.
 *
 * Downloads have their own accounting (the catalog knows what each file took
 * when it was written), and the offline copy of the library reports its own
 * size. What was left over was everything else: the lyrics saved next to
 * downloads, the index of a scanned local library and its covers, the pictures
 * put on local playlists. Each of them small on its own and none of them
 * visible anywhere, which is how a phone ends up with a few hundred megabytes
 * belonging to an app that says it is using none.
 *
 * Sizes come from the file system in one call per folder rather than by
 * walking them here: adding up thousands of files one at a time on the JS
 * thread is what made this screen stutter before (#50).
 */
import { Directory } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';

const base = Legacy.documentDirectory ?? '';

/** Folders that are neither the music nor the mirror. */
const FOLDERS = {
  artistSignatures: `${base}artist-signatures/`,
  /** LRCLIB answers cached as `.lrc`, and the ones saved with a download. */
  lyrics: `${base}lyrics-cache/`,
  /**
   * The index of the phone's own music, NOT the music: the tags read once
   * while scanning plus a cover per album pulled out of the files. The music
   * itself is the person's own files, wherever they keep them, and none of
   * this app's business to count.
   */
  localLibrary: `${base}local-catalog/`,
  /** Pictures put on a local profile's playlists. */
  playlistCovers: `${base}playlist-covers/`,
  /** Radio station art from before it was kept with the rest. */
  legacyRadioCovers: `${base}radio-covers/`,
  /** Favourites, ratings and edits made offline, waiting to go up. */
  outbox: `${base}offline-queue/`,
  /**
   * The shows kept on the device: feeds, what was read from each, hearts. The
   * episodes downloaded for them are counted with the downloads, whose sizes
   * the database wrote down; what is left here is the index itself.
   */
  podcasts: `${base}podcasts/`,
} as const;

export type StorageParts = Record<keyof typeof FOLDERS, number>;

function sizeOf(uri: string): number {
  try {
    return new Directory(uri).size ?? 0;
  } catch {
    // Not there, or not readable: nothing to report.
    return 0;
  }
}

/** Bytes per folder. Zero for the ones this profile has never filled. */
export function appStorageParts(): StorageParts {
  const out = {} as StorageParts;
  for (const [key, uri] of Object.entries(FOLDERS) as [keyof typeof FOLDERS, string][]) {
    out[key] = sizeOf(uri);
  }
  return out;
}

/** Everything above, added up. */
export function appStorageTotal(parts: StorageParts): number {
  return Object.values(parts).reduce((a, b) => a + b, 0);
}
