/**
 * The card at the top of Home that picks up what is playing somewhere else:
 * another app on the computer, Resonus on another phone. It shows what the
 * server says that player is on (`getNowPlaying`) and plays it here, from
 * where it had got to.
 *
 * A player that was paused and left is usually gone from that list: servers
 * drop an entry soon after it stops being reported, and many players never
 * report a pause at all. What stays is the queue it saved on the server, which
 * says who saved it last. Playing here saves ours over it, so a queue last
 * saved by another player is one left there after the last thing played here.
 *
 * Nothing here can stop the other player: Subsonic has no remote control. So
 * the card only offers to carry on, and says where the music was.
 */
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getNowPlaying, getPlayQueue } from '@/api/backend';
import { COVER } from '@/api/data';
import { CLIENT_NAME, type NowPlayingEntry, type SavedQueue } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import Icon from '@/components/Icon';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { ownReports } from '@/lib/ownReports';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

const COVER_SIZE = 84;
/** How often Home asks while it is on screen. */
const POLL_MS = 20_000;
/** Without the playback report a server says nothing of pauses; past this an
 *  entry is taken to be a player that stopped. */
const STALE_MINUTES = 10;
/** A queue left on another player is offered for this long. */
const LEFT_DAYS = 3;
/** The saved queue is the heavy request: asked for less often. */
const QUEUE_POLL_MS = 60_000;

/**
 * What has been carried on here with "Play here", by player and song. The
 * server goes on listing it (the other player is still on that song, playing
 * or paused), so without this the card came straight back as soon as the song
 * was paused here. A different song on that player is a new offer.
 */
const taken = new Set<string>();

function offerKey(e: { playerName?: string; song: { id: string } }): string {
  return `${e.playerName ?? ''}|${e.song.id}`;
}

/** Where the card's song comes from: playing or paused there right now, or a
 *  queue left there. */
type Offer = NowPlayingEntry & { left?: boolean };

/** The queue another player left on the server, as an offer, if it is one. */
function leftQueue(saved: SavedQueue | null | undefined): Offer | null {
  if (!saved?.changedBy || saved.changedBy === CLIENT_NAME || !saved.changed) return null;
  const minutes = (Date.now() - saved.changed) / 60_000;
  if (minutes > LEFT_DAYS * 24 * 60) return null;
  const song = saved.entries.find((s) => s.id === saved.current) ?? saved.entries[0];
  if (!song || song.url) return null;
  return {
    song,
    username: '',
    minutesAgo: Math.round(minutes),
    playerName: saved.changedBy,
    state: 'paused',
    positionMs: saved.position,
    left: true,
  };
}

/**
 * The entry worth offering: this user's, not this phone's own report, and
 * playing before paused, most recent first.
 */
function pickEntry(
  entries: NowPlayingEntry[],
  username: string,
  ownSongId: string | undefined,
  ownPlaying: boolean,
): NowPlayingEntry | null {
  const candidates = entries.filter((e) => {
    if (e.username !== username || e.song.url) return false;
    if (e.state === 'stopped') return false;
    if (!e.state && e.minutesAgo > STALE_MINUTES) return false;
    // This phone's own report of the song it has loaded.
    if (e.playerName === CLIENT_NAME && e.song.id === ownSongId) return false;
    // Already carried on here.
    if (ownPlaying && e.song.id === ownSongId) return false;
    if (taken.has(offerKey(e))) return false;
    return true;
  });
  const rank = (e: NowPlayingEntry) => (e.state === 'paused' ? 1 : 0);
  candidates.sort((a, b) => rank(a) - rank(b) || a.minutesAgo - b.minutesAgo);
  return candidates[0] ?? null;
}

/** Carries on here with what the other player is on, where it had got to. */
async function playHere(entry: NowPlayingEntry, fetchedAt: number) {
  const store = usePlayerStore.getState;
  const auth = useAuthStore.getState().auth;
  const elapsed = entry.state === 'paused' ? 0 : Date.now() - fetchedAt;
  const positionSec = Math.max(0, ((entry.positionMs ?? 0) + elapsed) / 1000);
  // The whole queue when the server holds that player's and it is on this
  // song, which most players that report what they play also save.
  let restored = false;
  if (auth) {
    try {
      const saved = await getPlayQueue(auth);
      if (saved?.current === entry.song.id) restored = await store().restoreFromServer(true);
    } catch {
      // The song alone, below.
    }
  }
  if (!restored) {
    if (!(await store().playQueue([entry.song], 0, entry.playerName))) return;
  } else if (!store().isPlaying) {
    store().toggle();
  }
  if (positionSec > 1) store().seekTo(positionSec);
}

