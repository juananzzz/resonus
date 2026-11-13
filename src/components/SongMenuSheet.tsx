/** Bottom sheet with actions for a song (⋯ menu). */
import Icon from '@/components/Icon';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { GestureDetector } from 'react-native-gesture-handler';

import { Grabber, SheetModal } from '@/components/SheetModal';
import { useScreenSize } from '@/hooks/useScreenSize';
import { usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { usePodcastPlayedIds } from '@/lib/podcastPlayed';
import {
  canGoIntoPlaylist,
  songCoverUrl,
  removeFromPlaylist,
  reorderPlaylist,
  star,
  unstar,
  type Song,
  COVER,
} from '@/api/data';
import { useCanShare } from '@/hooks/useCanShare';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { applyStarChange, resyncFavorites } from '@/lib/favoritesCache';
import { heartedSong, setEpisodePlayed, togglePodcastHeart } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { artistTargets } from '@/lib/artistNav';
import { pushOrReplace } from '@/lib/pushOrReplace';
import { exportToFolder, shareSongFile } from '@/lib/exportSong';
import { useSharePicker } from '@/store/sharePicker';
import { normKey, pickFolder } from '@/lib/localLibrary';
import { useArtistPicker } from '@/store/artistPicker';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { useDownloads } from '@/store/downloads';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { usePlayerStore } from '@/store/player';
import { useSongInfo } from '@/store/songInfo';
import { useSongMenu } from '@/store/songMenu';
import { showUndoToast, useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';
import { StarRating } from './StarRating';

/** Height of one action row: its vertical padding plus the icon, the tallest
 *  thing in it (`styles.action`). */
const ACTION_H = spacing.md * 2 + 24;

/**
 * How much of the action list opens without scrolling.
 *
 * The half row is the point: a row cut by the bottom edge is what tells you
 * there's more below, which a clean cut wouldn't (Spotify does the same). The
 * screen fraction caps it so the sheet doesn't swallow a short phone whole; it
 * goes up with the row count, or it would take the half row's place as the
 * limit and cut wherever it happened to land.
 */
function actionsMaxH(height: number): number {
  return Math.min(ACTION_H * 9.5, Math.round(height * 0.58));
}

/**
 * Minutes remaining until expiration, minimum 1.
 *
 * Rounded down, like any countdown: with 14:50 left it shows 14, same as a
 * clock. Rounding up would show 15 until exactly 14:00, so the first full
 * minute would repeat the chosen number — exactly what this label is meant to
 * avoid.
 *
 * The minimum of 1 is for the last minute: "0 min" would read as if the timer
 * is already gone, and it's still there.
 */
function minutesLeft(endsAt: number): number {
  return Math.max(1, Math.floor((endsAt - Date.now()) / 60_000));
}


function Action({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Icon.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Icon name={icon} size={24} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export function SongMenuSheet() {
  const { height: screenH } = useScreenSize();
  const router = useRouter();
  // Read here, before the early return below: what is on top decides whether
  // detail screens push or replace the modal (see `goDetail`).
  const top = useSegments()[0];
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const radiosEnabled = useSettings((s) => s.radiosEnabled);
  const queryClient = useQueryClient();
  const song = useSongMenu((s) => s.song);
  const context = useSongMenu((s) => s.context);
  const showLyrics = useSongMenu((s) => s.showLyrics);
  const startInSleep = useSongMenu((s) => s.sleep);
  const extras = useSongMenu((s) => s.extras);
  const closeNow = useSongMenu((s) => s.close);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const canShare = useCanShare();
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const rateSong = usePlayerStore((s) => s.rateSong);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAtSongEnd = usePlayerStore((s) => s.setSleepAtSongEnd);
  const cancelSleepTimer = usePlayerStore((s) => s.cancelSleepTimer);
  const sleepEndsAt = usePlayerStore((s) => s.sleepEndsAt);
  const sleepAtSongEnd = usePlayerStore((s) => s.sleepAtSongEnd);
  const toast = useToast((s) => s.show);
  const t = useT();
  const downloaded = useDownloads((s) => !!(song && s.files[song.id]));
  // The downloaded file itself, and what it was made at: exporting copies what
  // is on the phone, and a transcode should not be handed over as if it were
  // the server's original.
  const dlUri = useDownloads((s) => (song ? s.files[song.id] : undefined));
  const dlBitRate = useDownloads((s) => (song ? s.dlBitRates[song.id] : undefined));
  const downloadSong = useDownloads((s) => s.downloadSong);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  // A podcast episode downloads straight from its enclosure, and its file is
  // cleared from the podcast record rather than a server catalog.
  const downloadPodcastEpisode = useDownloads((s) => s.downloadPodcastEpisode);
  const deletePodcastDownloads = useDownloads((s) => s.deletePodcastDownloads);
  const openArtistPicker = useArtistPicker((s) => s.open);
  const favIds = useFavoriteIds(!!song);
  // A podcast episode's heart is the device's own, filed in SQLite.
  const podcastFav = usePodcastFavoriteIds(!!song?.podcastChannelId);
  const favorited = song ? heartedSong(song, podcastFav, favIds) : false;
  const played = usePodcastPlayedIds(song?.podcastChannelId).has(song?.id ?? '');

  const [mode, setMode] = useState<'actions' | 'sleep' | 'rating' | 'export'>(
    'actions',
  );
  // The action list is scrolled to the top: only then does a downward drag
  // belong to the sheet (see the `pan` below).
  const [atTop, setAtTop] = useState(true);
  // Removing a download asks first, like albums and playlists do.
  const [confirmDelete, setConfirmDelete] = useState(false);

  // When opening the menu for a song, always go back to the actions view,
  // unless it was opened for the sleep timer.
  useEffect(() => {
    if (song) setMode(startInSleep ? 'sleep' : 'actions');
  }, [song, startInSleep]);

  // Every new song or view starts the list scrolled to the top; the sheet
  // stays mounted between openings, so the flag would otherwise survive.
  useEffect(() => {
    setAtTop(true);
  }, [song, mode]);

  // Before the early return, the way every hook here has to be: the sheet
  // stays mounted with no song between openings.
  const explicit = useExplicitBadge(song?.explicitStatus);

  if (!song) return null;

  const go = (close: (after?: () => void) => void, path: string) =>
    close(() => router.push(path));

  // Detail screens (album, artist) go through here instead of `go`: opened
  // with the player on top, a push would land them in a sheet on iOS, so the
  // modal is replaced there (see `pushOrReplace`). `close` is threaded through
  // as the frame's, so leaving the sheet runs its slide-out first.
  const goDetail = (close: (after?: () => void) => void, path: string) =>
    close(() => pushOrReplace(path, top));

  /**
   * Copies the download into a folder the user picks (#57).
   *
   * The sheet is only closed once a folder has been chosen: cancelling the
   * system picker leaves the menu where it was, which is what cancelling
   * should do. The copy then runs on its own, announced by the toast, because
   * a large file over a document provider is not instant.
   */
  async function saveToFolder() {
    if (!song || !dlUri) return;
    closeNow();
    const folder = await pickFolder();
    if (!folder) return;
    toast(t('Exporting…'));
    try {
      const name = await exportToFolder(song, dlUri, folder);
      toast(t('Saved as “{name}”', { name }));
    } catch {
      toast(t("Couldn't save the file"));
    }
  }

  /** Hands the download to another app through the system share sheet (#57). */
  async function sendToApp() {
    if (!song || !dlUri) return;
    closeNow();
    try {
      // Both of these name the button that was pressed, not the mechanism
      // behind it: "share" in this app is the link a server mints, which is in
      // this very menu and is a different thing (raised by @ztx-lyghters).
      // They also say different things: this one is the system reporting it
      // has no share sheet, before anything has been attempted, and the one
      // below is an attempt that failed.
      if (!(await shareSongFile(song, dlUri))) {
        toast(t("Sending to another app isn't available on this device"));
      }
    } catch {
      toast(t("Couldn't send the file"));
    }
  }

  /** Takes the song out of the playlist it is listed in (its own undo toast).
   *  `close` is the shared frame's, threaded through so the call site cannot
   *  forget it. */
  function removeFromList(close: (after?: () => void) => void) {
    if ((!auth && !offline) || !context) return;
    close();
    const { playlistId, index } = context;
    const key = ['playlist', playlistId];
    // Optimistic: the song disappears from the list immediately; the real
    // deletion is delayed until the toast expires. «Undo» cancels it and
    // restores it in its position (the server never knew about it).
    const prev = queryClient.getQueryData<{ playlist: unknown; songs: Song[] }>(key);
    const prevList = queryClient.getQueryData<{ id: string; songCount?: number }[]>(['playlists']);
    if (prev) {
      const nextSongs = prev.songs.filter((_, i) => i !== index);
      queryClient.setQueryData(key, { ...prev, songs: nextSongs });
      // Optimistic count in the Library (`songsLabel`).
      queryClient.setQueryData<{ id: string; songCount?: number }[]>(['playlists'], (list) =>
        list?.map((p) => (p.id === playlistId ? { ...p, songCount: nextSongs.length } : p)),
      );
    }
    showUndoToast(t('Removed from playlist'), t('Undo'), {
      commit: () => {
        void (async () => {
          try {
              // We rewrite the list to the final state (without the removed song)
              // instead of removing by index: it's a "set", identical online and
              // offline, so there's no double deletion if the deferred commit
              // falls already in offline mode. If it was the last song (list at
              // 0), the index method is the proven one.
            if (prev) {
              const finalIds = prev.songs.filter((_, i) => i !== index).map((s) => s.id);
              if (finalIds.length > 0) await reorderPlaylist(playlistId, finalIds);
              else await removeFromPlaylist(playlistId, index);
            }
          } catch {
            useToast.getState().show(t("Couldn't complete the action"));
          }
          queryClient.invalidateQueries({ queryKey: key });
          queryClient.invalidateQueries({ queryKey: ['playlists'] });
        })();
      },
      undo: () => {
        if (prev) queryClient.setQueryData(key, prev);
        else queryClient.invalidateQueries({ queryKey: key });
        if (prevList) queryClient.setQueryData(['playlists'], prevList);
      },
    });
  }

  return (
    <SheetModal
      visible={!!song}
      onClosed={closeNow}
      /* The list keeps the drag once it is scrolled: pulling down mid-list
         scrolls it instead of closing the sheet on somebody trying to read. So
         this sheet places its own drags - the header's and the list's - inside
         the sheet, side by side, instead of taking the frame's one around
         everything. */
      sheetDrag={false}
      /* The confirm dialog for the destructive one belongs to the `Modal` over
         and outside the sheet: it asks while the sheet is up, and its
         confirmations close the sheet through the same `close` its content takes. */
      overSheet={(close) => (
        <Dialog
          visible={confirmDelete}
          title={t('Remove download?')}
          message={t('“{name}” will no longer be available offline.', { name: song.title })}
          confirmLabel={t('Remove')}
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            if (song.podcastChannelId) {
              // The episode's file goes from the podcast record, not a server
              // catalog, and its undo re-pulls the same enclosure — the publisher,
              // not the server: automatic offline may still undo, only a manual
              // "use no network" takes the way back away.
              void deletePodcastDownloads([song.id]);
              toast(
                t('Download removed'),
                isManualOffline()
                  ? undefined
                  : {
                      label: t('Undo'),
                      run: () =>
                        void downloadPodcastEpisode({
                          id: song.id,
                          url: song.url!,
                          channelId: song.podcastChannelId!,
                        }),
                    },
              );
              close();
              return;
            }
            void deleteSongs([song.id]);
            // «Undo» still there: confirming by mistake is a tap away from
            // getting it back (offline there'd be nowhere to download from).
            toast(
              t('Download removed'),
              offline ? undefined : { label: t('Undo'), run: () => void downloadSong(song) },
            );
            close();
          }}
        />
      )}
    >
      {(close, makePan) => {
        // Second drag, for the grabber and the header (see the JSX below).
        const headerPan = makePan();
        return (
          <>
            {/* The header has its own drag, always enabled: it's the way out
                when the list below is scrolled and keeps the gesture for itself
                (and the only one in the playlist view, where the list owns it
                entirely). Two detectors instead of one around everything so both
                can never fire at once. */}
            <GestureDetector gesture={headerPan}>
              <View>
                {/* Spotify-style grabber: the visual cue that the sheet can be
                    dragged down to dismiss. */}
                <Grabber />
                <View style={styles.headerRow}>
                  <Cover uri={songCoverUrl(song, COVER.thumb)} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>
                      {song.title}
                    </Text>
                    {explicit || song.artist ? (
                      <View style={styles.subRow}>
                        <ExplicitBadge status={song.explicitStatus} />
                        {song.artist ? (
                          <Text style={styles.artist} numberOfLines={1}>
                            {song.artist}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={styles.divider} />
              </View>
            </GestureDetector>

            <GestureDetector gesture={makePan().enabled(atTop)}>
              <View>
                {mode === 'sleep' ? (
                  <View>
                    <Pressable style={styles.action} onPress={() => setMode('actions')}>
                      <Icon name="chevron-back" size={24} color={colors.text} />
                      <Text style={styles.actionText}>{t('Sleep timer')}</Text>
                    </Pressable>
                    {[15, 30, 45, 60].map((m) => (
                      <Pressable
                        key={m}
                        style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                        onPress={() => {
                          setSleepTimer(m);
                          toast(t('Will pause in {n} min', { n: m }));
                          close();
                        }}
                      >
                        <Icon name="time-outline" size={24} color={colors.text} />
                        <Text style={styles.actionText}>{t('{n} minutes', { n: m })}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                      onPress={() => {
                        setSleepAtSongEnd();
                        toast(t('Will pause when the song ends'));
                        close();
                      }}
                    >
                      <Icon name="musical-note-outline" size={24} color={colors.text} />
                      <Text style={styles.actionText}>{t('When the song ends')}</Text>
                    </Pressable>
                    {sleepEndsAt || sleepAtSongEnd ? (
                      <Pressable
                        style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                        onPress={() => {
                          cancelSleepTimer();
                          toast(t('Sleep timer off'));
                          close();
                        }}
                      >
                        <Icon name="close-circle-outline" size={24} color={colors.danger} />
                        <Text style={[styles.actionText, { color: colors.danger }]}>
                          {t('Turn off')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : mode === 'export' ? (
                  <View>
                    <Pressable style={styles.action} onPress={() => setMode('actions')}>
                      <Icon name="chevron-back" size={24} color={colors.text} />
                      <Text style={styles.actionText}>{t('Export')}</Text>
                    </Pressable>
                    {/* Said before the file leaves, not after: a download made at
                        a lower bitrate is a worse copy than the server's, and the
                        only moment that matters is while deciding to hand it to
                        someone. */}
                    {dlBitRate ? (
                      <Text style={styles.note}>
                        {t('This download is a {n} kbps copy, not the original file.', {
                          n: dlBitRate,
                        })}
                      </Text>
                    ) : null}
                    {/* Picking a folder is the Storage Access Framework, which is
                        Android's. Elsewhere the share sheet is the only way out. */}
                    {Platform.OS === 'android' ? (
                      <Action
                        icon="folder-outline"
                        label={t('Save to a folder')}
                        onPress={() => void saveToFolder()}
                      />
                    ) : null}
                    <Action
                      icon="share-outline"
                      label={t('Send to another app')}
                      onPress={() => void sendToApp()}
                    />
                  </View>
                ) : mode === 'rating' ? (
                  <View>
                    <Pressable style={styles.action} onPress={() => setMode('actions')}>
                      <Icon name="chevron-back" size={24} color={colors.text} />
                      <Text style={styles.actionText}>{t('Rate')}</Text>
                    </Pressable>
                    <View style={styles.ratingRow}>
                      <StarRating
                        id={song.id}
                        rating={song.userRating}
                        size={34}
                        onRated={(r) => rateSong(song.id, r)}
                      />
                    </View>
                  </View>
                ) : (
                  // Scrolls: with every action enabled the list is taller than
                  // the room a sheet should take. `onScroll` hands the drag back
                  // to the sheet only at the top, so pulling down mid-list scrolls
                  // instead of dismissing.
                  <ScrollView
                    style={{ maxHeight: actionsMaxH(screenH) }}
                    scrollEventThrottle={16}
                    onScroll={(e) => setAtTop(e.nativeEvent.contentOffset.y <= 0)}
                  >
                    {/* Only a track a playlist can name gets the playlist
                        actions: a podcast episode's id means nothing to the
                        server, and so does a radio station's: its id belongs to
                        the station list (`canGoIntoPlaylist` says it once, and
                        the heart's hold reads the same rule). */}
                    {canGoIntoPlaylist(song) ? (
                      <>
                        <Action
                          icon="add-circle-outline"
                          label={t('Add to a playlist')}
                          onPress={() =>
                            close(() => usePlaylistPicker.getState().open([song]))
                          }
                        />
                        {context ? (
                          <Action
                            icon="remove-circle-outline"
                            label={t('Remove from playlist')}
                            onPress={() => removeFromList(close)}
                          />
                        ) : null}
                      </>
                    ) : null}
                    <Action
                      icon="play-forward-outline"
                      label={t('Play next')}
                      onPress={() => {
                        playNext(song);
                        toast(t('Playing next'));
                        close();
                      }}
                    />
                    <Action
                      icon="list-outline"
                      label={t('Add to queue')}
                      onPress={() => {
                        addToQueue(song);
                        toast(t('Added to queue'));
                        close();
                      }}
                    />
                    <Action
                      icon={favorited ? 'heart' : 'heart-outline'}
                      label={favorited ? t('Remove from favorites') : t('Add to favorites')}
                      onPress={() => {
                        if (song.podcastChannelId) {
                          // The device's own SQLite favorite, not the server's.
                          void togglePodcastHeart(song.id, 'episode', song.podcastChannelId)
                            .catch(() => toast(t("Couldn't complete the action")));
                          toast(favorited ? t('Removed from favorites') : t('Added to favorites'));
                          close();
                          return;
                        }
                        (favorited ? unstar(song.id) : star(song.id))
                          .then(() => applyStarChange('song', song.id, !favorited, song))
                          .catch(resyncFavorites);
                        toast(favorited ? t('Removed from favorites') : t('Added to favorites'));
                        close();
                      }}
                    />
                    {/* A podcast episode has no album or artist of its own — the
                        show is both — so the two collapse into one "Go to Podcast". */}
                    {song.podcastChannelId ? (
                      <Action
                        icon={played ? 'ellipse-outline' : 'checkmark-circle-outline'}
                        label={played ? t('Mark as unplayed') : t('Mark as played')}
                        onPress={() => {
                          void setEpisodePlayed(song, !played).catch(() =>
                            toast(t("Couldn't complete the action")),
                          );
                          close();
                        }}
                      />
                    ) : null}
                    {song.podcastChannelId ? (
                      <Action
                        icon="headset-outline"
                        label={t('Go to Podcast')}
                        onPress={() => goDetail(close, `/podcast/${song.podcastChannelId}`)}
                      />
                    ) : null}
                    {!song.podcastChannelId && (song.albumId || song.album) ? (
                      <Action
                        icon="disc-outline"
                        label={t('Go to album')}
                        onPress={() => {
                          if (song.albumId) { goDetail(close, `/album/${song.albumId}`); return; }
                          if (song.album) {
                            const key = normKey(song.album) + '|' + normKey(song.artist || '');
                            goDetail(close, `/album/${key}`);
                          }
                        }}
                      />
                    ) : null}
                    {!song.podcastChannelId && (song.artistId || song.artist) ? (
                      <Action
                        icon="person-outline"
                        label={t('Go to artist')}
                        onPress={() => {
                          const targets = artistTargets(song);
                          if (targets.length > 1) {
                            // We close the sheet and, after its exit animation, open the
                            // picker (avoids two visible Modals at once).
                            close(() => openArtistPicker(targets));
                            return;
                          }
                          const id = targets[0]?.id ?? (song.artist ? normKey(song.artist) : '');
                          if (id) goDetail(close, `/artist/${id}`);
                        }}
                      />
                    ) : null}
                    {song.artistId && !offline && radiosEnabled ? (
                      <Action
                        icon="radio-outline"
                        label={t('Go to artist radio')}
                        onPress={() => goDetail(close, `/artist-radio/${song.artistId}`)}
                      />
                    ) : null}
                    {downloaded ? (
                      <Action
                        icon="arrow-down-circle-outline"
                        label={t('Remove download')}
                        // Asks first, like albums and playlists do: this one used
                        // to delete on the spot (#48).
                        onPress={() => setConfirmDelete(true)}
                      />
                    ) : (song.podcastChannelId ? !isManualOffline() && song.url : !offline && !song.url) ? (
                      <Action
                        icon="download-outline"
                        label={t('Download')}
                        onPress={() => {
                          // An episode pulls from its own address; a server song
                          // goes through the server's download. A podcast needs no
                          // server, so automatic offline (server down) may still
                          // fetch it — only a manual "use no network" says no.
                          if (song.podcastChannelId)
                            void downloadPodcastEpisode({
                              id: song.id,
                              url: song.url!,
                              channelId: song.podcastChannelId!,
                            });
                          else void downloadSong(song);
                          toast(t('Downloading…'));
                          close();
                        }}
                      />
                    ) : null}
                    {/* Downloaded songs only. Exporting one that is not on the
                        phone would be a download wearing another word: network,
                        time, data and a size worth warning about. That one is two
                        steps, Download and then Export, and both say what they
                        are (#57). */}
                    {downloaded ? (
                      <Action
                        icon="save-outline"
                        label={t('Export')}
                        onPress={() => setMode('export')}
                      />
                    ) : null}
                    {showLyrics ? (
                      <Action
                        icon="mic-outline"
                        label={t('Lyrics')}
                        onPress={() => go(close, '/lyrics')}
                      />
                    ) : null}
                    {/* The player's buttons that are hidden from its bottom row,
                        so hiding them does not hide what they open (#248). */}
                    {extras.queue ? (
                      <Action icon="layers-outline" label={t('View queue')} onPress={() => go(close, '/queue')} />
                    ) : null}
                    {extras.devices ? (
                      <Action
                        icon="laptop-outline"
                        label={t('Devices')}
                        onPress={() => {
                          const open = extras.devices!;
                          close(open);
                        }}
                      />
                    ) : null}
                    {extras.speed ? (
                      <Action
                        icon="speedometer-outline"
                        label={t('Playback speed')}
                        onPress={() => {
                          const open = extras.speed!;
                          close(open);
                        }}
                      />
                    ) : null}
                    {/* Online only (similar songs are found by the server) and not for
                        stations (`url`), which have no "similar". */}
                    {!offline && !song.url ? (
                      <Action
                        icon="sparkles-outline"
                        label={t('Start mix')}
                        onPress={() => {
                          close();
                          // The queue changes underneath without the song restarting, so
                          // without this nothing on screen says the mix actually began.
                          // And it's only said once tracks have arrived: announcing a
                          // mix that came up empty is how the failure stayed invisible.
                          // Null: the seed itself did not load, and that already said so.
                          void startRadio(song, t('Mix of “{name}”', { name: song.title })).then(
                            (started) => {
                              if (started === null) return;
                              toast(
                                started
                                  ? t('Mix started')
                                  : t("Couldn't find anything to mix with this song"),
                              );
                            },
                          );
                        }}
                      />
                    ) : null}
                    {/* Rate (Subsonic setRating): non-Jellyfin server account and not
                        radio. Offline is recorded and uploaded on reconnect (the local
                        profile has no account, so it doesn't appear there). */}
                    {!!auth && serverType !== 'jellyfin' && !song.url ? (
                      <Action icon="star-outline" label={t('Rate')} onPress={() => setMode('rating')} />
                    ) : null}
                    {/* Only with a server that mints share links (`useCanShare`),
                        and never for a station: its `url` is not the server's to
                        share. */}
                    {canShare && !song.url ? (
                      <Action
                        icon="share-social-outline"
                        label={t('Share')}
                        onPress={() => {
                          close(() => useSharePicker.getState().open({ id: song.id, name: song.title }));
                        }}
                      />
                    ) : null}
                    <Action
                      icon="moon-outline"
                      label={
                        sleepEndsAt
                          ? t('Sleep timer ({n} min left)', { n: minutesLeft(sleepEndsAt) })
                          : sleepAtSongEnd
                            ? t('Sleep timer (end of song)')
                            : t('Sleep timer')
                      }
                      onPress={() => setMode('sleep')}
                    />
                    <Action
                      icon="information-circle-outline"
                      label={song.podcastChannelId ? t('Episode information') : t('Song information')}
                      onPress={() => {
                        close(() => useSongInfo.getState().open(song));
                      }}
                    />
                  </ScrollView>
                )}
              </View>
            </GestureDetector>
          </>
        );
      }}
    </SheetModal>
  );
}

const styles = themed((colors) => ({
  // The sheet's frame (backdrop, sheet, grabber) is not re-declared here: the
  // sheet takes the shared one (see `SheetModal`), and its grab-cue is drawn as
  // the frame's `Grabber` - inside the drag around this sheet's header, which is
  // where the header's drag has the gesture.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  artist: { color: colors.textSecondary, fontSize: fontSize.sm, flexShrink: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  ratingRow: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  // Aligned with the action labels above it, so it reads as part of the list
  // rather than as a banner dropped on top of it.
  note: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    paddingBottom: spacing.sm,
    paddingLeft: 24 + spacing.lg,
  },
}));
