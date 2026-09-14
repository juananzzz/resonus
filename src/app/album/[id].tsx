/** Album detail with its songs. */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { COVER, coverArtUrl, getAlbum } from '@/api/data';
import { type Album, type Song } from '@/api/subsonic';
import { BackButton } from '@/components/BackButton';
import { CoverViewer } from '@/components/CoverViewer';
import { Dialog } from '@/components/Dialog';
import { Message } from '@/components/Message';
import { MoreFromArtist } from '@/components/MoreFromArtist';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackListView } from '@/components/TrackListView';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { songsLabel, useT } from '@/i18n';
import { formatDuration, formatTotalDuration } from '@/lib/format';
import {
  isAudiobookAlbum,
  isAudiobookSong,
  useAlbumProgress,
  useAlbumProgressByAlbum,
} from '@/store/albumProgress';
import { useAuthStore } from '@/store/auth';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { useMediaMenu } from '@/store/mediaMenu';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, useTheme } from '@/theme';

/**
 * Disc headers by song index (multi-disc albums). Labels each disc with its
 * title (`discTitles`) or "Disc N" as fallback, on the first track of each
 * disc. Only if 2+ discs, or a single one with an explicit title (mimics
 * Navidrome).
 *
 * `discNumber` is optional in Subsonic and many albums don't include it (track
 * numbers reset by the `track` tag, not `discnumber`). Hence: if `discNumber`
 * distinguishes discs, it's used; otherwise cuts are inferred by the track
 * number reset (a track with a lower `track` than the previous one opens a new
 * disc). Inferred discs are numbered 1, 2, 3… which usually matches
 * `discTitles` if the album has them.
 */
function discHeadersFor(
  songs: Song[],
  discTitles: { disc: number; title: string }[] | undefined,
  enabled: boolean,
  fallbackLabel: (disc: number) => string,
): Record<number, string> | undefined {
  if (!enabled || songs.length === 0) return undefined;
  // Navidrome sends `discTitles` with `title: ""` when the disc has no real
  // subtitle; treat empty as absent to fall through to "Disc N".
  const titleOf = (disc: number) => {
    const title = discTitles?.find((d) => d.disc === disc)?.title?.trim();
    return title ? title : undefined;
  };

  const firstIndex = new Map<number, number>();
  const variedDisc = new Set(songs.map((s) => s.discNumber ?? 1)).size >= 2;
  if (variedDisc) {
    songs.forEach((s, i) => {
      const disc = s.discNumber ?? 1;
      if (!firstIndex.has(disc)) firstIndex.set(disc, i);
    });
  } else {
    // Without useful discNumber: each track number reset opens a new disc.
    let disc = 1;
    let prevTrack = -Infinity;
    songs.forEach((s, i) => {
      const track = s.track;
      if (i > 0 && track != null && track > 0 && track < prevTrack) disc += 1;
      if (!firstIndex.has(disc)) firstIndex.set(disc, i);
      if (track != null && track > 0) prevTrack = track;
    });
  }

  const discs = [...firstIndex.keys()];
  const singleTitled = discs.length === 1 && titleOf(discs[0]) != null;
  if (discs.length < 2 && !singleTitled) return undefined;
  const headers: Record<number, string> = {};
  for (const disc of discs) headers[firstIndex.get(disc)!] = titleOf(disc) ?? fallbackLabel(disc);
  return headers;
}

/**
 * Genres of the album: the server's list when it sends one (OpenSubsonic
 * `genres`, or the single Subsonic `genre`), and otherwise gathered from the
 * songs, which is where the tags really live — an album can perfectly well
 * carry two genres across its tracks.
 *
 * Deduped ignoring case and trimmed, so "Rock" on one track and "rock " on
 * another are one chip.
 *
 * The cap is only there so a library with a tag per track can't put a
 * thousand chips in a header that doesn't virtualize them: the row scrolls
 * sideways, so nothing below it moves however many there are, and whoever
 * tagged a record with a dozen genres meant all twelve (#104). Six of them,
 * which is what this used to show, is a number small enough to be reached by
 * accident.
 */
const MAX_GENRES = 50;

function albumGenres(album: Album, songs: Song[]): string[] {
  const raw = [
    ...(album.genres ?? []).map((g) => g.name),
    ...(album.genre ? [album.genre] : []),
    // Every genre of each track, not just the first: `genre` is the single one
    // plain Subsonic has room for, and a track tagged "Rock; Pop" only ever
    // handed over "Rock" through it.
    ...songs.flatMap((s) => [...(s.genres ?? []).map((g) => g.name), s.genre ?? '']),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    const clean = name.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
    if (out.length === MAX_GENRES) break;
  }
  return out;
}

