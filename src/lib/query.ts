import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min: a library changes little
      retry: 1,
    },
  },
});

/**
 * Empties the cache on the way from one profile to another.
 *
 * No query key here carries the account, so everything in the cache is an
 * answer from whoever was signed in when it was asked. Clearing it is not
 * enough on its own: a request already on its way resolves after the clearing
 * and writes the profile that was left into the cache of the one just entered,
 * which is a playlist list nobody on this account owns. So they are cancelled
 * first.
 *
 * Call it immediately before flipping the session, with nothing awaited in
 * between: both halves are synchronous, so no render can happen between them
 * and no screen can draw the wrong profile.
 */
export function clearProfileCache(): void {
  void queryClient.cancelQueries();
  queryClient.clear();
}

/**
 * The lists that show whole shows and single episodes: the browser
 * (`podcastChannels`), Home's shelf (`podcastRecentEpisodes`) and the two
 * favorite lists. A feed read changes what these hold even when the show's
 * own screen is the query doing the reading — that one answers itself, so it
 * is deliberately not touched here.
 */
export function invalidatePodcastLists(): void {
  queryClient.invalidateQueries({ queryKey: ['podcastChannels'] });
  queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] });
  queryClient.invalidateQueries({ queryKey: ['podcastFavoriteChannels'] });
  queryClient.invalidateQueries({ queryKey: ['podcastFavoriteEpisodes'] });
}

/**
 * Everything that shows a podcast: the open show screens (`['podcast', id]`)
 * and the quick grid's covers (`['podcast','covers',…]` — the prefix matches
 * them too), plus every list. Read after a show is added, removed or
 * refreshed, so no surface keeps an answer that the read just changed.
 */
export function invalidatePodcastCaches(): void {
  queryClient.invalidateQueries({ queryKey: ['podcast'] });
  invalidatePodcastLists();
}

/** The hearts and the two favorite lists, after a podcast heart goes on or off. */
export function invalidatePodcastFavorites(): void {
  queryClient.invalidateQueries({ queryKey: ['podcastFavorites'] });
  invalidatePodcastLists();
}

/**
 * The lists a section holds to what is on the phone, and their searches.
 *
 * A download finishing deliberately does not invalidate these: the store's
 *  own `invalidate` leaves the online lists alone on purpose, because sending
 *  the app off to re-fetch everything it has visible was what #50 undid. So
 *  these answers age, and they are asked again only when something wants them
 *  again — which is the ↓ of a section's sort row. Switching it off and back
 *  within the five minutes a cached answer stays fresh would otherwise serve
 *  the list the previous press kept, and the album you just downloaded is not
 *  in it.
 */
export function invalidateDownloadedLists(): void {
  queryClient.invalidateQueries({ queryKey: ['downloadedAlbums'] });
  queryClient.invalidateQueries({ queryKey: ['downloadedSongs'] });
  queryClient.invalidateQueries({ queryKey: ['downloadedArtists'] });
  queryClient.invalidateQueries({ queryKey: ['downloadedAlbumList'] });
  queryClient.invalidateQueries({ queryKey: ['searchDownloadedAlbums'] });
  queryClient.invalidateQueries({ queryKey: ['searchDownloadedSongs'] });
  // The shows list and the sheet's count under the same prefix: the shows the
  //  ↓ keeps answer from the podcast database, not the server catalog, but the
  //  press owes them the same freshness.
  queryClient.invalidateQueries({ queryKey: ['podcastDownloads'] });
}
