/**
 * Conjunto de IDs de canciones favoritas (de la lista central `getStarred`).
 * Fuente de verdad fiable para mostrar el corazón, ya que no todos los
 * endpoints de Subsonic incluyen `starred` por canción. La query se comparte
 * por clave entre todos los consumidores y se actualiza al marcar/desmarcar.
 */
import { useQuery } from '@tanstack/react-query';

import { getStarred } from '@/api/data';
import { useAuthStore } from '@/store/auth';

export function useFavoriteIds(enabled = true): Set<string> | undefined {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const { data } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: enabled && canFetch,
    select: (d) => new Set(d.songs.map((s) => s.id)),
  });
  return data;
}
