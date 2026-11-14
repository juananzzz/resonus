/**
 * Rating filter (#61): the rules that decide whether a song is "unwanted"
 * because of its own rating, its album's, or its artist's.
 *
 * The order matters as much as the numbers: an artist rating applies to every
 * song by that artist, so rating an artist once is enough to keep all of their
 * records out, without rating two hundred tracks by hand. An album rating does
 * the same for its tracks, and only when both are fine does the song's own
 * rating get a say. Unrated (absent or 0) is never filtered: a rating of 0
 * means "not rated", not "terrible".
 *
 * Pure and dependency-free apart from types, so `test/ratingFilter.test.ts`
 * can check it without a phone or a server.
 */
import type { Album, Artist, Song } from '@/api/subsonic';

/** Off (0), or "unwanted at or below this many stars" (1-4). */
export type RatingFilter = 0 | 1 | 2 | 3 | 4;

/** The values the setting may hold. 5 is absent on purpose: filtering at 5
 *  would hide everything anybody rated, and the issue asks for 1-4. */
export const RATING_FILTER_VALUES: readonly RatingFilter[] = [0, 1, 2, 3, 4];

/** Whether a stored/serialized value is one of `RATING_FILTER_VALUES`. */
export function isRatingFilter(value: unknown): value is RatingFilter {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
}

/** Anything not offered means disabled: an old or hand-edited file cannot
 *  turn the feature on silently. */
export function asRatingFilter(value: unknown): RatingFilter {
  return isRatingFilter(value) ? value : 0;
}

/**
 * Whether one rating is unwanted at this threshold.
 *
 * Undefined and 0 are unrated, and the issue is explicit that unrated content
 * is not subject to filtering. Only ratings 1..threshold are unwanted.
 */
export function ratingIsUnwanted(
  rating: number | undefined,
  filter: RatingFilter,
): boolean {
  return filter > 0 && rating !== undefined && rating > 0 && rating <= filter;
}

/** The smallest part of an album the filter needs: its rating and artist. */
export interface RatedAlbum {
  userRating?: number;
  artistId?: string;
}

/** The smallest part of an artist the filter needs. */
export interface RatedArtist {
  userRating?: number;
}

/** Ratings the app already knows, keyed by album/artist id. */
export interface RatingLookups {
  albums?: ReadonlyMap<string, RatedAlbum>;
  artists?: ReadonlyMap<string, RatedArtist>;
}

/** The song fields the filter reads; a whole `Song` fits. */
export interface RatedSong {
  userRating?: number;
  albumId?: string;
  artistId?: string;
}

/**
 * Artist first, then album, then song. This is what makes rating an artist or
 * an album enough, instead of every track inside it.
 */
export function songIsUnwanted(
  song: RatedSong,
  filter: RatingFilter,
  lookups: RatingLookups = {},
): boolean {
  if (filter === 0) return false;
  const album = song.albumId ? lookups.albums?.get(song.albumId) : undefined;
  // Albums know their artist, which matters for songs whose own artistId the
  // server left out (some playlist responses do).
  const artistId = song.artistId ?? album?.artistId;
  const artist = artistId ? lookups.artists?.get(artistId) : undefined;
  if (ratingIsUnwanted(artist?.userRating, filter)) return true;
  if (ratingIsUnwanted(album?.userRating, filter)) return true;
  return ratingIsUnwanted(song.userRating, filter);
}

/** Keep the songs the filter allows, in the order they came. */
export function filterSongsByRating<T extends RatedSong>(
  songs: T[],
  filter: RatingFilter,
  lookups: RatingLookups = rememberedRatingLookups(),
): T[] {
  if (filter === 0) return songs;
  return songs.filter((song) => !songIsUnwanted(song, filter, lookups));
}

/** Recommendations: an album rated at or below the threshold is unwanted. */
export function filterAlbumsByRating<T extends { userRating?: number }>(
  albums: T[],
  filter: RatingFilter,
): T[] {
  if (filter === 0) return albums;
  return albums.filter((album) => !ratingIsUnwanted(album.userRating, filter));
}

/** Recommendations: an artist rated at or below the threshold is unwanted. */
export function filterArtistsByRating<T extends { userRating?: number }>(
  artists: T[],
  filter: RatingFilter,
): T[] {
  if (filter === 0) return artists;
  return artists.filter((artist) => !ratingIsUnwanted(artist.userRating, filter));
}

/**
 * What the lists the app has loaded so far know about ratings.
 *
 * A queue is built from songs alone, and those often carry a rating but not
 * the album's or the artist's. The album and artist screens have already
 * loaded those, so remembering them here gives the queue what it needs
 * without a request per song (the performance worry in #61).
 *
 * Kept per session and in memory: a rating filter is not worth a database,
 * and a stale entry is replaced the next time its list is loaded.
 */
const albumRatings = new Map<string, RatedAlbum>();
const artistRatings = new Map<string, RatedArtist>();

export function rememberAlbums(albums: Album[]): void {
  for (const album of albums) {
    albumRatings.set(album.id, { userRating: album.userRating, artistId: album.artistId });
  }
}

export function rememberArtists(artists: Artist[]): void {
  for (const artist of artists) {
    artistRatings.set(artist.id, { userRating: artist.userRating });
  }
}

/** A rating just changed (the stars on an album/artist/song screen). */
export function rememberRating(id: string, rating: number): void {
  const album = albumRatings.get(id);
  if (album) albumRatings.set(id, { ...album, userRating: rating });
  const artist = artistRatings.get(id);
  if (artist) artistRatings.set(id, { userRating: rating });
}

/** The maps to hand to `songIsUnwanted`/`filterSongsByRating`. */
export function rememberedRatingLookups(): RatingLookups {
  return { albums: albumRatings, artists: artistRatings };
}

/** Tests and profile switches: forget everything remembered. */
export function clearRememberedRatings(): void {
  albumRatings.clear();
  artistRatings.clear();
}
