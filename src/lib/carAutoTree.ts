/**
 * Construye el árbol de navegación de Android Auto desde la capa de datos
 * (online Subsonic u offline local, indistintamente) y resuelve qué reproducir
 * cuando el coche toca un elemento.
 *
 * El árbol es un mapa plano parentId → hijos que se empuja entero al módulo
 * nativo (`setNodes`), porque el servicio nativo no hace fetch: lee del árbol
 * cacheado. Por eso prefetcheamos las canciones de cada álbum/lista.
 *
 * Adaptado del patrón de wavio (github.com/Joel-Mercier/wavio, MIT).
 */
import * as data from '@/api/data';
import { type Album, type Artist, type Song } from '@/api/subsonic';
import { tg } from '@/i18n';
import { usePlayerStore } from '@/store/player';
import { type CarNode, type CarTree } from './carAuto';

const ROOT = 'root';
const HOME_SIZE = 15;
const CONCURRENCY = 4;

// ── Snapshot para resolver los toques sin volver a pedir datos ──────────────
const songById = new Map<string, Song>();
/** parentId → mediaIds de pista (en orden) para encolar la colección al tocar. */
const parentTracks = new Map<string, string[]>();

/** Ejecuta `fn` sobre `items` con como mucho `n` en paralelo (evita 429). */
async function mapConcurrent<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// El mediaId de pista lleva su padre embebido para saber qué colección encolar.
function trackMediaId(parentId: string, songId: string): string {
  return `track|${parentId}|${songId}`;
}

function art(id: string | undefined): string | undefined {
  return data.coverArtUrl(id, 300);
}

function songNode(s: Song, parentId: string): CarNode {
  songById.set(s.id, s);
  return {
    id: trackMediaId(parentId, s.id),
    title: s.title || tg('Unknown title'),
    subtitle: s.artist,
    artworkUrl: art(s.coverArt ?? s.albumId),
    playable: true,
  };
}

function albumNode(a: Album): CarNode {
  return {
    id: `album:${a.id}`,
    title: a.name,
    subtitle: a.artist,
    artworkUrl: art(a.coverArt ?? a.id),
    playable: false,
    contentStyle: 'list',
  };
}

function artistNode(a: Artist): CarNode {
  return {
    id: `artist:${a.id}`,
    title: a.name,
    artworkUrl: art(a.coverArt ?? a.id),
    playable: false,
    contentStyle: 'list',
  };
}

// El título se resuelve dentro de buildBrowseTree (i18n ya cargado), no aquí.
const HOME_SECTIONS: { id: string; titleKey: string; type: 'newest' | 'frequent' | 'random' }[] = [
  { id: 'home:newest', titleKey: 'Recently added', type: 'newest' },
  { id: 'home:frequent', titleKey: 'Most played', type: 'frequent' },
  { id: 'home:random', titleKey: 'Shuffle', type: 'random' },
];

