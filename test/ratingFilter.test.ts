/** The rating filter (src/lib/ratingFilter.ts, #61). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Song } from '@/api/subsonic';
import {
  asRatingFilter,
  filterAlbumsByRating,
  filterArtistsByRating,
  filterSongsByRating,
  ratingIsUnwanted,
  rememberedRatingLookups,
  rememberAlbums,
  rememberArtists,
  clearRememberedRatings,
  songIsUnwanted,
  type RatingLookups,
} from '@/lib/ratingFilter';

const song = (id: string, extra: Partial<Song> = {}): Song => ({ id, title: id, ...extra });
const ids = (songs: Song[]) => songs.map((s) => s.id).join(' ');

const album = (id: string, userRating?: number, artistId?: string) => ({ id, name: id, userRating, artistId });
const artist = (id: string, userRating?: number) => ({ id, name: id, userRating });

function lookups(): RatingLookups {
  return {
    albums: new Map([
      ['good-album', album('good-album', 5, 'good-artist')],
      ['bad-album', album('bad-album', 2, 'good-artist')],
      ['unrated-album', album('unrated-album', undefined, 'good-artist')],
      ['zero-album', album('zero-album', 0, 'good-artist')],
      ['bad-artist-album', album('bad-artist-album', 5, 'bad-artist')],
    ]),
    artists: new Map([
      ['good-artist', artist('good-artist', 5)],
      ['bad-artist', artist('bad-artist', 1)],
      ['unrated-artist', artist('unrated-artist', undefined)],
    ]),
  };
}

describe('ratingIsUnwanted', () => {
  it('does nothing while the filter is disabled', () => {
    assert.equal(ratingIsUnwanted(1, 0), false);
    assert.equal(ratingIsUnwanted(5, 0), false);
  });

  it('filters ratings at or below the threshold', () => {
    assert.equal(ratingIsUnwanted(1, 2), true);
    assert.equal(ratingIsUnwanted(2, 2), true);
    assert.equal(ratingIsUnwanted(3, 2), false);
  });

  it('never filters unrated content: absent and 0 both mean unrated', () => {
    assert.equal(ratingIsUnwanted(undefined, 4), false);
    assert.equal(ratingIsUnwanted(0, 4), false);
  });
});

describe('asRatingFilter', () => {
  it('accepts only the offered values, and anything else means disabled', () => {
    for (const value of [0, 1, 2, 3, 4]) assert.equal(asRatingFilter(value), value);
    for (const value of [-1, 5, 2.5, '2', null, undefined, NaN]) assert.equal(asRatingFilter(value), 0);
  });
});

describe('songIsUnwanted: artist, then album, then song', () => {
  it('an unwanted artist filters every song, whatever the album and song say', () => {
    const s = song('a', {
      artistId: 'bad-artist',
      albumId: 'bad-artist-album',
      userRating: 5,
    });
    assert.equal(songIsUnwanted(s, 1, lookups()), true);
  });

  it('an unwanted album filters its songs even when the song is rated higher', () => {
    const s = song('a', { artistId: 'good-artist', albumId: 'bad-album', userRating: 5 });
    assert.equal(songIsUnwanted(s, 2, lookups()), true);
  });

  it('a wanted artist and album leave the song rating to decide', () => {
    const s = song('a', { artistId: 'good-artist', albumId: 'good-album', userRating: 1 });
    assert.equal(songIsUnwanted(s, 2, lookups()), true);
  });

  it('keeps a song above the threshold when everything is rated above it', () => {
    const s = song('a', { artistId: 'good-artist', albumId: 'good-album', userRating: 3 });
    assert.equal(songIsUnwanted(s, 2, lookups()), false);
  });

  it('treats 0 and missing ratings as unrated at every level', () => {
    const s = song('a', { artistId: 'unrated-artist', albumId: 'zero-album', userRating: undefined });
    assert.equal(songIsUnwanted(s, 4, lookups()), false);
  });

  it('falls back to the album artist when the song has no artist id', () => {
    const s = song('a', { albumId: 'bad-artist-album', userRating: 5 });
    assert.equal(songIsUnwanted(s, 2, lookups()), true);
  });
});

describe('filterSongsByRating', () => {
  it('keeps the order and drops only what is unwanted', () => {
    const songs = [
      song('kept', { artistId: 'good-artist', albumId: 'good-album', userRating: 4 }),
      song('artist', { artistId: 'bad-artist', albumId: 'bad-artist-album', userRating: 5 }),
      song('album', { artistId: 'good-artist', albumId: 'bad-album', userRating: 5 }),
      song('song', { artistId: 'good-artist', albumId: 'good-album', userRating: 1 }),
      song('unrated', { artistId: 'unrated-artist', albumId: 'unrated-album' }),
    ];
    assert.equal(ids(filterSongsByRating(songs, 2, lookups())), 'kept unrated');
  });

  it('is a no-op while disabled', () => {
    const songs = [song('a', { userRating: 1 }), song('b', { userRating: 5 })];
    assert.equal(ids(filterSongsByRating(songs, 0, lookups())), 'a b');
  });
});

describe('album and artist shelves', () => {
  it('hides albums rated at or below the threshold', () => {
    const albums = [album('one', 1), album('two', 2), album('three', 3), album('zero', 0), album('none')];
    assert.equal(filterAlbumsByRating(albums, 2).map((a) => a.id).join(' '), 'three zero none');
  });

  it('hides artists rated at or below the threshold', () => {
    const artists = [artist('one', 1), artist('two', 2), artist('five', 5), artist('none')];
    assert.equal(filterArtistsByRating(artists, 2).map((a) => a.id).join(' '), 'five none');
  });
});

describe('remembered ratings', () => {
  it('uses the album and artist ratings the last lists brought', () => {
    clearRememberedRatings();
    rememberAlbums([album('a1', 2, 'ar1')]);
    rememberArtists([artist('ar1', 5)]);
    const songs = [
      song('filtered-by-album', { albumId: 'a1', artistId: 'ar1', userRating: 5 }),
      song('untouched', { albumId: 'a2', artistId: 'ar2' }),
    ];
    assert.equal(ids(filterSongsByRating(songs, 2)), 'untouched');
    assert.equal(rememberedRatingLookups().albums?.get('a1')?.userRating, 2);
  });
});
