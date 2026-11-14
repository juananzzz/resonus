/**
 * Playlists marked for AUTO DOWNLOAD (per profile). When enabled, their songs
 * are downloaded and, each time they are refreshed (on open, on adding a song
 * from the app, or when the app returns to foreground), the missing ones are
 * downloaded.
 *
 * v1: only ADDS. Removing a song from the list does not delete its file (it could
 * be in another download; reference-counted deletion is left for later).
 * Disabling the toggle also doesn't delete anything: it just stops syncing.
 *
 * Reuses `downloadPlaylist`, which is already idempotent (skips already downloaded,
 * respects quality/codec/Wi-Fi-only) and refreshes the local playlist `dl_<id>`
 * with the new composition, so reconciling is: request current tracklist + download.
 */
import { create } from 'zustand';

import { getAlbum, getArtist, getPlaylist, getStarred } from '@/api/data';
import { type Playlist, type Song } from '@/api/subsonic';
import { autoDownloadKey, parseAutoDownloadKey, type AutoDownloadTarget } from '@/lib/autoDownloadTargets';
import { hashKey } from '@/lib/localLibrary';
import type { Remap } from '@/lib/navidromeRemap';
import { remapKeys } from '@/lib/navidromeRemap';
import { profileScopeGuard } from '@/lib/profileScope';
import { getItem, setItem } from '@/lib/storage';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useNetworkType } from '@/store/networkType';
import { useSettings } from '@/store/settings';

// Favorites are auto-downloaded too. They aren't a playlist (own tracklist via
// getStarred / downloadFavorites), so they use this reserved id in the same
// `ids` map. The sentinel can't collide with a real server playlist id.
export const FAVORITES_AUTODL_ID = '__favorites__';

// Per profile: each account stores its auto-download playlists under
// `resonus.autodl.<profile hash>`.
const KEY = 'resonus.autodl';
function storeKey(): string {
  return `${KEY}.${hashKey(profileScopeId())}`;
}

const scope = profileScopeGuard();

/**
 * Can we reconcile now? Without connection or account, no. In background
 * (foreground/open/add) we don't bother with the Wi-Fi toast: if "Wi-Fi only"
 * mode is on and there is mobile data, it's left for the next attempt.
 */
function canRun(background: boolean): boolean {
  const { offline, auth } = useAuthStore.getState();
  if (offline || !auth) return false;
  if (background && useSettings.getState().downloadWifiOnly && useNetworkType.getState().cellular) {
    return false;
  }
  return true;
}

interface AutoDownloadsState {
  /** Stored key → marked for auto-download. */
  ids: Record<string, true>;
  /** Toggles the flag (does not reconcile; caller decides with what data). */
  toggle: (playlistId: string) => void;
  /** Same, for an album or an artist as well as a playlist. */
  toggleTarget: (target: AutoDownloadTarget) => void;
  /** Rewrites the marked playlist ids after the server renamed them (#5824).
   *  Left behind, a playlist quietly stops being kept up to date. */
  remapIds: (f: Remap) => void;
  /** Reconciles by requesting the current tracklist from the server. */
  reconcile: (playlistId: string, background?: boolean) => Promise<void>;
  /** Reconciles with a tracklist already in hand (avoids re-requesting from server). */
  reconcileKnown: (playlist: Playlist, songs: Song[], background?: boolean) => Promise<void>;
  /** Reconciles favorites with a tracklist already in hand (favorites aren't a playlist). */
  reconcileFavoritesKnown: (songs: Song[], background?: boolean) => Promise<void>;
  /** Reconciles all marked (on returning to foreground). */
  reconcileAll: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAutoDownloads = create<AutoDownloadsState>((set, get) => ({
  ids: {},

  toggle: (playlistId) => {
    get().toggleTarget({ kind: 'playlist', id: playlistId });
  },

  toggleTarget: (target) => {
    const key = autoDownloadKey(target);
    const ids = { ...get().ids };
    if (ids[key]) delete ids[key];
    else ids[key] = true;
    set({ ids });
    const storageKey = storeKey();
    // Not one profile's list under another's key (see `profileScopeGuard`).
    if (scope.owns(storageKey)) void setItem(storageKey, JSON.stringify(ids));
  },

  remapIds: (f) => {
    const ids = remapKeys(get().ids, f);
    set({ ids });
    const key = storeKey();
    if (scope.owns(key)) void setItem(key, JSON.stringify(ids));
  },

  reconcile: async (key, background = false) => {
    if (!get().ids[key] || !canRun(background)) return;
    const target = parseAutoDownloadKey(key);
    try {
      if (target.kind === 'playlist') {
        if (key === FAVORITES_AUTODL_ID) {
          const { songs } = await getStarred();
          await useDownloads.getState().downloadFavorites(songs);
        } else {
          const { playlist, songs } = await getPlaylist(key);
          await useDownloads.getState().downloadPlaylist(playlist, songs);
        }
      } else if (target.kind === 'album') {
        const { album, songs } = await getAlbum(target.id);
        await useDownloads.getState().downloadAlbum(album, songs);
      } else {
        // An artist is their discography, on the same terms as the download
        // button on the artist's own screen: only their own albums.
        const { albums } = await getArtist(target.id);
        const parts = await Promise.all(
          albums.map((album) => getAlbum(album.id)),
        );
        const songs = parts.flatMap((part) => part.songs);
        await useDownloads.getState().downloadArtist(target.id, songs, albums);
      }
    } catch {
      // Network down or other: retried on next trigger.
    }
  },

  reconcileKnown: async (playlist, songs, background = false) => {
    if (!get().ids[playlist.id] || !canRun(background)) return;
    try {
      await useDownloads.getState().downloadPlaylist(playlist, songs);
    } catch {
      // same: no noise, retried later.
    }
  },

  reconcileFavoritesKnown: async (songs, background = false) => {
    if (!get().ids[FAVORITES_AUTODL_ID] || !canRun(background)) return;
    try {
      await useDownloads.getState().downloadFavorites(songs);
    } catch {
      // same: no noise, retried later.
    }
  },

  reconcileAll: async () => {
    // Sequential on purpose: don't saturate network/disk by starting all at once.
    for (const id of Object.keys(get().ids)) {
      await get().reconcile(id, true);
    }
  },

  hydrate: async () => {
    // Re-executed on profile change: RESET to {} if the new profile has none, or
    // the previous profile's would remain in memory.
    const key = storeKey();
    const token = scope.start();
    try {
      const raw = await getItem(key);
      // Overtaken by a newer hydration: that one owns the list now.
      if (!scope.accept(token, key)) return;
      set({ ids: raw ? (JSON.parse(raw) as Record<string, true>) : {} });
    } catch {
      if (scope.accept(token, key)) set({ ids: {} });
    }
  },
}));
