/**
 * Letra de la canción actual.
 *
 * - Servidor: extensión OpenSubsonic `songLyrics` (líneas con timestamp si el
 *   servidor tiene letra sincronizada) con fallback al endpoint clásico por
 *   artista+título para servidores viejos (p. ej. Ampache 6).
 * - Local/offline (canciones con `localUri`): `.lrc` junto al fichero y letra
 *   embebida USLT.
 * - En ambos modos, si el usuario activa el ajuste, LRCLIB como último recurso.
 *
 * `prefetchLyrics` calienta la query al empezar a sonar cada canción, para que
 * la tarjeta de letra aparezca al instante al abrir el player.
 */
import { useQuery } from '@tanstack/react-query';

import {
  getLyrics,
  getLyricsBySongId,
  type Song,
  type SongLyrics,
  type SubsonicAuth,
} from '@/api/backend';
import { getLocalLyrics, getOnlineLyrics } from '@/lib/localLyrics';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';

function lyricsQueryOptions(song: Song, auth: SubsonicAuth | null, onlineFallback: boolean) {
  return {
    // El toggle de LRCLIB entra en la clave: al activarlo se reintenta.
    queryKey: ['lyrics', song.id, onlineFallback] as const,
    // La letra de una canción no cambia: no re-pedirla en toda la sesión.
    staleTime: Infinity,
    queryFn: async (): Promise<SongLyrics | null> => {
      if (song.localUri) return getLocalLyrics(song, onlineFallback);
      try {
        const structured = await getLyricsBySongId(auth!, song.id);
        if (structured) return structured;
      } catch {
        // Servidor sin la extensión songLyrics: probamos el endpoint clásico.
      }
      const plain = await getLyrics(auth!, song.artist ?? '', song.title ?? '');
      if (plain) return { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
      // El servidor no tiene letra: LRCLIB si el usuario lo permite.
      if (onlineFallback) return getOnlineLyrics(song);
      return null;
    },
  };
}

/** ¿Tiene sentido pedir letra para esta canción en el estado actual? */
function canFetch(song: Song | undefined, auth: SubsonicAuth | null): song is Song {
  return !!song && !song.url && (!!song.localUri || !!auth);
}

export function useLyrics(song?: Song) {
  const auth = useAuthStore((s) => s.auth);
  const onlineFallback = useSettings((s) => s.lyricsOnlineFallback);
  const enabled = canFetch(song, auth);
  return useQuery({
    ...lyricsQueryOptions(song ?? ({ id: '' } as Song), auth, onlineFallback),
    enabled,
  });
}

/** Precarga la letra en segundo plano (al empezar a sonar la canción). */
export function prefetchLyrics(song: Song | undefined): void {
  const auth = useAuthStore.getState().auth;
  if (!canFetch(song, auth)) return;
  const onlineFallback = useSettings.getState().lyricsOnlineFallback;
  void queryClient.prefetchQuery(lyricsQueryOptions(song, auth, onlineFallback));
}
