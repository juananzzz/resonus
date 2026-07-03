/**
 * Letra de la canción actual: extensión OpenSubsonic `songLyrics` (líneas con
 * timestamp si el servidor tiene letra sincronizada) con fallback al endpoint
 * clásico por artista+título para servidores viejos (p. ej. Ampache 6).
 */
import { useQuery } from '@tanstack/react-query';

import { getLyrics, getLyricsBySongId, type Song, type SongLyrics } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';

export function useLyrics(song?: Song) {
  const auth = useAuthStore((s) => s.auth);
  return useQuery({
    queryKey: ['lyrics', song?.id],
    queryFn: async (): Promise<SongLyrics | null> => {
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
    enabled: !!auth && !!song && !song.url,
  });
}
