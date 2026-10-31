/**
 * Animated cover clips for a song from the animated-artwork endpoint, if one
 * is set and the server knows the album. Session-cached by the fetcher, so a
 * cover seen before resolves without another request.
 */
import { useEffect, useState } from 'react';
import { useArtworkNetworkAllowed } from './useArtworkMotionAllowed';

import { useAuthStore } from '@/store/auth';
import type { Song } from '@/api/subsonic';
import {
  animatedArtworkKey,
  fetchAnimatedArtwork,
  type AnimatedArtworkUrls,
} from '@/lib/animatedArtwork';
import { activeArtworkEndpoint, useSettings } from '@/store/settings';

export function useAnimatedArtwork(song: Pick<Song, 'artist' | 'album'> | null | undefined): AnimatedArtworkUrls | null {
  const networkAllowed = useArtworkNetworkAllowed();
  const offline = useAuthStore((s) => s.offline);
  const endpoint = useSettings(activeArtworkEndpoint);
  const customs = useSettings((s) => s.animatedArtworkUrls);
  const [urls, setUrls] = useState<AnimatedArtworkUrls | null>(null);
  const customUrl = song ? customs[animatedArtworkKey(song.artist ?? '', song.album ?? '')] : undefined;
  useEffect(() => {
    let live = true;
    setUrls(null);
    if (!networkAllowed || offline || !endpoint || !song?.artist || !song?.album) return undefined;
    void fetchAnimatedArtwork(endpoint, song.artist, song.album, customUrl).then((out) => {
      if (live) setUrls(out);
    });
    return () => {
      live = false;
    };
    // Not the song id: the next track of the same album has the same clips,
    // and starting over for it flashed the still cover between them.
  }, [networkAllowed, offline, endpoint, customUrl, song?.artist, song?.album]);
  return networkAllowed ? urls : null;
}
