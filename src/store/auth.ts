/**
 * Session state with support for multiple saved profiles.
 *
 * - `auth`: active session.
 * - `profiles`: saved accounts (server or offline) to choose from.
 *
 * Signing out only deactivates the active session; profiles are kept
 * so they can be resumed with a single tap.
 */
import { create } from 'zustand';

import {
  makeAuth,
  normalizeUrl,
  ping,
  reachable,
  SubsonicRequestError,
  type SubsonicAuth,
} from '@/api/backend';
import { primaryUrl } from '@/lib/serverUrls';
import { type CustomHeaders } from '@/lib/customHeaders';
import { bump, timed } from '@/lib/perfLog';
import { clearLocalCatalog, folderSetKey } from '@/lib/localLibrary';
import { deleteProfileData } from '@/lib/profileData';
import { setOfflineMode } from '@/api/netGate';
import { clearProfileCache, queryClient } from '@/lib/query';
import { deleteItem, getItem, setItem } from '@/lib/storage';

const ACTIVE_KEY = 'resonus.auth';
const PROFILES_KEY = 'resonus.profiles';
const OFFLINE_KEY = 'resonus.offline';
const OFFLINE_AUTO_KEY = 'resonus.offlineAuto';
const OFFLINE_SOURCE_KEY = 'resonus.offlineSource';

/** Where offline mode gets its music from. Several folders, since one profile
 *  can have its music spread over more than one (#158). */
export type OfflineSource =
  | { mode: 'device' }
  | { mode: 'folder'; uris: string[] };

/**
 * A source as it may have been written to disk: before #158 there was one
 * folder, under `uri`. Both `resonus.offlineSource` and the `source` of every
 * saved profile carry the old shape.
 *
 * Null for a folder source with nothing in it, which is not a source: it would
 * put the app into a local profile with no music instead of onto the screen
 * that asks where the music is.
 */
function migrateSource(raw: unknown): OfflineSource | null {
  const src = raw as { mode?: string; uri?: string; uris?: unknown };
  if (src?.mode === 'device') return { mode: 'device' };
  if (src?.mode !== 'folder') return null;
  const uris = Array.isArray(src.uris)
    ? src.uris.filter((u): u is string => typeof u === 'string')
    : src.uri
      ? [src.uri]
      : [];
  return uris.length > 0 ? { mode: 'folder', uris } : null;
}

export type ServerProfile = SubsonicAuth & { _type: 'server' };
export type OfflineProfile = { _type: 'offline'; name: string; source: OfflineSource };
export type Profile = ServerProfile | OfflineProfile;

/** Ensures a server profile has `urls` (migration from old ones). */
function withUrls(a: SubsonicAuth): SubsonicAuth {
  if (a.urls && a.urls.length > 0) return a;
  return { ...a, urls: [a.serverUrl] };
}

/** Is this the account currently signed in? Compared the same way profiles
 *  are, so an alternative URL of the same account still counts as itself. */
function sameAccount(auth: SubsonicAuth | null, profile: ServerProfile): boolean {
  if (!auth) return false;
  return same({ ...auth, _type: 'server' }, profile);
}

function same(a: Profile, b: Profile): boolean {
  if (a._type === 'offline' && b._type === 'offline') {
    return a.name === b.name;
  }
  if (a._type === 'server' && b._type === 'server') {
    if (a.username !== b.username) return false;
    if (primaryUrl(a) === primaryUrl(b)) return true;
    // Signing in again through an alternative URL of the same account (the
    // remote one while away from home, say) is the SAME profile. Matching only
    // by primary URL forked a duplicate whose scope id is different, so its
    // settings, pins and covers all looked wiped.
    const au = a.urls ?? [a.serverUrl];
    const bu = b.urls ?? [b.serverUrl];
    return au.some((u) => bu.includes(u));
  }
  return false;
}

function sameSource(a: OfflineSource, b: OfflineSource): boolean {
  if (a.mode === 'folder' && b.mode === 'folder') {
    return folderSetKey(a.uris) === folderSetKey(b.uris);
  }
  return a.mode === b.mode;
}

