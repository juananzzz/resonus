/**
 * What a server profile leaves on the device, and how to take it with it.
 *
 * Removing a profile used to remove only its line in the list. Its downloads,
 * which are the gigabytes, and its offline copy of the library stayed on disk
 * for good: counted by nobody, shown nowhere, and reachable only by adding the
 * same account back.
 *
 * Everything a profile owns hangs off one identifier, `<primary url>|<user>`,
 * hashed. That is the name of its download folder, of its mirror database, and
 * the suffix of every preference stored per profile, so one hash finds all of
 * it. SecureStore cannot be asked which keys exist, so the list below is the
 * only record of them: a new per-profile key belongs here too.
 */
import * as FileSystem from 'expo-file-system/legacy';

import type { SubsonicAuth } from '@/api/backend';
import { closeCatalog } from './downloadsDb';
import { hashKey } from './localLibrary';
import { closeMirrorFor } from './mirrorDb';
import { removeMirrorCovers } from './mirrorCovers';
import { closePodcastDb, podcastDbDir } from './podcastDb';
import { primaryUrl } from './serverUrls';
import { closeCacheDb } from './songCacheDb';
import { deleteItem } from './storage';

/** Preferences kept per profile, each stored as `<key>.<hash>`. */
const SCOPED_KEYS = [
  'resonus.settings',
  'resonus.settings.ratingShown',
  'resonus.pins',
  'resonus.lastPlayed',
  'resonus.autodl',
  'resonus.localFavorites',
  'resonus.localPlaylists',
  'resonus.librarySizes',
];

const DOWNLOADS_DIR = `${FileSystem.documentDirectory}downloads/`;
const MIRROR_DIR = `${FileSystem.documentDirectory}library-mirror/`;
const SONG_CACHE_DIR = `${FileSystem.documentDirectory}song-cache/`;

async function remove(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

/**
 * Removes everything belonging to a server account.
 *
 * Only server accounts: the local profile is the phone's own music, shared by
 * whoever uses it, and nothing here is its to delete.
 */
export async function deleteProfileData(auth: SubsonicAuth): Promise<void> {
  const scope = hashKey(`${primaryUrl(auth)}|${auth.username}`);
  const dir = `${DOWNLOADS_DIR}${scope}/`;

  // The databases are closed before their files go, or the handles would
  // outlive what they point at and every later read would fail on a profile
  // that no longer exists.
  await closeCatalog(dir);
  await closeMirrorFor(scope);
  await closePodcastDb(scope);

  // The downloads: the audio, the covers and the catalog that indexed them.
  await remove(dir);

  // The podcasts subscribed to on the phone. A subscription is not a cache:
  // it is a list the user wrote, and it goes with the account that wrote it.
  await remove(podcastDbDir(scope));

  // The song cache, index and all (#180).
  const cacheDir = `${SONG_CACHE_DIR}${scope}/`;
  await closeCacheDb(cacheDir);
  await remove(cacheDir);

  // The offline copy, which is three files, plus the JSON it came from if it
  // was never migrated or was kept behind as a backup.
  for (const name of [
    `mirror-${scope}.db`,
    `mirror-${scope}.db-wal`,
    `mirror-${scope}.db-shm`,
    `${scope}.json`,
    `${scope}.json.bak`,
  ]) {
    await remove(`${MIRROR_DIR}${name}`);
  }

  // The covers kept for that mirror, which live in a folder of their own: one
  // file per cover plus the index that says which id each belongs to.
  await removeMirrorCovers(scope);

  for (const key of SCOPED_KEYS) {
    await deleteItem(`${key}.${scope}`).catch(() => {});
  }
}
