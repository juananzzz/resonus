/**
 * One podcast and its episodes — a first-class entity, drawn by the album's
 * renderer so it behaves like an album: big cover that scrolls away, a sticky
 * bar with the name, the action row, the ⋯ menu.
 *
 * SQLite is the store, iTunes is the refresh. Opening a show reads it from
 * SQLite; if it was never opened it is read from the publisher and filed there.
 * A show whose last write is older than three days is re-read in the background
 * and the surface updated once it lands. Nothing is subscribed: opening lands it.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import {
  episodeToSong,
  getChannel,
  getStoredChannel,
  listAllEpisodes,
  refreshChannel,
  isFeedUrl,
  podcastCover,
  type PodcastChannel,
} from '@/api/podcasts';
import { COVER, coverArtUrl, markUnplayableOffline, type Song } from '@/api/data';
import { isManualOffline } from '@/api/netGate';
import { BackButton } from '@/components/BackButton';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { PodcastDownloadDialog } from '@/components/PodcastDownloadDialog';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackListView } from '@/components/TrackListView';
import { openPodcastMenu } from '@/components/PodcastMenuSheet';
import { useSongSort } from '@/hooks/useSongSort';
import { episodesLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { usePodcastPlayedIds } from '@/lib/podcastPlayed';
import { invalidatePodcastCaches } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { currentSong, usePlayerStore } from '@/store/player';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { colors, useTheme } from '@/theme';
import { useShallow } from 'zustand/react/shallow';

/** A show older than this is quietly re-read from the publisher on opening. */
const STALE_MS = 1000 * 60 * 60 * 72;