/** The local profile's stored name when no folder names it. Never shown (the
 *  list says "Local profile"), but it is what `same` compares, so profiles
 *  saved under the old Spanish name are renamed when they are read. */
const OFFLINE_NAME = 'Offline';
const LEGACY_OFFLINE_NAME = 'Sin conexión';

/** The profile's name: the first folder's, and only the first. Adding folders
 *  to a profile does not rename it, which it must not — profiles are told apart
 *  by name (see `same`). */
function offlineLabel(source: OfflineSource): string {
  if (source.mode === 'folder' && source.uris[0]) {
    const decoded = decodeURIComponent(source.uris[0]);
    return decoded.split(/[:/]/).filter(Boolean).pop() ?? OFFLINE_NAME;
  }
  return OFFLINE_NAME;
}

/**
 * Persists a change to the ACTIVE profile: updates `auth`, its entry in
 * `profiles` (via `patch`), and both storage keys. Shared by
 * URL actions, which always operate on the active profile.
 */
async function persistActive(
  get: () => AuthState,
  set: (partial: Partial<AuthState>) => void,
  auth: SubsonicAuth,
  patch: (p: ServerProfile) => ServerProfile,
): Promise<void> {
  const asProfile: ServerProfile = { ...auth, _type: 'server' };
  const profiles = get().profiles.map((p) =>
    p._type === 'server' && same(p, asProfile) ? patch(p) : p,
  );
  await setItem(ACTIVE_KEY, JSON.stringify(auth));
  await setItem(PROFILES_KEY, JSON.stringify(profiles));
  set({ auth, profiles });
}

