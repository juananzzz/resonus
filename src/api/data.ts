/**
 * Capa de datos unificada. Las pantallas usan estas funciones en lugar de
 * llamar directamente a la API Subsonic. El módulo decide automáticamente
 * si leer del servidor o del catálogo local según el modo (online/offline).
 */
import { useAuthStore } from '@/store/auth';
import * as Subsonic from './backend';
import * as Local from '@/lib/localQueries';

function isOffline() { return useAuthStore.getState().offline; }
function auth() { return useAuthStore.getState().auth!; }

export type { Album, AlbumListType, Artist, ArtistInfo, Playlist, RadioStation, SearchResult, Song, StarType, Starred, SubsonicAuth } from './subsonic';
export { normalizeUrl } from './subsonic';

export function coverArtUrl(id: string | undefined, _size?: number): string | undefined {
  if (isOffline()) return Local.coverUrl(id);
  return Subsonic.coverArtUrl(auth(), id, _size);
}

export function getAlbumList(type: Subsonic.AlbumListType = 'newest', size?: number, offset?: number): Promise<Subsonic.Album[]> {
  if (isOffline()) return Local.getAlbumList(type, size, offset);
  return Subsonic.getAlbumList(auth(), type, size, offset);
}

export function getAlbum(id: string): Promise<{ album: Subsonic.Album; songs: Subsonic.Song[] }> {
  if (isOffline()) return Local.getAlbum(id);
  return Subsonic.getAlbum(auth(), id);
}

export function getArtists(): Promise<Subsonic.Artist[]> {
  if (isOffline()) return Local.getArtists();
  return Subsonic.getArtists(auth());
}

/** Todos los álbumes locales (modo sin conexión). Solo usado offline. */
export function getAllAlbums(): Promise<Subsonic.Album[]> {
  return Local.getAllAlbums();
}

/** Vuelve a escanear el catálogo local (modo sin conexión). */
export function rescanLocal(): Promise<void> {
  return Local.rescan();
}

export function getArtist(id: string): Promise<{ artist: Subsonic.Artist; albums: Subsonic.Album[] }> {
  if (isOffline()) return Local.getArtist(id);
  return Subsonic.getArtist(auth(), id);
}

export function getArtistInfo(id: string): Promise<Subsonic.ArtistInfo> {
  if (isOffline()) return Promise.resolve(Local.getArtistInfo(id));
  return Subsonic.getArtistInfo(auth(), id);
}

export function getTopSongs(artist: string, count?: number): Promise<Subsonic.Song[]> {
  if (isOffline()) return Local.getTopSongs(artist, count);
  return Subsonic.getTopSongs(auth(), artist, count);
}

export function getPlaylists(): Promise<Subsonic.Playlist[]> {
  if (isOffline()) return Local.getPlaylists();
  return Subsonic.getPlaylists(auth());
}

export function getStarred(): Promise<Subsonic.Starred> {
  if (isOffline()) return Local.getStarred();
  return Subsonic.getStarred(auth());
}

export function star(id: string, type?: Subsonic.StarType): Promise<void> {
  if (isOffline()) return Local.starLocal(id, type);
  return Subsonic.star(auth(), id, type);
}

export function unstar(id: string, type?: Subsonic.StarType): Promise<void> {
  if (isOffline()) return Local.unstarLocal(id, type);
  return Subsonic.unstar(auth(), id, type);
}

export function search(query: string): Promise<Subsonic.SearchResult> {
  if (isOffline()) return Local.search(query);
  return Subsonic.search(auth(), query);
}

export function scrobble(id: string): Promise<void> {
  if (isOffline()) return Promise.resolve();
  return Subsonic.scrobble(auth(), id);
}

export function addToPlaylist(playlistId: string, songId: string): Promise<void> {
  if (isOffline()) return Local.addToPlaylist(playlistId, songId);
  return Subsonic.addToPlaylist(auth(), playlistId, songId);
}

/** Crea una playlist vacía y devuelve su id. */
export function createPlaylist(name: string): Promise<string> {
  if (isOffline()) return Local.createPlaylist(name);
  return Subsonic.createPlaylist(auth(), name);
}

export function deletePlaylist(id: string): Promise<void> {
  if (isOffline()) return Local.deletePlaylist(id);
  return Subsonic.deletePlaylist(auth(), id);
}

export function getPlaylist(id: string): Promise<{ playlist: Subsonic.Playlist; songs: Subsonic.Song[] }> {
  if (isOffline()) return Local.getPlaylist(id);
  return Subsonic.getPlaylist(auth(), id);
}

export function updatePlaylist(
  id: string,
  changes: { name?: string; comment?: string; public?: boolean },
): Promise<void> {
  if (isOffline()) return Local.updatePlaylist(id, changes);
  return Subsonic.updatePlaylist(auth(), id, changes);
}

export function removeFromPlaylist(id: string, index: number): Promise<void> {
  if (isOffline()) return Local.removeFromPlaylist(id, index);
  return Subsonic.removeFromPlaylist(auth(), id, index);
}
