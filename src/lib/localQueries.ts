/**
 * Consultas del catálogo local que replican la API Subsonic.
 * Si el catálogo aún no se ha cargado, lo carga bajo demanda.
 */
import { useAuthStore } from '@/store/auth';
import { type Album, type Artist, type ArtistInfo, type Playlist, type SearchResult, type Song, type Starred } from '@/api/subsonic';
import {
  getLocalAlbums,
  getLocalAlbumSongs,
  getLocalArtists,
  getLocalArtistAlbums,
  getLocalCatalog,
  loadDeviceSongs,
  loadFolderSongs,
  normKey,
  registerCover,
} from './localLibrary';

function sourceInfo() {
  const { offlineSource } = useAuthStore.getState();
  return {
    mode: offlineSource?.mode ?? 'device',
    key: offlineSource?.mode === 'folder' ? offlineSource.uri : undefined,
  };
}

let loadingPromise: Promise<any> | null = null;

async function ensureCatalog() {
  const { mode, key } = sourceInfo();
  const cached = getLocalCatalog(mode, key);
  if (cached) return cached;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      try {
        if (mode === 'folder' && key) {
          await loadFolderSongs(key);
        } else {
          await loadDeviceSongs();
        }
      } finally {
        loadingPromise = null;
      }
    })();
  }
  await loadingPromise;
  return getLocalCatalog(mode, key);
}

function toAlbum(local: { id: string; name: string; artist?: string; coverBase64?: string; coverMime?: string; songCount: number; year?: number }): Album {
  registerCover(local.id, local.coverBase64, local.coverMime);
  return {
    id: local.id,
    name: local.name,
    artist: local.artist,
    artistId: local.artist,
    coverArt: local.id,
    songCount: local.songCount,
    year: local.year,
  };
}

function toArtist(local: { id: string; name: string; coverBase64?: string; coverMime?: string; albumCount: number }): Artist {
  registerCover(local.id, local.coverBase64, local.coverMime);
  return {
    id: local.id,
    name: local.name,
    coverArt: local.id,
    albumCount: local.albumCount,
  };
}

export async function getAlbumList(_type: string, size = 20): Promise<Album[]> {
  const c = await ensureCatalog();
  if (!c) return [];
  return c.albums.slice(0, size).map(toAlbum);
}

export async function getAlbum(albumId: string): Promise<{ album: Album; songs: Song[] }> {
  const { mode, key } = sourceInfo();
  await ensureCatalog();
  const songs = getLocalAlbumSongs(mode, albumId, key);
  const albums = getLocalAlbums(mode, key);
  const album = albums.find((a) => a.id === albumId);
  return {
    album: album ? toAlbum(album) : { id: albumId, name: albumId, songCount: songs.length },
    songs,
  };
}

export async function getArtists(): Promise<Artist[]> {
  const c = await ensureCatalog();
  if (!c) return [];
  return c.artists.map(toArtist);
}

export async function getArtist(artistId: string): Promise<{ artist: Artist; albums: Album[] }> {
  const { mode, key } = sourceInfo();
  await ensureCatalog();
  const albums = getLocalArtistAlbums(mode, artistId, key);
  const allArtists = getLocalArtists(mode, key);
  const artist = allArtists.find((a) => a.id === artistId);
  return {
    artist: artist ? toArtist(artist) : { id: artistId, name: artistId, albumCount: albums.length },
    albums: albums.map(toAlbum),
  };
}

export function getArtistInfo(_id: string): ArtistInfo {
  return { similarArtists: [] };
}

export async function getTopSongs(artist: string, count = 10): Promise<Song[]> {
  const c = await ensureCatalog();
  if (!c) return [];
  return c.songs.filter((s) => s.artist === artist).slice(0, count);
}

export function getPlaylists(): Playlist[] {
  return [];
}

export function getStarred(): Starred {
  return { songs: [], albums: [], artists: [] };
}

export async function search(query: string): Promise<SearchResult> {
  const c = await ensureCatalog();
  if (!c) return { artists: [], albums: [], songs: [] };
  const q = query.toLowerCase();
  const songs = c.songs.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      (s.artist?.toLowerCase() ?? '').includes(q) ||
      (s.album?.toLowerCase() ?? '').includes(q),
  );
  const albumIds = new Set(songs.map((s) => normKey(s.album || 'Álbum desconocido') + '|' + normKey(s.artist || 'Artista desconocido')));
  const albums = c.albums.filter((a) => a.id && albumIds.has(a.id)).map(toAlbum);
  const artistIds = new Set(songs.map((s) => normKey(s.artist || '')));
  const artists = c.artists.filter((a) => artistIds.has(a.id)).map(toArtist);
  return { artists, albums: albums.slice(0, 20), songs: songs.slice(0, 20) };
}

export { localCoverUrl as coverUrl } from './localLibrary';