export default function AlbumScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showArtistPhoto = useSettings((s) => s.showArtistPhoto);
  const showDiscHeaders = useSettings((s) => s.showDiscHeaders);
  const showGenreChips = useSettings((s) => s.showGenreChips);
  const saveAudiobookProgress = useSettings((s) => s.saveAudiobookProgress);
  const audiobookContinueRewindSec = useSettings((s) => s.audiobookContinueRewindSec);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const openMediaMenu = useMediaMenu((s) => s.open);
  const toast = useToast((s) => s.show);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  // Songs selected in selection mode pending "add to playlist".
  const [addingSongs, setAddingSongs] = useState<Song[] | null>(null);
  // The heart reads from the central favorites list (refreshes on starring);
  // `data.album.starred` from the detail becomes stale after star/unstar.
  const favAlbumIds = useFavoriteIds(canFetch, 'album');

  const { data: fresh, isLoading, isError, refetch } = useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(id),
    enabled: canFetch && !!id,
  });

  // The album ceased to exist while you were looking at it: locally albums are
  // derived from their songs, so removing the last download deletes the entire
  // album. Without this the screen would stay with a made-up header, 0 songs
  // and a play button that did nothing. Exiting is what the playlist screen
  // already does when you delete from within, and here it doesn't feel random
  // either: you just destroyed it yourself.
  // Local only: with server, removing a download doesn't delete anything.
  const vanished = offline && !!fresh && fresh.songs.length === 0;
  useEffect(() => {
    if (vanished && router.canGoBack()) router.back();
  }, [vanished, router]);

  // While it's leaving, we keep painting the last good data. `router.back()` is
  // not instant (animates ~300 ms) and the effect runs after painting, so the
  // screen stays mounted for a bit with the album already deleted: without this
  // "Unknown album" and 0 songs would flash before going away. Freezing it, the
  // screen simply slides out as it was.
  const lastGood = useRef(fresh);
  if (fresh && fresh.songs.length > 0) lastGood.current = fresh;
  const data = vanished ? (lastGood.current ?? fresh) : fresh;

  const discHeaders = useMemo(
    () =>
      discHeadersFor(data?.songs ?? [], data?.album.discTitles, showDiscHeaders, (n) =>
        t('Disc {n}', { n }),
      ),
    [data?.songs, data?.album.discTitles, showDiscHeaders, t],
  );

  const songIds = data?.songs.map((s) => s.id) ?? [];
  const downloadMsg = useDownloadMessage(data?.songs ?? []);
  const download = useDownloads(useShallow((s) => groupDownloadState(s, `album:${id}`, songIds)));
  const downloadAlbum = useDownloads((s) => s.downloadAlbum);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  const progressByAlbum = useAlbumProgressByAlbum(auth, offline);
  // Stable between progress ticks (only changes with status): if its identity
  // changed on every % update, the Pressable would lose its touch and you'd
  // have to press multiple times.
  const onDownloadPress = useCallback(() => {
    if (download.status === 'none') setConfirmDownload(true);
    else if (download.status === 'done') setConfirmDelete(true);
    else if (download.status === 'active') setConfirmStop(true);
  }, [download.status]);

  if (isLoading) {
    return <TrackListSkeleton />;
  }

  if (isError || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <BackButton />
        <Message text={t("Couldn't load the album.")} onRetry={() => refetch()} />
      </View>
    );
  }

  const labels = (data.album.recordLabels ?? []).map((l) => l.name).filter(Boolean);
  const labelText = labels.length
    ? `℗ ${data.album.year ? `${data.album.year} ` : ''}${labels.join(' · ')}`
    : null;

  // The album's own release type decides, and its songs only get a say where
  // nobody tagged the record, where they have to agree unanimously: one track
  // with a spoken-word genre does not turn an album into an audiobook.
  const audiobook =
    saveAudiobookProgress &&
    (isAudiobookAlbum(data.album) ||
      (data.songs.length > 0 && data.songs.every((s) => isAudiobookSong(s))));
  const albumProgress = audiobook ? progressByAlbum[data.album.id] : undefined;
  const resumeIndex = albumProgress ? data.songs.findIndex((s) => s.id === albumProgress.trackId) : -1;
  // Back through the book by however long the setting says, chapters and all.
  // It used to stop at the start of the track, which was right while the most
  // it could walk was thirty seconds and is wrong now that it can be an hour:
  // a book split into ten-minute chapters would have quietly rewound ten
  // minutes and left somebody who fell asleep with the timer on to find their
  // own way back. A chapter of unknown length stops the walk, since stepping
  // over one nobody has a duration for would land anywhere.
  const continueStart = (() => {
    if (resumeIndex < 0 || !albumProgress) return null;
    let index = resumeIndex;
    let positionSec = Math.round(albumProgress.positionSec) - audiobookContinueRewindSec;
    while (positionSec < 0 && index > 0) {
      const previous = data.songs[index - 1].duration;
      if (!previous) break;
      index -= 1;
      positionSec += Math.round(previous);
    }
    return { index, positionSec: Math.max(0, positionSec) };
  })();
  const continueFeatureVisible = audiobook && continueStart != null;

  const playAlbum = async (
    startIndex: number,
    startPositionSec = 0,
    opts?: { shuffled?: boolean },
    rememberStartProgress = false,
  ) => {
    try {
      const ok = await playQueue(data.songs, startIndex, data.album.name, `/album/${id}`, opts);
      if (!ok) return;
      if (rememberStartProgress) {
        const song = data.songs[startIndex];
        if (song) {
          useAlbumProgress
            .getState()
            .remember(auth, offline, data.album.id, song.id, startPositionSec);
        }
      }
      if (startPositionSec > 0) usePlayerStore.getState().seekTo(startPositionSec);
    } catch {
      // playQueue already shows a failure toast when it can; keep the UI alive.
    }
  };

  function runContinue(start: { index: number; positionSec: number } | null) {
    if (!start) {
      toast(t('No saved audiobook progress yet.'));
      return;
    }
    void playAlbum(start.index, start.positionSec, undefined, true);
  }

  function openAlbumMenu() {
    if (!data) return;
    openMediaMenu({ kind: 'album', album: data.album });
  }

  // "Chapter 12 · 1:04:20": where the row is about to drop you, said before
  // you press it rather than after. The chapter it names is the one the rewind
  // lands in, which with an hour of it is not always the one you stopped in.
  const resumeSong = continueStart ? data.songs[continueStart.index] : undefined;
  const resumeDetail =
    resumeSong && continueStart
      ? [resumeSong.title, formatDuration(continueStart.positionSec)].filter(Boolean).join(' · ')
      : undefined;

  // What the server says about the album first (OpenSubsonic sends the full
  // list); otherwise gathered from its songs, which is where the tags actually
  // live and works on any server. Deduped case-insensitively so "Rock" and
  // "rock" on different tracks don't both show up.
  const genres = showGenreChips ? albumGenres(data.album, data.songs) : [];

  // The album's own advisory when the server sends one (Navidrome 0.54+), and
  // otherwise whatever its tracks say: an older server, or a profile with no
  // server at all, still has the tag on the files themselves, and one explicit
  // track is what makes a record explicit everywhere else too.
  const explicit =
    data.album.explicitStatus === 'explicit' ||
    data.songs.some((s) => s.explicitStatus === 'explicit');

  const totalSec = data.songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const metaParts = [t(audiobook ? 'Audiobook' : 'Album')];
  if (data.album.year) metaParts.push(String(data.album.year));
  metaParts.push(songsLabel(data.songs.length, lang));
  if (totalSec > 0) metaParts.push(formatTotalDuration(totalSec));

  return (
    <>
      <TrackListView
        title={data.album.name}
        subtitle={data.album.artist}
        artistId={data.album.artistId}
        artists={data.album.artists}
        artistImageUri={
          showArtistPhoto && data.album.artistId
            ? coverArtUrl(data.album.artistId, COVER.thumb)
            : undefined
        }
        meta={metaParts.join(' · ')}
        explicit={explicit}
        genres={genres}
        coverUri={coverArtUrl(data.album.coverArt ?? data.album.id, COVER.card)}
        onCoverPress={() => setCoverOpen(true)}
        // Same sheet as the long-press on cards: play, queue, download,
        // favorite and pin, without duplicating the menu.
        onMenu={openAlbumMenu}
        songs={data.songs}
        currentId={playing?.id}
        numbered
        discHeaders={discHeaders}
        favorite={{
          id: data.album.id,
          type: 'album',
          starred: favAlbumIds ? favAlbumIds.has(data.album.id) : !!data.album.starred,
        }}
        download={!offline ? { ...download, onPress: onDownloadPress } : undefined}
        resumeAction={
          continueFeatureVisible
            ? {
                label: t('Continue playing'),
                detail: resumeDetail,
                onPress: () => runContinue(continueStart),
              }
            : undefined
        }
        footer={
          data.album.artistId || labelText ? (
            <>
              {data.album.artistId ? (
                <MoreFromArtist
                  artistId={data.album.artistId}
                  artistName={data.album.artist ?? ''}
                  currentAlbumId={data.album.id}
                />
              ) : null}
              {labelText ? (
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: fontSize.xs,
                    marginTop: spacing.lg,
                  }}
                >
                  {labelText}
                </Text>
              ) : null}
            </>
          ) : undefined
        }
        // No "Remove": an album's songs can't be taken out of it.
        selection={{
          onAddTo: (sel) => setAddingSongs(sel),
          onDownload: !offline
            ? (sel) => {
                void downloadSongs(sel);
                toast(t('Downloading…'));
              }
            : undefined,
        }}
        onPlay={(start, opts) => playAlbum(start, 0, opts)}
      />
      <PlaylistPickerSheet songs={addingSongs} onClose={() => setAddingSongs(null)} />
      <CoverViewer
        visible={coverOpen}
        uri={coverArtUrl(data.album.coverArt ?? data.album.id, COVER.full)}
        onClose={() => setCoverOpen(false)}
      />
      <Dialog
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: data.album.name })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void downloadAlbum(data.album, data.songs);
        }}
      />
      <Dialog
        visible={confirmDelete}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: data.album.name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteSongs(songIds);
        }}
      />
      <Dialog
        visible={confirmStop}
        title={t('Stop download?')}
        message={t('Songs already downloaded will be kept.')}
        confirmLabel={t('Stop')}
        destructive
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          cancelDownload(`album:${id}`);
        }}
      />
    </>
  );
}
