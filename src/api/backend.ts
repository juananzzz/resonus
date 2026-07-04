/**
 * Despacho por tipo de servidor. Expone la misma superficie que `subsonic.ts`
 * pero eligiendo implementación según el perfil activo: Jellyfin tiene API
 * propia (`jellyfin.ts`); Navidrome, OpenSubsonic y Ampache hablan Subsonic.
 *
 * Los stores y pantallas que necesitan pasar `auth` explícito importan de
 * aquí (los demás usan `data.ts`, que además resuelve el modo offline).
 */
import * as Jellyfin from './jellyfin';
import * as Subsonic from './subsonic';
import { type AlbumListType, type StarType, type SubsonicAuth } from './subsonic';

export type {
  Album,
  AlbumListType,
  Artist,
  ArtistInfo,
  Genre,
  LyricLine,
  Playlist,
  RadioStation,
  SavedQueue,
  ScanStatus,
  SearchResult,
  Song,
  SongLyrics,
  StarType,
  Starred,
  SubsonicAuth,
} from './subsonic';
export { normalizeUrl } from './subsonic';

/** Implementación que corresponde al perfil (misma firma en ambas). */
function api(auth: SubsonicAuth) {
  return auth.serverType === 'jellyfin' ? Jellyfin : Subsonic;
}

export function makeAuth(
  serverUrl: string,
  username: string,
  password: string,
  serverType?: string,
): Promise<SubsonicAuth> {
  if (serverType === 'jellyfin') return Jellyfin.makeAuth(serverUrl, username, password);
  return Subsonic.makeAuth(serverUrl, username, password, serverType);
}

export const ping = (auth: SubsonicAuth) => api(auth).ping(auth);

export const getAlbumList = (
  auth: SubsonicAuth,
  type?: AlbumListType,
  size?: number,
  offset?: number,
) => api(auth).getAlbumList(auth, type, size, offset);

export const getGenres = (auth: SubsonicAuth) => api(auth).getGenres(auth);

export const getAlbumsByGenre = (auth: SubsonicAuth, genre: string, size?: number, offset?: number) =>
  api(auth).getAlbumsByGenre(auth, genre, size, offset);

export const getAlbum = (auth: SubsonicAuth, id: string) => api(auth).getAlbum(auth, id);

export const getArtists = (auth: SubsonicAuth) => api(auth).getArtists(auth);

export const getArtist = (auth: SubsonicAuth, id: string) => api(auth).getArtist(auth, id);

export const getArtistInfo = (auth: SubsonicAuth, id: string) => api(auth).getArtistInfo(auth, id);

export const getTopSongs = (auth: SubsonicAuth, artist: string, count?: number) =>
  api(auth).getTopSongs(auth, artist, count);

export const getSimilarSongs = (auth: SubsonicAuth, id: string, count?: number) =>
  api(auth).getSimilarSongs(auth, id, count);

export const search = (auth: SubsonicAuth, query: string) => api(auth).search(auth, query);

export const getStarred = (auth: SubsonicAuth) => api(auth).getStarred(auth);

export const star = (auth: SubsonicAuth, id: string, type?: StarType) =>
  api(auth).star(auth, id, type);

export const unstar = (auth: SubsonicAuth, id: string, type?: StarType) =>
  api(auth).unstar(auth, id, type);

export const getPlaylists = (auth: SubsonicAuth) => api(auth).getPlaylists(auth);

export const getPlaylist = (auth: SubsonicAuth, id: string) => api(auth).getPlaylist(auth, id);

export const addToPlaylist = (auth: SubsonicAuth, playlistId: string, songId: string) =>
  api(auth).addToPlaylist(auth, playlistId, songId);

export const createPlaylist = (auth: SubsonicAuth, name: string) =>
  api(auth).createPlaylist(auth, name);

export const deletePlaylist = (auth: SubsonicAuth, id: string) =>
  api(auth).deletePlaylist(auth, id);

export const updatePlaylist = (
  auth: SubsonicAuth,
  id: string,
  changes: { name?: string; comment?: string; public?: boolean },
) => api(auth).updatePlaylist(auth, id, changes);

export const removeFromPlaylist = (auth: SubsonicAuth, id: string, index: number) =>
  api(auth).removeFromPlaylist(auth, id, index);

export const getScanStatus = (auth: SubsonicAuth) => api(auth).getScanStatus(auth);

export const startScan = (auth: SubsonicAuth) => api(auth).startScan(auth);

export const getLyrics = (auth: SubsonicAuth, artist: string, title: string) =>
  api(auth).getLyrics(auth, artist, title);

export const getLyricsBySongId = (auth: SubsonicAuth, id: string) =>
  api(auth).getLyricsBySongId(auth, id);

export const savePlayQueue = (
  auth: SubsonicAuth,
  ids: string[],
  currentId: string,
  positionMs: number,
) => api(auth).savePlayQueue(auth, ids, currentId, positionMs);

export const getPlayQueue = (auth: SubsonicAuth) => api(auth).getPlayQueue(auth);

export const scrobble = (auth: SubsonicAuth, id: string) => api(auth).scrobble(auth, id);

export const getRadioStations = (auth: SubsonicAuth) => api(auth).getRadioStations(auth);

export const coverArtUrl = (auth: SubsonicAuth, id: string | undefined, size?: number) =>
  api(auth).coverArtUrl(auth, id, size);

export const downloadUrl = (auth: SubsonicAuth, id: string) => api(auth).downloadUrl(auth, id);

export const streamUrl = (auth: SubsonicAuth, id: string, maxBitRate?: number) =>
  api(auth).streamUrl(auth, id, maxBitRate);