export function PlayingElsewhereCard() {
  const { songCoverUrl } = useCoverUrls();
  const { accent } = useTheme();
  const t = useT();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const ownSongId = usePlayerStore((s) => s.queue[s.index]?.id);
  const ownPlaying = usePlayerStore((s) => s.isPlaying);
  const [focused, setFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey: ['nowPlaying'],
    queryFn: async () => {
      const [entries, own] = await Promise.all([getNowPlaying(auth!), ownReports()]);
      // This phone's entry about a song it is no longer on (see `ownReports`).
      return entries.filter((e) => e.playerName !== CLIENT_NAME || !own.has(e.song.id));
    },
    enabled: !!auth && !offline && auth.serverType !== 'jellyfin',
    staleTime: POLL_MS,
    // The card is what shows this, so none of the retries a list gets.
    retry: false,
    refetchInterval: focused ? POLL_MS : false,
  });
  const live = data && auth ? pickEntry(data, auth.username, ownSongId, ownPlaying) : null;
  const serverSide = !!auth && !offline && auth.serverType !== 'jellyfin';
  // Only asked for when nothing is playing elsewhere: it is the whole queue.
  const { data: saved, dataUpdatedAt: savedAt } = useQuery({
    queryKey: ['leftQueue'],
    queryFn: () => getPlayQueue(auth!),
    // After the live list has answered, or failed to: a server without it can
    // still have a queue somebody left.
    enabled: serverSide && (!!data || isError) && !live,
    staleTime: QUEUE_POLL_MS,
    refetchInterval: focused ? QUEUE_POLL_MS : false,
  });
  // Not while something plays here: that is newer than whatever was left, and
  // the server hears so at the next save.
  const leftOffer = live || ownPlaying ? null : leftQueue(saved);
  const left = leftOffer && !taken.has(offerKey(leftOffer)) ? leftOffer : null;
  const entry: Offer | null = live ?? left;
  const fetchedAt = live ? dataUpdatedAt : savedAt;
  const cover = entry ? songCoverUrl(entry.song, COVER.card) : undefined;
  const vivid = useDominantColor(cover, true);
  const calm = useDominantColor(cover);

  if (!entry) return null;

  const player = entry.playerName || t('another device');
  const heading = entry.left
    ? t('Left on {player}', { player })
    : entry.state === 'paused'
      ? t('Paused on {player}', { player })
      : t('Playing on {player}', { player });
  const duration = entry.song.duration ?? 0;
  const progress =
    duration > 0 && entry.positionMs != null
      ? Math.min(100, Math.round((entry.positionMs / 1000 / duration) * 100))
      : 0;

  const start = async () => {
    if (busy) return;
    haptic('light');
    setBusy(true);
    try {
      await playHere(entry, fetchedAt);
      taken.add(offerKey(entry));
    } finally {
      setBusy(false);
    }
    // Asked again, so what the card shows next is the server after the switch.
    void queryClient.invalidateQueries({ queryKey: ['nowPlaying'] });
    void queryClient.invalidateQueries({ queryKey: ['leftQueue'] });
    router.push('/player');
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.85 }]}
      onPress={() => void start()}
      accessibilityRole="button"
      accessibilityLabel={`${heading}: ${entry.song.title}. ${t('Play here')}`}
    >
      <LinearGradient
        colors={[vivid, calm] as const}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <Cover uri={cover} size={COVER_SIZE} style={styles.cover} />
        <View style={styles.info}>
          <Text style={styles.heading} numberOfLines={1}>
            {heading}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {entry.song.title}
          </Text>
          {entry.song.artist ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {entry.song.artist}
            </Text>
          ) : null}
        </View>
        <Pressable
          hitSlop={8}
          disabled={busy}
          style={({ pressed }) => [
            styles.play,
            { backgroundColor: accent },
            (pressed || busy) && { transform: [{ scale: 0.94 }] },
          ]}
          onPress={() => void start()}
          accessibilityRole="button"
          accessibilityLabel={t('Play here')}
        >
          <Icon name="play" size={26} color={colors.onAccent} />
        </Pressable>
        {progress > 0 ? (
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${progress}%`, backgroundColor: colors.text }]} />
          </View>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
}

const styles = themed((colors) => ({
  wrap: { marginHorizontal: spacing.lg, marginBottom: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cover: { borderRadius: radius.sm },
  info: { flex: 1, minWidth: 0 },
  heading: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', marginTop: 2 },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  play: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: colors.surfaceHighlight,
  },
  bar: { height: 3, opacity: 0.8 },
}));
