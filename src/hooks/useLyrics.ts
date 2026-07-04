/**
 * Letra de la canción actual.
 *
 * - Servidor: extensión OpenSubsonic `songLyrics` (líneas con timestamp si el
 *   servidor tiene letra sincronizada) con fallback al endpoint clásico por
 *   artista+título para servidores viejos (p. ej. Ampache 6).
 * - Local/offline (canciones con `localUri`): `.lrc` junto al fichero, letra
 *   embebida USLT y, si el usuario lo activa, LRCLIB.
 */
import { useQuery } from '@tanstack/react-query';

import { getLyrics, getLyricsBySongId, type Song, type SongLyrics } from '@/api/subsonic';
import { getLocalLyrics } from '@/lib/localLyrics';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';

export function useLyrics(song?: Song) {
  const auth = useAuthStore((s) => s.auth);
  const onlineFallback = useSettings((s) => s.lyricsOnlineFallback);
  const isLocal = !!song?.localUri;
  return useQuery({
    // El toggle de LRCLIB entra en la clave: al activarlo se reintenta.
    queryKey: ['lyrics', song?.id, isLocal && onlineFallback],
    queryFn: async (): Promise<SongLyrics | null> => {
      if (isLocal) return getLocalLyrics(song!, onlineFallback);
      try {
        const structured = await getLyricsBySongId(auth!, song!.id);
        if (structured) return structured;
      } catch {
        // Servidor sin la extensión songLyrics: probamos el endpoint clásico.
      }
      const plain = await getLyrics(auth!, song?.artist ?? '', song?.title ?? '');
      if (!plain) return null;
      return { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
    },
    enabled: !!song && !song.url && (isLocal || !!auth),
  });
}
