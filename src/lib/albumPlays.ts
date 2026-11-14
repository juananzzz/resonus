/**
 * How often an album has been played, read off the plays of its songs.
 *
 * Jellyfin keeps play counts per track only, so "Most played albums" has to
 * fold them into one figure. That figure is the album's busiest song, not the
 * sum of its songs: a thirteen-track record listened to once adds up to
 * thirteen and beats a five-track record listened to twice, which is how an
 * album tried once ended up leading the shelf (#317). Taking the maximum also
 * keeps a track the server repeats across pages from being counted twice, and
 * leaves the album of the most-played song among the albums "Most played
 * songs" is built from.
 */
export interface AlbumPlays {
  /** The busiest song's play count: what "Most played" ranks the album by. */
  count: number;
  /** The latest `LastPlayedDate` seen among its songs, if any. */
  played: string;
}

export interface SongPlay {
  albumId?: string;
  playCount?: number;
  lastPlayed?: string;
}

/** One album's plays, from a list of the plays of its songs (any order). */
export function foldAlbumPlays(songs: Iterable<SongPlay>): Map<string, AlbumPlays> {
  const stats = new Map<string, AlbumPlays>();
  for (const song of songs) {
    if (!song.albumId) continue;
    const count = song.playCount ?? 0;
    const played = song.lastPlayed ?? '';
    const prev = stats.get(song.albumId);
    stats.set(song.albumId, {
      count: Math.max(prev?.count ?? 0, count),
      played: played > (prev?.played ?? '') ? played : (prev?.played ?? ''),
    });
  }
  return stats;
}