export default function PodcastScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const hideUnavailable = useSettings((s) => s.hideUnavailableOffline);
  const showDescription = useSettings((s) => s.showPlaylistDescription);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playingId = usePlayerStore((s) => currentSong(s)?.id);

  // SQLite first. A show never opened is read from the publisher and filed; a
  // show written more than three days ago is served from SQLite now and re-read
  // in the background, which invalidates this query once the new data lands.
  const data = useQuery({
    queryKey: ['podcast', id],
    queryFn: async () => {
      let ch: PodcastChannel | undefined;
      let feedUrl: string | undefined;
      if (isFeedUrl(id)) {
        feedUrl = decodeURIComponent(id);
        ch = await getStoredChannel(feedUrl);
        if (!ch) ch = await refreshChannel(feedUrl);
      } else {
        ch = await getChannel(id);
        feedUrl = ch?.feedUrl;
      }
      if (!ch) return null;
      // Automatic offline (the server not answering) leaves the publisher
      // reachable; only a manual "use no network" stops this background re-read.
      if (!isManualOffline() && feedUrl && Date.now() - (ch.refreshedAt ?? 0) > STALE_MS) {
        void refreshChannel(feedUrl)
          .then(() => invalidatePodcastCaches())
          .catch(() => {});
      }
      const episodes = await listAllEpisodes(ch.id);
      return { channel: ch, episodes };
    },
    enabled: !!id,
    staleTime: Infinity,
  });

  // The hearts, so the favorite pill can show whether this show is hearted.
  const favSet = usePodcastFavoriteIds();
  const playedIds = usePodcastPlayedIds(data.data?.channel.id);

  // The show's download, read the way an album's is: the same `files` map the
  // player uses, keyed by episode id, so "done" means every episode is on disk.
  // Only episodes that have an enclosure can go on disk: a publisher that
  // lists an item without a file would keep "done" out of reach forever, and
  // the pill would turn into another whole-show download on every tap.
  const episodeIds = data.data?.episodes.filter((e) => e.url).map((e) => e.id) ?? [];
  const download = useDownloads(
    useShallow((s) => groupDownloadState(s, `podcast:${data.data?.channel?.id ?? id}`, episodeIds)),
  );
  const [confirming, setConfirming] = useState<PodcastChannel | null>(null);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deletePodcastChannelDownloads = useDownloads(
    (s) => s.deletePodcastChannelDownloads,
  );

  // The episodes, bridged to songs so the album renderer can list and play
  // them, and marked like the offline song lists: offline, only a downloaded
  // episode stays playable (dim rows, and `playQueue` drops the rest); hide
  // mode drops the unplayable rows altogether, as `annotate` does for songs.
  // Memoized on the query's answer: TrackListView memoizes its own filtering
  // on the list's identity, and a fresh array every render would bust both.
  const { songs, meta, episodeInfo } = useMemo(() => {
    if (!data.data) return { songs: [] as Song[], meta: '', episodeInfo: undefined };
    const { channel, episodes: list } = data.data;
    const marked = markUnplayableOffline(list.map((e) => episodeToSong(e, channel)));
    const shown = hideUnavailable ? marked.filter((s) => !s.unavailable) : marked;
    const totalSec = list.reduce((acc, e) => acc + (e.duration ?? 0), 0);
    const line = [
      t('Podcast'),
      episodesLabel(channel.episodeCount ?? list.length, lang),
      totalSec > 0 ? formatTotalDuration(totalSec) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    // What each episode row shows under its title: the show notes, the publish
    // date, and whether the episode came over with the show's last sync that
    // landed something — the mark a row wears, read from the device's own
    // first sighting rather than from the date. Built here from the episodes the
    // screen already holds, so the row never has to ask per row, and its
    // identity is stable across repaints (the row's memo keys on it).
    const since = channel.newSinceAt;
    const info = new Map<string, { description?: string; publishedAt?: number; fresh: boolean; played: boolean }>(
      list.map((e) => [
        e.id,
        {
          description: e.description,
          publishedAt: e.publishedAt,
          fresh: since !== undefined && (e.firstSeenAt ?? 0) >= since,
          played: playedIds.has(e.id),
        },
      ]),
    );
    return { songs: shown, meta: line, episodeInfo: info };
  }, [data.data, hideUnavailable, playedIds, lang]);

  // The feed comes newest first; 'added' is that list turned round. Kept per
  // show: a course is listened to from the start, a news show from the top.
  const { songs: sorted, openSort, sortSheet } = useSongSort(
    songs,
    `podcast:${data.data?.channel.id ?? id}`,
    {
      fields: ['recent', 'added', 'alpha'],
      labels: { recent: 'Newest first', added: 'Oldest first' },
      noDirection: true,
    },
  );

  // Stable between progress ticks (only changes with status): if its identity
  // changed on every % update, the Pressable would lose its touch and you'd
  // have to press multiple times — the album screen answers the same way.
  const onDownloadPress = useCallback(() => {
    const ch = data.data?.channel;
    if (!ch) return;
    if (download.status === 'done') void deletePodcastChannelDownloads(ch.id);
    else if (download.status === 'active') cancelDownload(`podcast:${ch.id}`);
    else setConfirming(ch);
  }, [download.status, data.data]);

  if (data.isLoading) {
    return <TrackListSkeleton />;
  }

  if (data.isError || !data.data) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <BackButton />
        <Message text={t("Couldn't load this podcast.")} onRetry={() => data.refetch()} />
      </View>
    );
  }

  const ch = data.data.channel;

  // The play button hands the show over in the order it is shown; the
  // shuffle button asks for the same list dealt (`shuffled`), which playQueue
  // honors without turning the shuffle mode on.
  const play = (start: number, opts?: { shuffled?: boolean }) => {
    // The show's own id, never the route param: opened straight from a feed
    // that param is an address with slashes, and a route id with slashes is
    // one no `Link` can come back to — the Home tile would be dead.
    void playQueue(sorted, start, ch.title, `/podcast/${ch.id}`, opts);
  };

  return (
    <>
      <TrackListView
        title={ch.title}
        subtitle={ch.author}
        description={showDescription ? ch.description : undefined}
        meta={meta}
        coverUri={coverArtUrl(podcastCover(ch), COVER.card)}
        // Deliberately not `numbered`: an episode's place in the list is not
        // something a show promises (a feed can add, drop or re-date items), and
        // a number is either the row's place, which is a lie, or the feed's own,
        // which most feeds get wrong or leave out altogether. What orders the
        // rows is the publish date the row already prints under its title.
        songs={sorted}
        currentId={playingId}
        // The heart marks the show as a favorite — the user's own heart, kept on
        // the device (SQLite), which is what puts it in the Library's shelf.
        favorite={{ id: ch.id, type: 'song', starred: favSet.has(ch.id), podcast: true }}
        // The episodes' hearts read from the same SQLite favorites.
        podcastFavIds={favSet}
        // The show notes and publish date each episode row shows under its title
        // (the row drops the show's name, which is already this screen's title).
        episodeInfo={episodeInfo}
        // The download button sits in the album's action row, exactly as an
        // album wires it: tapping downloads every episode of the show, tapping
        // again removes them, and while it runs a stop cancels it. Hidden only
        // when offline was asked for: automatic offline (server down) leaves
        // the publishers reachable, and a podcast download never asks the server.
        download={
          !isManualOffline()
            ? {
                ...download,
                onPress: onDownloadPress,
              }
            : undefined
        }
        // The ⋯ opens the show's own sheet (store-driven, mounted globally).
        onMenu={() => openPodcastMenu(ch)}
        onSort={sorted.length > 1 ? openSort : undefined}
        emptyState={
          <EmptyState icon="headset-outline" title={t('No episodes')} />
        }
        onPlay={play}
      />
      {sortSheet}
      <PodcastDownloadDialog channel={confirming} onClose={() => setConfirming(null)} />
    </>
  );
}
