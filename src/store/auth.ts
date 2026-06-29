/**
 * Estado de sesión con soporte de varios perfiles guardados.
 *
 * - `auth`: sesión activa.
 * - `profiles`: cuentas guardadas (servidor u offline) entre las que elegir.
 *
 * Cerrar sesión solo desactiva la sesión activa; los perfiles se conservan
 * para poder volver a entrar con un toque.
 */
import { create } from 'zustand';

import { makeAuth, ping, type SubsonicAuth } from '@/api/subsonic';
import { clearLocalCatalog } from '@/lib/localLibrary';
import { queryClient } from '@/lib/query';
import { deleteItem, getItem, setItem } from '@/lib/storage';

const ACTIVE_KEY = 'resonus.auth';
const PROFILES_KEY = 'resonus.profiles';
const OFFLINE_KEY = 'resonus.offline';
const OFFLINE_SOURCE_KEY = 'resonus.offlineSource';

/** De dónde saca la música el modo sin conexión. */
export type OfflineSource =
  | { mode: 'device' }
  | { mode: 'folder'; uri: string };

export type ServerProfile = SubsonicAuth & { _type: 'server' };
export type OfflineProfile = { _type: 'offline'; name: string; source: OfflineSource };
export type Profile = ServerProfile | OfflineProfile;

function same(a: Profile, b: Profile): boolean {
  if (a._type === 'offline' && b._type === 'offline') {
    return a.name === b.name;
  }
  if (a._type === 'server' && b._type === 'server') {
    return a.serverUrl === b.serverUrl && a.username === b.username;
  }
  return false;
}

function sameSource(a: OfflineSource, b: OfflineSource): boolean {
  if (a.mode === 'folder' && b.mode === 'folder') return a.uri === b.uri;
  return a.mode === b.mode;
}

function offlineLabel(source: OfflineSource): string {
  if (source.mode === 'folder') {
    const decoded = decodeURIComponent(source.uri);
    return decoded.split(/[:/]/).filter(Boolean).pop() ?? 'Sin conexión';
  }
  return 'Sin conexión';
}

interface AuthState {
  auth: SubsonicAuth | null;
  profiles: Profile[];
  /** Sesión sin conexión: reproduce ficheros locales sin servidor. */
  offline: boolean;
  /** Origen elegido para la música local (null = aún sin elegir). */
  offlineSource: OfflineSource | null;
  /** true mientras se rehidrata la sesión guardada al arrancar. */
  hydrating: boolean;
  login: (
    serverUrl: string,
    username: string,
    password: string,
    serverType?: string,
  ) => Promise<void>;
  switchProfile: (profile: Profile) => Promise<void>;
  removeProfile: (profile: Profile) => Promise<void>;
  enterOffline: () => Promise<void>;
  setOfflineSource: (source: OfflineSource | null) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  auth: null,
  profiles: [],
  offline: false,
  offlineSource: null,
  hydrating: true,

  hydrate: async () => {
    try {
      const [rawAuth, rawProfiles, rawOffline, rawSource] = await Promise.all([
        getItem(ACTIVE_KEY),
        getItem(PROFILES_KEY),
        getItem(OFFLINE_KEY),
        getItem(OFFLINE_SOURCE_KEY),
      ]);
      const profiles: Profile[] = rawProfiles
        ? (JSON.parse(rawProfiles) as any[]).map((p: any): Profile => {
            if (p._type === 'offline') return p as OfflineProfile;
            if (p._type === 'server') return p as ServerProfile;
            // Migración de perfiles antiguos (sin _type) → server
            return { ...p, _type: 'server' } as ServerProfile;
          })
        : [];
      set({
        auth: rawAuth ? (JSON.parse(rawAuth) as SubsonicAuth) : null,
        profiles,
        offline: rawOffline === '1',
        offlineSource: rawSource ? (JSON.parse(rawSource) as OfflineSource) : null,
      });
    } catch {
      // Si algo falla, se pedirá login de nuevo.
    } finally {
      set({ hydrating: false });
    }
  },

  login: async (serverUrl, username, password, serverType) => {
    const auth: ServerProfile = {
      ...(await makeAuth(serverUrl, username, password, serverType)),
      _type: 'server',
    };
    await ping(auth);
    // El perfil recién usado va el primero (orden por último uso).
    const profiles = [auth, ...get().profiles.filter((p) => !same(p, auth))];
    await setItem(ACTIVE_KEY, JSON.stringify(auth));
    await setItem(PROFILES_KEY, JSON.stringify(profiles));
    await deleteItem(OFFLINE_KEY);
    queryClient.clear();
    set({ auth, profiles, offline: false });
  },

  switchProfile: async (profile) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await require('./player').usePlayerStore.getState().reset();
    // Mueve el perfil elegido al principio (orden por último uso).
    const reordered = [profile, ...get().profiles.filter((p) => !same(p, profile))];
    if (profile._type === 'offline') {
      await setItem(OFFLINE_KEY, '1');
      await setItem(OFFLINE_SOURCE_KEY, JSON.stringify(profile.source));
      await setItem(PROFILES_KEY, JSON.stringify(reordered));
      queryClient.clear();
      set({ auth: null, offline: true, offlineSource: profile.source, profiles: reordered });
      return;
    }
    await ping(profile);
    await setItem(ACTIVE_KEY, JSON.stringify(profile));
    await setItem(PROFILES_KEY, JSON.stringify(reordered));
    queryClient.clear();
    set({ auth: profile, profiles: reordered });
  },

  removeProfile: async (profile) => {
    const profiles = get().profiles.filter((p) => !same(p, profile));
    await setItem(PROFILES_KEY, JSON.stringify(profiles));
    set({ profiles });
  },

  enterOffline: async () => {
    await setItem(OFFLINE_KEY, '1');
    queryClient.clear();
    set({ offline: true });
  },

  setOfflineSource: async (source) => {
    if (source) {
      await setItem(OFFLINE_SOURCE_KEY, JSON.stringify(source));
      const name = offlineLabel(source);
      const prof: OfflineProfile = { _type: 'offline', name, source };
      // Si ya estábamos en un perfil local y solo cambiamos el origen, hay que
      // actualizar ese perfil en vez de dejar el viejo y crear uno nuevo.
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
      queryClient.removeQueries({ queryKey: ['localSongs'] });
      set({ offlineSource: source, profiles });
    } else {
      await deleteItem(OFFLINE_SOURCE_KEY);
      clearLocalCatalog();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/localQueries').clearLocalFavs();
      queryClient.removeQueries({ queryKey: ['localSongs'] });
      set({ offlineSource: source });
    }
  },

  logout: async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await require('./player').usePlayerStore.getState().reset();
    await deleteItem(ACTIVE_KEY);
    await deleteItem(OFFLINE_KEY);
    await deleteItem(OFFLINE_SOURCE_KEY);
    clearLocalCatalog();
    queryClient.clear();
    set({ auth: null, offline: false, offlineSource: null });
  },
}));
