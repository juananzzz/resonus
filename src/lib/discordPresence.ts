/**
 * What is playing, on the user's Discord profile (native module
 * `DiscordPresence`, Android only). It talks to the Discord app on the phone,
 * so nothing here holds an account or a token; off by default.
 *
 * The cover never goes out as a server address with credentials in it: the
 * server's public link when it has one and Discord can reach it, otherwise the
 * album's artwork in the iTunes catalogue, otherwise none (Discord shows the
 * app's icon).
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { getPublicAlbumArt } from '@/api/backend';
import { isManualOffline } from '@/api/netGate';
import type { Song } from '@/api/subsonic';
import { isLanUrl } from '@/lib/serverUrls';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';

/** The Resonus application in Discord's developer portal: its name and icon. */
const DISCORD_APP_ID = '';

/** A position this far off what was sent is a seek, worth sending again. */
const SEEK_SLACK_MS = 3000;

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<{
        isInstalled: () => boolean;
        setActivity: (appId: string, activity: Record<string, unknown>) => void;
        clear: () => void;
      }>('DiscordPresence')
    : null;

/** Whether this build has the switch: Android, with the native module. */
export function discordPresenceSupported(): boolean {
  return !!native;
}

export function discordInstalled(): boolean {
  try {
    return !!native?.isInstalled();
  } catch {
    return false;
  }
}

/** Reachable from Discord's side: not a home network, not a tailnet. */
function isPublicUrl(url: string): boolean {
  if (isLanUrl(url)) return false;
  const host = /^https?:\/\/([^/:?#]+)/i.exec(url)?.[1]?.toLowerCase();
  if (!host || !host.includes('.')) return false;
  if (host.endsWith('.ts.net')) return false;
  return !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
}

/** The server's link, moved onto an address of the same server Discord can reach. */
function publicServerArt(found: string): string | undefined {
  if (isPublicUrl(found)) return found;
  const a = useAuthStore.getState().auth;
  const base = (a?.urls ?? (a ? [a.serverUrl] : [])).find(isPublicUrl);
  if (!base) return undefined;
  const origin = /^https?:\/\/[^/]+/i.exec(base)?.[0];
  return origin ? found.replace(/^https?:\/\/[^/]+/i, origin) : undefined;
}

async function itunesArt(song: Song): Promise<string | undefined> {
  const term = [song.artist, song.album].filter(Boolean).join(' ');
  if (!term) return undefined;
  const res = await fetch(
    `https://itunes.apple.com/search?entity=album&limit=1&term=${encodeURIComponent(term)}`,
  );
  if (!res.ok) return undefined;
  const json = (await res.json()) as { results?: { artworkUrl100?: string }[] };
  return json.results?.[0]?.artworkUrl100?.replace('100x100bb', '512x512bb');
}

const artCache = new Map<string, string | null>();

async function coverFor(song: Song): Promise<string | undefined> {
  // A podcast's picture is the publisher's own, public already.
  if (song.coverArt && /^https:\/\//i.test(song.coverArt)) return song.coverArt;
  const key = song.albumId ?? `${song.artist ?? ''}|${song.album ?? ''}`;
  const cached = artCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  if (isManualOffline()) return undefined;
  let url: string | undefined;
  const a = useAuthStore.getState().auth;
  if (a && song.albumId && !song.podcastChannelId) {
    const found = await getPublicAlbumArt(a, song.albumId).catch(() => undefined);
    url = found ? publicServerArt(found) : undefined;
  }
  if (!url && !song.podcastChannelId) url = await itunesArt(song).catch(() => undefined);
  artCache.set(key, url ?? null);
  return url;
}

/**
 * Follows the player until the returned function is called. Sends on a new
 * song, on play and pause, and on a seek; the position ticking on is not news.
 */
export function startDiscordPresence(): () => void {
  if (!discordPresenceSupported() || !DISCORD_APP_ID) return () => {};
  let sentKey: string | null = null;
  let sentStart = 0;
  let seq = 0;

  const update = () => {
    const st = usePlayerStore.getState();
    const song = currentSong(st);
    if (!song || !st.isPlaying) {
      if (sentKey !== null) {
        sentKey = null;
        seq++;
        native?.clear();
      }
      return;
    }
    const speed = st.speed || 1;
    const start = Date.now() - (st.positionSec * 1000) / speed;
    if (sentKey === song.id && Math.abs(start - sentStart) < SEEK_SLACK_MS) return;
    sentKey = song.id;
    sentStart = start;
    const mine = ++seq;
    const durationSec = st.durationSec || song.duration || 0;
    // Live radio has no end, and a sped-up track ends sooner than it says.
    const timed = durationSec > 0 && !(song.url && !song.vod);
    void coverFor(song).then((image) => {
      if (mine !== seq) return;
      native?.setActivity(DISCORD_APP_ID, {
        title: song.title,
        artist: song.artist,
        album: song.album,
        image,
        ...(timed ? { start: Math.round(start), end: Math.round(start + (durationSec * 1000) / speed) } : {}),
      });
    });
  };

  update();
  const unsubscribe = usePlayerStore.subscribe(update);
  return () => {
    unsubscribe();
    seq++;
    if (sentKey !== null) native?.clear();
  };
}
