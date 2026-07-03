/**
 * Letra de la canción actual: extensión OpenSubsonic `songLyrics` (líneas con
 * timestamp si el servidor tiene letra sincronizada) con fallback al endpoint
 * clásico por artista+título para servidores viejos (p. ej. Ampache 6).
 */
import { useQuery } from '@tanstack/react-query';

import { getLyrics, getLyricsBySongId, type Song, type SongLyrics } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';

// TEMPORAL, solo en desarrollo: letra falsa sincronizada (una línea cada 3 s)
// para probar el karaoke sin tener canciones con .lrc. Quitar tras validar.
function demoLyrics(): SongLyrics {
  const lines = [
    'Lorem ipsum dolor sit amet',
    'Consectetur adipiscing elit',
    'Sed do eiusmod tempor incididunt',
    'Ut labore et dolore magna aliqua',
    '',
    'Ut enim ad minim veniam',
    'Quis nostrud exercitation ullamco',
    'Laboris nisi ut aliquip ex ea',
    'Commodo consequat',
    '',
    'Duis aute irure dolor in reprehenderit',
    'In voluptate velit esse cillum',
    'Dolore eu fugiat nulla pariatur',
    'Excepteur sint occaecat cupidatat',
    'Non proident, sunt in culpa',
    '',
    'Qui officia deserunt mollit',
    'Anim id est laborum',
    'Sed ut perspiciatis unde omnis',
    'Iste natus error sit voluptatem',
    'Accusantium doloremque laudantium',
    '',
    'Totam rem aperiam eaque ipsa',
    'Quae ab illo inventore veritatis',
    'Et quasi architecto beatae vitae',
    'Dicta sunt explicabo',
  ];
  return { synced: true, lines: lines.map((value, i) => ({ value, start: i * 3000 })) };
}

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
      if (!plain) return __DEV__ ? demoLyrics() : null;
      return { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
    },
    enabled: !!auth && !!song && !song.url,
  });
}
