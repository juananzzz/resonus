/**
 * Estado de sesión con soporte de varios perfiles guardados.
 *
 * - `auth`: sesión activa.
 * - `profiles`: cuentas guardadas (token + salt cifrados) entre las que elegir.
 *
 * Cerrar sesión solo desactiva la sesión activa; los perfiles se conservan
 * para poder volver a entrar con un toque.
 */
import { create } from 'zustand';

import { makeAuth, ping, type SubsonicAuth } from '@/api/subsonic';
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

function same(a: SubsonicAuth, b: SubsonicAuth): boolean {
  return a.serverUrl === b.serverUrl && a.username === b.username;
}

interface AuthState {
  auth: SubsonicAuth | null;
  profiles: SubsonicAuth[];
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
  switchProfile: (profile: SubsonicAuth) => Promise<void>;
  removeProfile: (profile: SubsonicAuth) => Promise<void>;
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
      set({
        auth: rawAuth ? (JSON.parse(rawAuth) as SubsonicAuth) : null,
        profiles: rawProfiles ? (JSON.parse(rawProfiles) as SubsonicAuth[]) : [],
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
    const auth = await makeAuth(serverUrl, username, password, serverType);
    await ping(auth); // lanza si las credenciales o la URL no valen
    const profiles = [...get().profiles.filter((p) => !same(p, auth)), auth];
    await setItem(ACTIVE_KEY, JSON.stringify(auth));
    await setItem(PROFILES_KEY, JSON.stringify(profiles));
    await deleteItem(OFFLINE_KEY);
    queryClient.clear(); // evita mezclar datos cacheados entre cuentas
    set({ auth, profiles, offline: false });
  },

  switchProfile: async (profile) => {
    await ping(profile); // valida que el token siga siendo válido
    await setItem(ACTIVE_KEY, JSON.stringify(profile));
    queryClient.clear();
    set({ auth: profile });
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
    if (source) await setItem(OFFLINE_SOURCE_KEY, JSON.stringify(source));
    else await deleteItem(OFFLINE_SOURCE_KEY);
    queryClient.removeQueries({ queryKey: ['localSongs'] });
    set({ offlineSource: source });
  },

  logout: async () => {
    await deleteItem(ACTIVE_KEY);
    await deleteItem(OFFLINE_KEY);
    await deleteItem(OFFLINE_SOURCE_KEY);
    queryClient.clear();
    set({ auth: null, offline: false, offlineSource: null });
  },
}));
