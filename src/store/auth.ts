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
import { deleteItem, getItem, setItem } from '@/lib/storage';

const ACTIVE_KEY = 'resonus.auth';
const PROFILES_KEY = 'resonus.profiles';

function same(a: SubsonicAuth, b: SubsonicAuth): boolean {
  return a.serverUrl === b.serverUrl && a.username === b.username;
}

interface AuthState {
  auth: SubsonicAuth | null;
  profiles: SubsonicAuth[];
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
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  auth: null,
  profiles: [],
  hydrating: true,

  hydrate: async () => {
    try {
      const [rawAuth, rawProfiles] = await Promise.all([
        getItem(ACTIVE_KEY),
        getItem(PROFILES_KEY),
      ]);
      set({
        auth: rawAuth ? (JSON.parse(rawAuth) as SubsonicAuth) : null,
        profiles: rawProfiles ? (JSON.parse(rawProfiles) as SubsonicAuth[]) : [],
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
    set({ auth, profiles });
  },

  switchProfile: async (profile) => {
    await setItem(ACTIVE_KEY, JSON.stringify(profile));
    set({ auth: profile });
  },

  removeProfile: async (profile) => {
    const profiles = get().profiles.filter((p) => !same(p, profile));
    await setItem(PROFILES_KEY, JSON.stringify(profiles));
    set({ profiles });
  },

  logout: async () => {
    await deleteItem(ACTIVE_KEY);
    set({ auth: null });
  },
}));