interface AuthState {
  auth: SubsonicAuth | null;
  profiles: Profile[];
  /** Offline session: plays local files without a server. */
  offline: boolean;
  /**
   * Offline mode was activated by the app itself because the server did not
   * respond (not the user). Only with a server account: when the server becomes
   * reachable again it auto-reconnects. A manual offline keeps this false and is
   * not auto-reverted. See store/autoUrl.ts.
   */
  autoOffline: boolean;
  /** Chosen source for local music (null = not yet chosen). */
  offlineSource: OfflineSource | null;
  /** true while the saved session is being rehydrated on startup. */
  hydrating: boolean;
  login: (
    serverUrl: string,
    username: string,
    password: string,
    serverType?: string,
    plainAuth?: boolean,
    /** Sent on the login request too, for a header-gated server (#160). */
    headers?: CustomHeaders,
  ) => Promise<void>;
  /**
   * Enters a saved profile. With a server profile and no network, instead of
   * failing it falls into that account's offline mode (its downloads). Returns
   * which mode was entered so the UI can notify.
   */
  switchProfile: (profile: Profile) => Promise<'online' | 'offline'>;
  removeProfile: (profile: Profile) => Promise<void>;
  /** Switches the active URL of the profile (one of its `urls`). Reloads the
   *  current track against the new URL; the queue is preserved. */
  setActiveUrl: (url: string) => Promise<void>;
  /** Adds an alternative URL to the active profile. Validates that it responds
   *  with current credentials (same server). Returns the result for the UI. */
  addServerUrl: (url: string) => Promise<'ok' | 'duplicate' | 'unreachable'>;
  /** Changes one of the active profile's URLs, validated like a new one. */
  editServerUrl: (url: string, next: string) => Promise<'ok' | 'duplicate' | 'unreachable'>;
  /** Removes a URL from the active profile (if it was the active one, falls
   *  back to the first remaining). The last one can't be removed. */
  removeServerUrl: (url: string) => Promise<void>;
  /** Enables/disables automatic URL switching on the active profile. */
  setAutoUrl: (value: boolean) => Promise<void>;
  /**
   * Saves Navidrome's native API password to the active profile
   * (for profiles created before login stored it).
   */
  saveNativePassword: (password: string) => Promise<void>;
  /**
   * Replaces the custom HTTP headers of the active server profile (#160).
   * An empty object removes them. They apply to the next request, without
   * signing in again.
   */
  setCustomHeaders: (headers: CustomHeaders) => Promise<void>;
  enterOffline: () => Promise<void>;
  /**
   * Puts the server account into offline mode (show/play downloads)
   * while keeping the session. `auto` = the app decided because server is down.
   */
  goOffline: (auto: boolean) => Promise<void>;
  /** Goes back online on the same account (instant, no re-login). */
  goOnline: () => Promise<void>;
  setOfflineSource: (source: OfflineSource | null) => Promise<void>;
  /** Changes which folders the local profile reads, keeping everything else it
   *  has. Not `setOfflineSource`: that one is for choosing a source from
   *  scratch and throws the favourites and the local playlists away with it. */
  setOfflineFolders: (uris: string[]) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

/**
 * Stable id for the active profile to partition storage per profile
 * (settings, local playlists, local favorites…). Server account:
 * `url|user` (also in its offline mode, which keeps `auth`); local
 * profile: `local`; no session: `default`. When used as a SecureStore
 * key it must be hashed (the URL contains `:`, `/`, `|`, not allowed).
 */
export function profileScopeId(): string {
  const { auth, offline } = useAuthStore.getState();
  if (auth) return `${primaryUrl(auth)}|${auth.username}`;
  return offline ? 'local' : 'default';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  auth: null,
  profiles: [],
  offline: false,
  autoOffline: false,
  offlineSource: null,
  hydrating: true,

  hydrate: async () => {
    try {
      // Timed because it is the first thing the app waits for and nothing is
      // drawn until it answers: five reads out of SecureStore, which is the
      // Android KeyStore decrypting one value at a time.
      const [rawAuth, rawProfiles, rawOffline, rawAuto, rawSource] = await timed(
        'boot session',
        () =>
          Promise.all([
            getItem(ACTIVE_KEY),
            getItem(PROFILES_KEY),
            getItem(OFFLINE_KEY),
            getItem(OFFLINE_AUTO_KEY),
            getItem(OFFLINE_SOURCE_KEY),
          ]),
      );
      const profiles: Profile[] = rawProfiles
        ? (JSON.parse(rawProfiles) as any[]).map((p: any): Profile => {
            if (p._type === 'offline') {
              // A profile whose source cannot be read keeps its place in the
              // list, reading the phone, rather than disappearing from it.
              return {
                ...p,
                name: p.name === LEGACY_OFFLINE_NAME ? OFFLINE_NAME : p.name,
                source: migrateSource(p.source) ?? { mode: 'device' },
              } as OfflineProfile;
            }
            // Server profiles (with or without `_type`): ensure `urls`.
            return { ...withUrls(p), _type: 'server' } as ServerProfile;
          })
        : [];
      const activeAuth = rawAuth ? (JSON.parse(rawAuth) as SubsonicAuth) : null;
      set({
        auth: activeAuth ? withUrls(activeAuth) : null,
        profiles,
        offline: rawOffline === '1',
        autoOffline: rawAuto === '1',
        offlineSource: rawSource ? migrateSource(JSON.parse(rawSource)) : null,
      });
    } catch {
      // If something fails, login will be required again.
    } finally {
      // Whatever the mode turned out to be, this is where it stops being
      // unknown. The gate starts closed (see `api/netGate`), so saying so is
      // what opens it, and a subscription would not: it only fires on a change,
      // and reading back "online" from disk is not one.
      setOfflineMode(get().offline, get().autoOffline);
      set({ hydrating: false });
    }
  },

  login: async (serverUrl, username, password, serverType, plainAuth, headers) => {
    // Signing in again to a saved profile without touching the header field
    // keeps what that profile already had: those headers may be the only way
    // its server answers at all, and asking for them again to change a
    // password would otherwise lock the profile out.
    const savedHeaders =
      headers === undefined
        ? get().profiles.find(
            (p): p is ServerProfile =>
              p._type === 'server' &&
              p.username === username &&
              (p.urls ?? [p.serverUrl]).includes(normalizeUrl(serverUrl)),
          )?.headers
        : undefined;
    const base = await makeAuth(
      serverUrl,
      username,
      password,
      serverType,
      plainAuth,
      headers ?? savedHeaders,
    );
    const auth: ServerProfile = {
      ...base,
      // Born with its URL as the only candidate; more are added from Settings › Network.
      urls: [base.serverUrl],
      _type: 'server',
    };
    // If it's an already known profile (re-login due to password change, etc.),
    // we keep the alternative URLs and switching preference.
    const existing = get().profiles.find(
      (p): p is ServerProfile => p._type === 'server' && same(p, auth),
    );
    if (existing?.urls?.length) {
      auth.urls = existing.urls;
      auth.autoUrl = existing.autoUrl;
      // And the name it is filed under, or signing in again through an address
      // that was edited would look at an empty profile.
      auth.scopeUrl = existing.scopeUrl;
    }
    await ping(auth);
    // The just-used profile goes first (last-used ordering).
    const profiles = [auth, ...get().profiles.filter((p) => !same(p, auth))];
    await setItem(ACTIVE_KEY, JSON.stringify(auth));
    await setItem(PROFILES_KEY, JSON.stringify(profiles));
    await deleteItem(OFFLINE_KEY);
    await deleteItem(OFFLINE_AUTO_KEY);
    // Emptied in the same breath as the session changes, with nothing awaited
    // in between. What is cached was answered by whoever was signed in before,
    // and the query keys do not carry the account: leave the two apart and the
    // screens render the previous profile's playlists and albums under the new
    // one until the clearing gets its turn, which used to be a whole outbox
    // flush later.
    clearProfileCache();
    set({ auth, profiles, offline: false, autoOffline: false });
    // Uploads to the server whatever was pending in this profile's outbox
    // (e.g. changes made offline before signing out). Best-effort.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require('@/api/data').flushOfflineQueue(auth);
    } catch {
      // Does not block the login.
    }
  },

