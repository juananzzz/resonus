/**
 * Estado de sesión. Las credenciales (token + salt, nunca la contraseña en
 * claro) se guardan cifradas con expo-secure-store para no pedir login en cada
 * arranque.
 */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { makeAuth, ping, type SubsonicAuth } from '@/api/subsonic';

const STORAGE_KEY = 'resonus.auth';

interface AuthState {
  auth: SubsonicAuth | null;
  /** true mientras se rehidrata la sesión guardada al arrancar. */
  hydrating: boolean;
  login: (
    serverUrl: string,
    username: string,
    password: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  auth: null,
  hydrating: true,

  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      if (raw) set({ auth: JSON.parse(raw) as SubsonicAuth });
    } catch {
      // Si algo falla, simplemente se pedirá login de nuevo.
    } finally {
      set({ hydrating: false });
    }
  },

  login: async (serverUrl, username, password) => {
    const auth = await makeAuth(serverUrl, username, password);
    await ping(auth); // lanza si las credenciales o la URL no valen
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(auth));
    set({ auth });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    set({ auth: null });
  },
}));
