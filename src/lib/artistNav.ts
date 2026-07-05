/**
 * Resuelve a qué artista(s) puede ir una canción o álbum. Cuando hay una sola
 * opción se navega directo; con varias (colaboraciones) se abre el selector.
 */
import { type Album, type Song } from '@/api/subsonic';

export interface ArtistTarget {
  id: string;
  name: string;
}

/** Lista de artistas navegables, sin duplicados ni ids vacíos. */
export function artistTargets(item: Pick<Song | Album, 'artist' | 'artistId' | 'artists'>): ArtistTarget[] {
  const list = (item.artists ?? []).filter((a) => a.id);
  if (list.length > 0) {
    const seen = new Set<string>();
    return list.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  }
  if (item.artistId) return [{ id: item.artistId, name: item.artist ?? '' }];
  return [];
}