  switchProfile: async (profile) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await require('./player').usePlayerStore.getState().reset(true);
    // The recents are not wiped on the way out any more: they are the leaving
    // profile's and they are filed under its own key, so it finds them again
    // when it comes back (see `store/lastPlayed`).
    // Moves the chosen profile to the front (last-used ordering).
    const reordered = [profile, ...get().profiles.filter((p) => !same(p, profile))];
    if (profile._type === 'offline') {
      await setItem(OFFLINE_KEY, '1');
      await deleteItem(OFFLINE_AUTO_KEY);
      await setItem(OFFLINE_SOURCE_KEY, JSON.stringify(profile.source));
      await setItem(PROFILES_KEY, JSON.stringify(reordered));
      clearProfileCache();
      set({
        auth: null,
        offline: true,
        autoOffline: false,
        offlineSource: profile.source,
        profiles: reordered,
      });
      return 'offline';
    }
    try {
      await ping(profile);
    } catch (e) {
      // No network (not an account rejection): instead of leaving them locked
      // out, enter that account's offline mode —keeping `auth`— to play
      // downloads. `autoOffline` makes it auto-reconnect when the network returns.
      if (e instanceof SubsonicRequestError && e.network) {
        await setItem(ACTIVE_KEY, JSON.stringify(profile));
        await setItem(PROFILES_KEY, JSON.stringify(reordered));
        await setItem(OFFLINE_KEY, '1');
        await setItem(OFFLINE_AUTO_KEY, '1');
        clearProfileCache();
        set({ auth: profile, profiles: reordered, offline: true, autoOffline: true });
        return 'offline';
      }
      throw e;
    }
    await setItem(ACTIVE_KEY, JSON.stringify(profile));
    await setItem(PROFILES_KEY, JSON.stringify(reordered));
    await deleteItem(OFFLINE_KEY);
    await deleteItem(OFFLINE_AUTO_KEY);
    // Together and with nothing awaited between them, for the reason `login`
    // gives: what is cached belongs to the profile being left.
    clearProfileCache();
    set({ auth: profile, profiles: reordered, offline: false, autoOffline: false });
    // Uploads to the server whatever was pending in this profile's outbox.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require('@/api/data').flushOfflineQueue(profile);
    } catch {
      // Does not block the profile switch.
    }
    return 'online';
  },

  removeProfile: async (profile) => {
    // Signed into the one being removed: leave it first, or its music would be
    // deleted from under a session still playing it.
    if (profile._type === 'server' && sameAccount(get().auth, profile)) {
      await get().logout();
    }
    const profiles = get().profiles.filter((p) => !same(p, profile));
    await setItem(PROFILES_KEY, JSON.stringify(profiles));
    set({ profiles });
    // Its downloads and its offline library go with it. The local profile owns
    // none of that: it is the phone's own music.
    if (profile._type === 'server') await deleteProfileData(profile);
  },

  setActiveUrl: async (url) => {
    const current = get().auth;
    if (!current || current.serverUrl === url) return;
    const urls = current.urls ?? [current.serverUrl];
    if (!urls.includes(url)) return; // not a candidate URL for this profile
    const auth: SubsonicAuth = { ...current, serverUrl: url };
    await persistActive(get, set, auth, (p) => ({ ...p, serverUrl: url }));
    // Refreshes the library against the new URL. It's the same account, so we
    // don't clear the cache like when switching profiles (that would flicker); we
    // just mark everything stale so visible data is re-fetched from the active
    // server. Without this, what was cached (or failed) against the old URL would
    // stay on screen until manually refreshed. Covers both manual and automatic
    // network-triggered switches, as both go through here.
    void queryClient.invalidateQueries();
    // The current track pointed to the old URL (now unresponsive): reload it
    // against the new URL. The queue is preserved.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./player').usePlayerStore.getState().reloadCurrent();
  },

  addServerUrl: async (url) => {
    const current = get().auth;
    if (!current) return 'unreachable';
    const norm = normalizeUrl(url);
    const urls = current.urls ?? [current.serverUrl];
    if (urls.includes(norm)) return 'duplicate';
    // Must respond with current credentials: this confirms it's the same
    // server/account and not a random URL.
    if (!(await reachable(current, norm))) return 'unreachable';
    const next = [...urls, norm]; // insertion order; nothing about it is special
    // We do NOT touch `autoUrl`: automatic switching is turned on manually by
    // the user if they want it (adding a URL should not activate anything).
    const auth: SubsonicAuth = { ...current, urls: next };
    await persistActive(get, set, auth, (p) => ({ ...p, urls: next }));
    return 'ok';
  },

  editServerUrl: async (url, next) => {
    const current = get().auth;
    if (!current) return 'unreachable';
    const norm = normalizeUrl(next);
    const urls = current.urls ?? [current.serverUrl];
    if (!urls.includes(url)) return 'unreachable';
    if (norm === url) return 'ok';
    if (urls.includes(norm)) return 'duplicate';
    // Same check the address had to pass when it was added: it must answer with
    // this account, or a typo would leave the profile pointing nowhere.
    if (!(await reachable(current, norm))) return 'unreachable';
    const nextUrls = urls.map((u) => (u === url ? norm : u));
    const wasActive = current.serverUrl === url;
    const serverUrl = wasActive ? norm : current.serverUrl;
    // The name this profile is filed under is written down before the address
    // it was taken from can change, so its settings, downloads and queue are
    // still its own afterwards. Idempotent: it only ever takes the value it
    // already had.
    const scopeUrl = primaryUrl(current);
    const auth: SubsonicAuth = { ...current, urls: nextUrls, serverUrl, scopeUrl };
    await persistActive(get, set, auth, (p) => ({ ...p, urls: nextUrls, serverUrl, scopeUrl }));
    if (wasActive) {
      void queryClient.invalidateQueries();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./player').usePlayerStore.getState().reloadCurrent();
    }
    return 'ok';
  },

  removeServerUrl: async (url) => {
    const current = get().auth;
    if (!current) return;
    const urls = (current.urls ?? [current.serverUrl]).filter((u) => u !== url);
    // A profile with no address left has nowhere to go.
    if (urls.length === 0) return;
    const wasActive = current.serverUrl === url;
    const serverUrl = wasActive ? urls[0] : current.serverUrl;
    // Same as when editing: the profile keeps the name it already had, whether
    // or not the address it came from is still in the list.
    const scopeUrl = primaryUrl(current);
    const auth: SubsonicAuth = { ...current, urls, serverUrl, scopeUrl };
    await persistActive(get, set, auth, (p) => ({ ...p, urls, serverUrl, scopeUrl }));
    if (wasActive) {
      void queryClient.invalidateQueries();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./player').usePlayerStore.getState().reloadCurrent();
    }
  },

  setAutoUrl: async (value) => {
    const current = get().auth;
    if (!current) return;
    const auth: SubsonicAuth = { ...current, autoUrl: value };
    await persistActive(get, set, auth, (p) => ({ ...p, autoUrl: value }));
  },

  saveNativePassword: async (password) => {
    const current = get().auth;
    if (!current) return;
    const auth: ServerProfile = { ...current, ndPassword: password, _type: 'server' };
    const profiles = get().profiles.map((p) =>
      same(p, auth) ? auth : p,
    );
    await setItem(ACTIVE_KEY, JSON.stringify(auth));
    await setItem(PROFILES_KEY, JSON.stringify(profiles));
    set({ auth, profiles });
  },

  setCustomHeaders: async (headers) => {
    const current = get().auth;
    if (!current) return;
    const clean = Object.fromEntries(
      Object.entries(headers).filter(([name, value]) => name.trim() && value.trim()),
    );
    const { headers: _old, ...rest } = current;
    const auth: SubsonicAuth =
      Object.keys(clean).length > 0 ? { ...rest, headers: clean } : rest;
    await persistActive(get, set, auth, (p) => {
      const { headers: _previous, ...profile } = p;
      return Object.keys(clean).length > 0 ? { ...profile, headers: clean } : profile;
    });
  },

  enterOffline: async () => {
    await setItem(OFFLINE_KEY, '1');
    queryClient.clear();
    set({ offline: true });
  },

  goOffline: async (auto) => {
    // Counted, and by how it happened. Each switch snapshots the caches into
    // the mirror and then marks everything stale, so everything visible is
    // fetched again: on a large library that is not free, and a connection
    // that comes and goes would be doing it over and over without anybody
    // pressing anything. If a report shows a dozen automatic ones in three
    // minutes, that is the lag, and it has nothing to do with the screens.
    bump(auto ? 'offline · fell into' : 'offline · asked for');
    // Preserves `auth`: it's the same account, but showing/playing downloads.
    // Sends to server (scrobble, now-playing) are gated by `offline` in the
    // player. Clearing the cache makes views recalculate against the local
    // catalog.
    if (get().offline) return;
    // Before clearing cache: the two lists as last seen, and everything still
    // queued, written down. Waited for, unlike before: what browsing writes is
    // queued now, and going offline is exactly the moment none of it may still
    // be waiting.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require('@/api/data').snapshotCachesToMirror();
    } catch {
      // Does not block the offline transition.
    }
    await setItem(OFFLINE_KEY, '1');
    if (auto) await setItem(OFFLINE_AUTO_KEY, '1');
    else await deleteItem(OFFLINE_AUTO_KEY);
    // Flip first so the refetch already reads offline mode, then invalidate
    // (not `clear()`): views recalculate against the mirror, but inactive
    // cache is preserved so navigating back to a screen is instant. Clearing
    // all cache forced a massive simultaneous refetch on every transition.
    set({ offline: true, autoOffline: auto });
    void queryClient.invalidateQueries();
  },

  goOnline: async () => {
    bump('offline · came back');
    // Instant return to the same account (auth intact). Playback is not
    // touched; views recalculate against the server when cache is cleared.
    const current = get().auth;
    if (!get().offline || !current) return;
    await deleteItem(OFFLINE_KEY);
    await deleteItem(OFFLINE_AUTO_KEY);
    // See goOffline: selective invalidation instead of `clear()`, to avoid
    // discarding all cache and refetching everything at once on reconnect.
    // The mode changes BEFORE the outbox is flushed: offline mode now refuses
    // requests under the API layer (see `api/netGate`), and what the flush is
    // for is precisely to make them. Coming back online is already decided by
    // the time we are here, so nothing is lost by saying so first.
    set({ offline: false, autoOffline: false });
    // Best-effort; failed items are kept for the next reconnection.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await require('@/api/data').flushOfflineQueue(current);
    } catch {
      // Does not block the online transition.
    }
    void queryClient.invalidateQueries();
  },

  setOfflineSource: async (source) => {
    if (source) {
      await setItem(OFFLINE_SOURCE_KEY, JSON.stringify(source));
      const name = offlineLabel(source);
      const prof: OfflineProfile = { _type: 'offline', name, source };
      // If we were already on a local profile and only changed the source, we
      // need to update that profile instead of keeping the old one and
      // creating a new one.
      const prevSource = get().offlineSource;
      const profiles = [
        prof,
        ...get().profiles.filter((p) => {
          if (same(p, prof)) return false;
          if (
            p._type === 'offline' &&
            prevSource &&
            sameSource(p.source, prevSource)
          ) {
            return false;
          }
          return true;
        }),
      ];
      await setItem(PROFILES_KEY, JSON.stringify(profiles));
      clearLocalCatalog();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/localQueries').clearLocalFavs();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/localQueries').clearLocalPlaylists();
      queryClient.removeQueries({ queryKey: ['localSongs'] });
      queryClient.removeQueries({ queryKey: ['playlists'] });
      queryClient.removeQueries({ queryKey: ['starred'] });
      set({ offlineSource: source, profiles });
    } else {
      await deleteItem(OFFLINE_SOURCE_KEY);
      clearLocalCatalog();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/localQueries').clearLocalFavs();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/localQueries').clearLocalPlaylists();
      queryClient.removeQueries({ queryKey: ['localSongs'] });
      queryClient.removeQueries({ queryKey: ['playlists'] });
      queryClient.removeQueries({ queryKey: ['starred'] });
      set({ offlineSource: source });
    }
  },

  setOfflineFolders: async (uris) => {
    if (uris.length === 0) return;
    const prev = get().offlineSource;
    const source: OfflineSource = { mode: 'folder', uris };
    await setItem(OFFLINE_SOURCE_KEY, JSON.stringify(source));
    const prof: OfflineProfile = { _type: 'offline', name: offlineLabel(source), source };
    // The entry this profile already had is replaced, not left behind: dropping
    // the first folder renames it, and a stale entry would be a second profile
    // pointing at music this one still has.
    const profiles = [
      prof,
      ...get().profiles.filter((p) => {
        if (same(p, prof)) return false;
        return !(p._type === 'offline' && prev && sameSource(p.source, prev));
      }),
    ];
    await setItem(PROFILES_KEY, JSON.stringify(profiles));
    // Only the catalog. The favourites and the local playlists belong to the
    // profile and adding a folder is not leaving it.
    clearLocalCatalog();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/lib/localQueries').resetLocalLoading();
    queryClient.removeQueries({ queryKey: ['localSongs'] });
    set({ offlineSource: source, profiles });
    void queryClient.invalidateQueries();
  },

  logout: async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await require('./player').usePlayerStore.getState().reset(true);
    await deleteItem(ACTIVE_KEY);
    await deleteItem(OFFLINE_KEY);
    await deleteItem(OFFLINE_AUTO_KEY);
    await deleteItem(OFFLINE_SOURCE_KEY);
    clearLocalCatalog();
    clearProfileCache();
    set({ auth: null, offline: false, autoOffline: false, offlineSource: null });
  },
}));

/**
 * Offline mode is enforced under the API layer, not at each call site: while it
 * is on, a request fails before it reaches the network (see `api/netGate`).
 * This is the only wire between the two, and it is a subscription rather than a
 * call in each action so no path can set the mode and forget to say so.
 */
useAuthStore.subscribe((s, prev) => {
  if (s.offline !== prev.offline || s.autoOffline !== prev.autoOffline) {
    setOfflineMode(s.offline, s.autoOffline);
  }
});