export async function buildBrowseTree(): Promise<CarTree> {
  songById.clear();
  parentTracks.clear();
  const tree: Record<string, CarNode[]> = {};

  // Raíz: pestañas Inicio / Biblioteca.
  tree[ROOT] = [
    { id: 'tab:home', title: tg('Home'), playable: false, contentStyle: 'list' },
    { id: 'tab:library', title: tg('Library'), playable: false, contentStyle: 'list' },
  ];

  const albumIds = new Set<string>();

  // Inicio → secciones de álbumes.
  tree['tab:home'] = HOME_SECTIONS.map((s) => ({
    id: s.id,
    title: tg(s.titleKey),
    playable: false,
    contentStyle: 'grid',
  }));
  await Promise.all(
    HOME_SECTIONS.map(async (s) => {
      const albums = await data.getAlbumList(s.type, HOME_SIZE).catch(() => [] as Album[]);
      tree[s.id] = albums.map(albumNode);
      albums.forEach((a) => albumIds.add(a.id));
    }),
  );

  // Biblioteca → Favoritos (canciones) + Álbumes favoritos + Artistas favoritos.
  const starred = await data
    .getStarred()
    .catch(() => ({ songs: [] as Song[], albums: [] as Album[], artists: [] as Artist[] }));

  tree['tab:library'] = [
    { id: 'favorites', title: tg('Favorites'), playable: false, contentStyle: 'list' },
    { id: 'lib:albums', title: tg('Albums'), playable: false, contentStyle: 'grid' },
    { id: 'lib:artists', title: tg('Artists'), playable: false, contentStyle: 'list' },
  ];

  tree['favorites'] = starred.songs.map((s) => songNode(s, 'favorites'));
  parentTracks.set('favorites', tree['favorites'].map((n) => n.id));

  tree['lib:albums'] = starred.albums.map(albumNode);
  starred.albums.forEach((a) => albumIds.add(a.id));

  tree['lib:artists'] = starred.artists.map(artistNode);

  // Prefetch de las canciones de cada álbum (para poder navegarlas en el coche).
  await mapConcurrent(Array.from(albumIds), CONCURRENCY, async (id) => {
    try {
      const { songs } = await data.getAlbum(id);
      const parent = `album:${id}`;
      tree[parent] = songs.map((s) => songNode(s, parent));
      parentTracks.set(parent, tree[parent].map((n) => n.id));
    } catch {
      tree[`album:${id}`] = [];
    }
  });

  // Prefetch de artistas favoritos: top canciones + álbumes (y sus pistas).
  await mapConcurrent(starred.artists.map((a) => a.id), CONCURRENCY, async (id) => {
    try {
      const { artist, albums } = await data.getArtist(id);
      const top = artist.name ? await data.getTopSongs(artist.name, 10).catch(() => [] as Song[]) : [];
      const parent = `artist:${id}`;
      const children: CarNode[] = [...top.map((s) => songNode(s, parent)), ...albums.map(albumNode)];
      tree[parent] = children;
      parentTracks.set(parent, children.filter((n) => n.playable).map((n) => n.id));
      for (const a of albums) {
        const ap = `album:${a.id}`;
        if (!tree[ap]) {
          try {
            const { songs } = await data.getAlbum(a.id);
            tree[ap] = songs.map((s) => songNode(s, ap));
            parentTracks.set(ap, tree[ap].map((n) => n.id));
          } catch {
            tree[ap] = [];
          }
        }
      }
    } catch {
      tree[`artist:${id}`] = [];
    }
  });

  return { nodes: tree };
}

// ── Resolución de reproducción al tocar en el coche ─────────────────────────

function songIdFromTrackMediaId(mediaId: string): string {
  // formato: track|<parentId>|<songId>
  return mediaId.split('|').slice(2).join('|');
}

/**
 * Maneja un toque del coche: si es una pista dentro de una colección, encola la
 * colección entera empezando por la tocada; si es un álbum/lista/artista/favoritos,
 * reproduce todo.
 */
export async function handleBrowsePlay(mediaId: string, parentId?: string): Promise<void> {
  const store = usePlayerStore.getState();

  if (mediaId.startsWith('track|')) {
    const parts = mediaId.split('|');
    const parent = parts[1] || parentId;
    const songId = parts.slice(2).join('|');
    const ids = parent ? parentTracks.get(parent) : undefined;
    if (ids && ids.length > 0) {
      const songs = ids
        .map((id) => songById.get(songIdFromTrackMediaId(id)))
        .filter((s): s is Song => !!s);
      const startIndex = Math.max(0, ids.indexOf(mediaId));
      if (songs.length > 0) {
        await store.playQueue(songs, Math.min(startIndex, songs.length - 1));
        return;
      }
    }
    const single = songById.get(songId);
    if (single) await store.playQueue([single], 0);
    return;
  }

  const [prefix, ...rest] = mediaId.split(':');
  const id = rest.join(':');
  let songs: Song[] = [];
  try {
    if (prefix === 'album') songs = (await data.getAlbum(id)).songs;
    else if (prefix === 'playlist') songs = (await data.getPlaylist(id)).songs;
    else if (prefix === 'favorites') songs = (await data.getStarred()).songs;
    else if (prefix === 'artist') {
      const { artist } = await data.getArtist(id);
      songs = artist.name ? await data.getTopSongs(artist.name, 20) : [];
    }
  } catch {
    songs = [];
  }
  if (songs.length > 0) await store.playQueue(songs, 0);
}
