/** Playlist detail with its songs. */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useShallow } from 'zustand/react/shallow';

import {
  coverArtUrl,
  songCoverUrl,
  deletePlaylist,
  getPlaylist,
  removeFromPlaylist,
  reorderPlaylist,
  updatePlaylist,
  addToPlaylist,
  getSimilarSongs,
  COVER,
} from '@/api/data';
import { streamUrl } from '@/api/backend';
import { type Song } from '@/api/subsonic';
import { CoverViewer } from '@/components/CoverViewer';
import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { BackButton } from '@/components/BackButton';
import { Message } from '@/components/Message';
import { PlaylistEditSheet, type PlaylistEdit } from '@/components/PlaylistEditSheet';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { PlaylistReorder } from '@/components/PlaylistReorder';
import { SheetModal } from '@/components/SheetModal';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackListView } from '@/components/TrackListView';
import { useCanShare } from '@/hooks/useCanShare';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { usePlaylistStars } from '@/hooks/usePlaylistStars';
import { useServerCover } from '@/hooks/useServerCover';
import { useSongSort } from '@/hooks/useSongSort';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { canShareResonusLink, shareResonusLink } from '@/lib/shareLink';
import { useSharePicker } from '@/store/sharePicker';
import { useAuthStore } from '@/store/auth';
import { useAutoDownloads } from '@/store/autoDownloads';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { usePins } from '@/store/pins';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { showUndoToast, useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed, useTheme, tracking } from '@/theme';

const SEED_COUNT = 5;
const SIMILAR_PER_SEED = 3;
const SUGGESTION_MAX = 5;

/** Stops the preview playing on whichever playlist screen started it, so a
 *  second screen never plays over the first. */
let activePreview: { player: AudioPlayer; stop: () => void } | null = null;

async function fetchSuggestions(
  songs: Song[],
  existingIds: Set<string>,
): Promise<Song[]> {
  if (songs.length === 0) return [];
  const shuffled = songs.slice().sort(() => Math.random() - 0.5);
  const seeds = shuffled.slice(0, SEED_COUNT);
  const results = await Promise.all(
    seeds.map((s) => getSimilarSongs(s.id, SIMILAR_PER_SEED).catch(() => [])),
  );
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const list of results) {
    for (const song of list) {
      if (!seen.has(song.id) && !existingIds.has(song.id)) {
        seen.add(song.id);
        out.push(song);
        if (out.length >= SUGGESTION_MAX) return out;
      }
    }
  }
  return out;
}

function SuggestedTracks({
  songs,
  playlistId,
  playlistName,
  onAdded,
}: {
  songs: Song[];
  playlistId: string;
  playlistName: string;
  onAdded: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuthStore((s) => s.auth);
  const [suggestions, setSuggestions] = useState<Song[]>([]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewPlayer = useRef<AudioPlayer | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasPlayingRef = useRef(false);
  const existingIds = useMemo(() => new Set(songs.map((s) => s.id)), [songs]);
  // Read by `refresh` without being a dependency: adding a suggestion refetches
  // the playlist, and that must not throw away and redraw the other suggestions.
  const songsRef = useRef(songs);
  songsRef.current = songs;
  const existingRef = useRef(existingIds);
  existingRef.current = existingIds;
  // Only the latest request may land; an older one finishing late is dropped.
  const requestRef = useRef(0);
  const unmountedRef = useRef(false);

  /** Puts the music back the way the preview found it. Sets, never toggles:
   *  if the listener pressed play meanwhile, it is already playing. */
  const resumeMusic = useCallback(() => {
    if (!wasPlayingRef.current) return;
    wasPlayingRef.current = false;
    if (!usePlayerStore.getState().isPlaying) usePlayerStore.getState().toggle();
  }, []);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      requestRef.current++;
    };
  }, []);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    const result = await fetchSuggestions(songsRef.current, existingRef.current);
    if (request !== requestRef.current) return;
    setSuggestions(result);
  }, []);

  // Once, when the playlist's songs are first known. Refresh asks again.
  const hasSongs = songs.length > 0;
  useEffect(() => {
    if (hasSongs) void refresh();
  }, [hasSongs, refresh]);

  const addSong = useCallback(
    async (song: Song) => {
      try {
        await addToPlaylist(playlistId, song.id);
        setSuggestions((prev) => prev.filter((s) => s.id !== song.id));
        // Same as every other way into a playlist: the Library count, the
        // playlist itself, and its auto-download if it has one.
        queryClient.setQueryData<{ id: string; songCount?: number }[]>(['playlists'], (list) =>
          list?.map((p) => (p.id === playlistId ? { ...p, songCount: (p.songCount ?? 0) + 1 } : p)),
        );
        queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
        queryClient.invalidateQueries({ queryKey: ['playlists'] });
        void useAutoDownloads.getState().reconcile(playlistId, true);
        toast.show(t('Added to “{name}”', { name: playlistName }));
      } catch {
        toast.show(t("Couldn't add to the playlist"));
      }
    },
    [playlistId, playlistName, queryClient, toast, t],
  );

  // `remove()` alone leaves the native player sounding until it is collected.
  const stopPreview = useCallback(() => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    const p = previewPlayer.current;
    previewPlayer.current = null;
    if (p && activePreview?.player === p) activePreview = null;
    if (!unmountedRef.current) setPreviewing(null);
    if (p) {
      try {
        p.pause();
        p.remove();
      } catch {}
    }
    resumeMusic();
  }, [resumeMusic]);

  // Leaving the screen, or the app, ends the preview.
  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'background') stopPreview();
      });
      return () => {
        focusedRef.current = false;
        sub.remove();
        stopPreview();
      };
    }, [stopPreview]),
  );

  // The music starting some other way ends the preview, and it stays playing.
  useEffect(
    () =>
      usePlayerStore.subscribe((s, prev) => {
        if (s.isPlaying && !prev.isPlaying && previewPlayer.current) {
          wasPlayingRef.current = false;
          stopPreview();
        }
      }),
    [stopPreview],
  );

  const previewSong = useCallback(
    (song: Song) => {
      if (previewing === song.id) {
        stopPreview();
        return;
      }
      activePreview?.stop();
      stopPreview();
      if (!auth) return;
      const url = song.url || streamUrl(auth, song.id);
      if (!url) return;
      wasPlayingRef.current = usePlayerStore.getState().isPlaying;
      if (wasPlayingRef.current) usePlayerStore.getState().toggle();
      const player = createAudioPlayer({ uri: url });
      previewPlayer.current = player;
      activePreview = { player, stop: stopPreview };
      player.play();
      const startSec = (song.duration ?? 0) > 38 ? 38 : 0;
      if (startSec > 0) player.seekTo(startSec);
      setPreviewing(song.id);
      previewTimer.current = setTimeout(stopPreview, 45_000);
    },
    [auth, previewing, stopPreview],
  );

  // What was added some other way meanwhile is no longer a suggestion.
  const visible = suggestions.filter((s) => !existingIds.has(s.id));
  if (visible.length === 0) return null;

  return (
    <View style={suggestedStyles.section}>
      <Text style={suggestedStyles.title}>{t('Suggested tracks')}</Text>
      <Text style={suggestedStyles.subtitle}>
        {t('Based on the tracks in this playlist')}
      </Text>
      {visible.map((song) => (
        <Pressable
          key={song.id}
          style={suggestedStyles.row}
          onPress={() => previewSong(song)}
        >
          <View style={suggestedStyles.artwork}>
            <Cover uri={songCoverUrl(song, COVER.thumb)} size={48} />
          </View>
          <View style={suggestedStyles.info}>
            <Text
              style={[
                suggestedStyles.songTitle,
                previewing === song.id && { color: colors.accent },
              ]}
              numberOfLines={1}
            >
              {song.title}
            </Text>
            {song.artist ? (
              <Text style={suggestedStyles.artist} numberOfLines={1}>
                {song.artist}
              </Text>
            ) : null}
          </View>
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('Add to a playlist')}
            onPress={() => void addSong(song)}
            style={({ pressed }) => [
              suggestedStyles.addButton,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Icon name="add-circle-outline" size={26} color={colors.text} />
          </Pressable>
        </Pressable>
      ))}
      <Pressable
        onPress={() => void refresh()}
        style={({ pressed }) => [
          suggestedStyles.refreshButton,
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={suggestedStyles.refreshText}>{t('Refresh')}</Text>
      </Pressable>
    </View>
  );
}

const suggestedStyles = themed((colors) => ({
  section: {
    marginTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  artwork: {
    width: 48,
    height: 48,
  },
  info: { flex: 1 },
  songTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs },
  addButton: { padding: spacing.xs },
  refreshButton: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    backgroundColor: colors.surfaceHighlight,
  },
  refreshText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
}));

export default function PlaylistScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const showPlaylistDescription = useSettings((s) => s.showPlaylistDescription);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const canShare = useCanShare();
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const queueMany = usePlayerStore((s) => s.queueMany);

  // Whether this server keeps favourite playlists, and which ones. Also the
  // answer to whether there is a heart on this screen at all.
  const playlistStars = usePlaylistStars();

  // The ⋯ menu lives in a SheetModal (opening/closing doesn't re-render the screen).
  const menuRef = useRef<() => void>(() => {});
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [confirmDeleteDl, setConfirmDeleteDl] = useState(false);
  const [confirmRemoveDl, setConfirmRemoveDl] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  // Songs selected in selection mode pending "add to another".
  const [addingSongs, setAddingSongs] = useState<Song[] | null>(null);

  // Change cover from the expanded viewer (Spotify-style). Same conditions as
  // in the edit sheet: Navidrome on server, or local profile.
  const coverChange = useServerCover({
    coverUploadId: !offline && auth?.serverType === 'navidrome' ? id : undefined,
    localCoverId: offline ? id : undefined,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => getPlaylist(id),
    enabled: (!!auth || offline) && !!id,
  });

  const songIds = (data?.songs ?? []).map((s) => s.id);
  // Exact, unlike the album menu's guess: the songs are right here, so the
  // option only shows when some of them are actually on the device. Only
  // whether there are any, though: the map itself is replaced with every song
  // that finishes downloading, and subscribing to it re-rendered the screen on
  // each one (#50). Which ones they are is settled when the delete is
  // confirmed, where it is asked once.
  const hasDownloads = useDownloads((s) => songIds.some((sid) => !!s.files[sid]));
  const downloadMsg = useDownloadMessage(data?.songs ?? []);
  const download = useDownloads(
    useShallow((s) => groupDownloadState(s, `playlist:${id}`, songIds)),
  );
  const downloadPlaylist = useDownloads((s) => s.downloadPlaylist);
  // Auto-download: only makes sense for server playlists (not the local profile
  // nor the `dl_` local playlists that are already the download mirror).
  const canAutoDownload = !!auth && !id.startsWith('dl_');
  const autoDownload = useAutoDownloads((s) => !!s.ids[id]);
  // On opening/refreshing the auto-download playlist, reconcile with what we
  // already have (without re-fetching): download what's missing, pick up changes
  // from other clients.
  useEffect(() => {
    if (autoDownload && data) {
      void useAutoDownloads.getState().reconcileKnown(data.playlist, data.songs, true);
    }
  }, [autoDownload, data]);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  // Stable between progress ticks (only changes with status): prevents the
  // Pressable from losing its touch when its onPress is recreated on every update.
  const onDownloadPress = useCallback(() => {
    if (download.status === 'none') setConfirmDownload(true);
    else if (download.status === 'done') setConfirmRemoveDl(true);
    else if (download.status === 'active') setConfirmStop(true);
  }, [download.status]);

  /**
   * In a playlist `recent` is the order the server keeps the songs in, which
   * is what "Default" means everywhere else in the app (see `useServerSort`),
   * so it says Default here too.
   *
   * It used to say "Custom", and that was only ever half true. Where the order
   * comes from depends on what kind of list it is: drag the songs around in an
   * ordinary playlist and this is what you dragged, but a smart playlist is
   * ordered by the rules it was built with on the server and there is nothing
   * of yours in it. "Custom" is wrong for the second kind and "Pre-defined"
   * would be wrong for the first; the order simply is what the list came with,
   * whoever decided it, and that is what Default says.
   *
   * `added` keeps the name it has on every other screen, "Recently added",
   * rather than being called "Recent" only here — which is a third thing again,
   * since "Recent" elsewhere is about what YOU played, not about when a song
   * joined a list.
   */
  const {
    songs: displaySongs,
    indices: playlistIndices,
    openSort,
    sortSheet,
    setSort,
  } = useSongSort(data?.songs ?? [], `playlist:${id}`, {
    fields: ['recent', 'added', 'alpha', 'artist', 'album', 'downloaded'],
    labels: { recent: 'Default' },
    // The list opens in the order it came in, new items at the bottom;
    // "Recently added" puts the latest at the top.
    defaultSort: { field: 'recent', dir: 'asc' },
  });

  async function onSaveEdit(changes: PlaylistEdit) {
    setEditing(false);
    if (!auth && !offline) return;
    try {
      await updatePlaylist(id, changes);
      queryClient.invalidateQueries({ queryKey: ['playlist', id] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Playlist updated'));
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  function onDelete() {
    setDeleting(false);
    if (!auth && !offline) return;
    // Optimistic: disappears from the list and we exit the screen; the actual
    // delete is deferred until the toast expires. «Undo» cancels it (the server
    // never found out).
    const prev = queryClient.getQueryData<{ id: string }[]>(['playlists']);
    if (prev) {
      queryClient.setQueryData(['playlists'], prev.filter((p) => p.id !== id));
    }
    router.back();
    showUndoToast(t('Playlist deleted'), t('Undo'), {
      commit: () => {
        deletePlaylist(id)
          .then(() => {
            usePins.getState().unpin(`playlist:${id}`);
            return queryClient.invalidateQueries({ queryKey: ['playlists'] });
          })
          .catch(() => {
            useToast.getState().show(t("Couldn't complete the action"));
            queryClient.invalidateQueries({ queryKey: ['playlists'] });
          });
      },
      undo: () => {
        if (prev) queryClient.setQueryData(['playlists'], prev);
        else queryClient.invalidateQueries({ queryKey: ['playlists'] });
      },
    });
  }

  /** Saves the new order (optimistic) and rewrites it on the server. */
  async function onReorderSave(songIds: string[]) {
    setReordering(false);
    // The view goes back to manual order so the just-made change is visible.
    setSort({ field: 'recent', dir: 'asc' });
    const key = ['playlist', id];
    const prev = queryClient.getQueryData<{ playlist: unknown; songs: Song[] }>(key);
    if (prev) {
      const byId = new Map(prev.songs.map((s) => [s.id, s]));
      const songs = songIds.map((sid) => byId.get(sid)).filter(Boolean) as Song[];
      queryClient.setQueryData(key, { ...prev, songs });
    }
    try {
      await reorderPlaylist(id, songIds);
    } catch {
      toast(t("Couldn't complete the action"));
    } finally {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    }
  }

  /**
   * Re-reads the playlist from the server, ignoring the cache (global staleTime
   * of 5 min). Mainly for smart playlists, which return a different selection on
   * each query: without this you'd see the same one until the cache expires.
   */
  async function onRefresh() {
    const res = await refetch();
    // The Library list also shows the name, cover and song count.
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
    toast(res.isError ? t("Couldn't complete the action") : t('Updated'));
  }

  const canReorder = (data?.songs.length ?? 0) > 1 && (offline || !!auth);

  /** Removes several songs (real indices) with deferred delete and undo. */
  function removeMany(indices: number[]) {
    if ((!auth && !offline) || indices.length === 0) return;
    const key = ['playlist', id];
    const drop = new Set(indices);
    // Optimistic: they disappear from the view immediately; the actual delete
    // is deferred until the toast expires. «Undo» cancels it and restores them
    // in place.
    const prev = queryClient.getQueryData<{ playlist: unknown; songs: Song[] }>(key);
    // Optimistic count in the Library (`songsLabel`): without this the list's
    // subtitle doesn't update until that screen is reloaded.
    const prevList = queryClient.getQueryData<{ id: string; songCount?: number }[]>(['playlists']);
    if (prev) {
      const nextSongs = prev.songs.filter((_, i) => !drop.has(i));
      queryClient.setQueryData(key, { ...prev, songs: nextSongs });
      queryClient.setQueryData<{ id: string; songCount?: number }[]>(['playlists'], (list) =>
        list?.map((p) => (p.id === id ? { ...p, songCount: nextSongs.length } : p)),
      );
    }
    showUndoToast(
      indices.length === 1
        ? t('Removed from playlist')
        : t('{n} removed from playlist', { n: indices.length }),
      t('Undo'),
      {
        commit: () => {
          void (async () => {
            try {
            // We rewrite the list to the final state (the original minus the
            // removed ones) instead of removing by index: it's a "set", identical
            // online and offline, so there's no index mismatch or double delete
            // if the deferred commit falls in offline mode. If the result is an
            // empty list, the index method is the proven one.
              if (prev) {
                const finalIds = prev.songs.filter((_, i) => !drop.has(i)).map((s) => s.id);
                if (finalIds.length > 0) {
                  await reorderPlaylist(id, finalIds);
                } else {
                  for (const i of [...indices].sort((a, b) => b - a)) {
                    await removeFromPlaylist(id, i);
                  }
                }
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
      },
    );
  }

  if (isLoading) {
    return <TrackListSkeleton />;
  }

  // Only when there's nothing to show: a failed refresh with data already
  // loaded keeps the list on screen (the toast reports the failure).
  if (!data) {
    return (
      <View style={styles.center}>
        <BackButton />
        <Message
          text={offline ? t('Playlists are not available in offline mode.') : t("Couldn't load the playlist.")}
          onRetry={offline ? undefined : () => refetch()}
        />
      </View>
    );
  }

  // Reordering always works on the manual order (raw server), not on the
  // A-Z/date sorted view.
  if (reordering) {
    return (
      <PlaylistReorder
        songs={data.songs}
        title={data.playlist.name}
        onCancel={() => setReordering(false)}
        onSave={(ids) => void onReorderSave(ids)}
      />
    );
  }

  const totalSec = data.songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const metaParts = [t('Playlist'), songsLabel(data.songs.length, lang)];
  if (totalSec > 0) metaParts.push(formatTotalDuration(totalSec));

  return (
    <>
      <TrackListView
        title={data.playlist.name}
        description={showPlaylistDescription ? data.playlist.comment : undefined}
        meta={metaParts.join(' · ')}
        coverUri={coverArtUrl(data.playlist.coverArt ?? data.playlist.id, COVER.card)}
        onCoverPress={
          data.playlist.coverArt || data.songs.length > 0 ? () => setCoverOpen(true) : undefined
        }
        songs={displaySongs}
        playlistIndices={playlistIndices}
        currentId={playing?.id}
        onMenu={() => menuRef.current()}
        // Only where the state can be read back, which is Navidrome 0.64 and
        // up through its native API: `usePlaylistStars` answers `undefined`
        // for every other case and the heart stays away rather than pretending
        // (see the hook, and `StarType`).
        favorite={
          playlistStars
            ? { id, type: 'playlist' as const, starred: playlistStars.has(id) }
            : undefined
        }
        playlistId={id}
        showArtwork={showListArtwork}
        searchable
        onSort={data.songs.length > 1 ? openSort : undefined}
        download={
          !offline && data.songs.length > 0
            ? { ...download, onPress: onDownloadPress }
            : undefined
        }
        emptyState={
          <EmptyState
            icon="musical-notes-outline"
            title={t('This playlist is empty')}
            subtitle={t('Add songs from the ⋯ menu of any song.')}
          />
        }
        selection={{
          onRemove: (_sel, indices) => removeMany(indices),
          onAddTo: (sel) => setAddingSongs(sel),
          onDownload: !offline
            ? (sel) => {
                void downloadSongs(sel);
                toast(t('Downloading…'));
              }
            : undefined,
        }}
        footer={
          !offline && data.songs.length > 0 ? (
            <SuggestedTracks
              songs={data.songs}
              playlistId={id}
              playlistName={data.playlist.name}
              onAdded={() => {}}
            />
          ) : undefined
        }
        onPlay={(start, opts) =>
          playQueue(displaySongs, start, data.playlist.name, `/playlist/${id}`, opts)
        }
      />
      <PlaylistPickerSheet
        songs={addingSongs}
        excludeId={id}
        onClose={() => setAddingSongs(null)}
      />
      <CoverViewer
        visible={coverOpen}
        uri={coverChange.pickedUri ?? coverArtUrl(data.playlist.coverArt ?? data.playlist.id, COVER.full)}
        onClose={() => setCoverOpen(false)}
        footer={
          coverChange.enabled ? (
            <>
              {coverChange.uploading ? (
                <ActivityIndicator color={colors.onArtwork} />
              ) : (
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  onPress={() => void coverChange.pickAndUpload()}
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                >
                  <Text style={styles.changeCover}>{t('Change cover')}</Text>
                </Pressable>
              )}
              {coverChange.error ? (
                <Text style={styles.coverError}>{coverChange.error}</Text>
              ) : null}
            </>
          ) : undefined
        }
      >
        <Dialog
          visible={coverChange.askPassword}
          title={t('Confirm your password')}
          message={t('Your password is needed to upload images and will be stored securely.')}
          input={{ placeholder: t('Password'), secure: true }}
          confirmLabel={t('Save')}
          onCancel={coverChange.cancelPassword}
          onConfirm={(value) => void coverChange.confirmPassword(value)}
        />
      </CoverViewer>
      {sortSheet}

      <SheetModal openRef={menuRef}>
        {(close) => (
          <>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                // In the visible order (respects the order chosen with ⇅).
                queueMany(displaySongs, 'next');
                toast(t('Playing next'));
              }}
            >
              <Icon name="play-forward" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Play next')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                queueMany(displaySongs, 'end');
                toast(t('Added to queue'));
              }}
            >
              <Icon name="list" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Add to queue')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                if (displaySongs.length > 0) setAddingSongs(displaySongs);
              }}
            >
              <Icon name="add" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
            </Pressable>
            {canReorder ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  setReordering(true);
                }}
              >
                <Icon name="swap-vertical" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Reorder')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                setEditing(true);
              }}
            >
              <Icon name="create-outline" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Edit playlist')}</Text>
            </Pressable>
            {canAutoDownload ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  // Turning it ON downloads the whole list right away and keeps
                  // doing so as it changes, so it asks first — with the size,
                  // like any other download. Turning it off deletes nothing and
                  // is instant, so there's nothing to confirm there.
                  if (useAutoDownloads.getState().ids[id]) {
                    useAutoDownloads.getState().toggle(id);
                    toast(t('Auto-download off'));
                  } else {
                    setConfirmAuto(true);
                  }
                }}
              >
                <Icon
                  name={autoDownload ? 'cloud-done' : 'cloud-download-outline'}
                  size={24}
                  color={autoDownload ? colors.accent : colors.text}
                />
                <Text style={[styles.actionText, autoDownload && { color: colors.accent }]}>
                  {t('Auto-download')}
                </Text>
              </Pressable>
            ) : null}
            {!offline ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  void onRefresh();
                }}
              >
                <Icon name="refresh" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Refresh')}</Text>
              </Pressable>
            ) : null}
            {canShare ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  useSharePicker.getState().open({ id, name: data.playlist.name });
                }}
              >
                <Icon name="share-social-outline" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Share')}</Text>
              </Pressable>
            ) : null}
            {canShareResonusLink() &&
            data.playlist.public !== false &&
            !id.startsWith('tmp_') ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  void shareResonusLink({ kind: 'playlist', id, name: data.playlist.name });
                }}
              >
                <Icon name="link-outline" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Share Resonus link')}</Text>
              </Pressable>
            ) : null}
            {/* The album's menu has had this since #47; this one is a screen of
                its own, so it never got it. Same action: clears whatever of
                these songs is on the device, half-downloaded lists included. */}
            {hasDownloads ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  setConfirmDeleteDl(true);
                }}
              >
                <Icon name="trash-outline" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Delete downloads')}</Text>
              </Pressable>
            ) : null}
            <View style={styles.actionDivider} />
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                setDeleting(true);
              }}
            >
              <Icon name="trash-outline" size={24} color={colors.danger} />
              <Text style={[styles.actionText, { color: colors.danger }]}>{t('Delete playlist')}</Text>
            </Pressable>
          </>
        )}
      </SheetModal>

      <PlaylistEditSheet
        visible={editing}
        initial={{
          name: data.playlist.name,
          comment: data.playlist.comment ?? '',
          public: data.playlist.public ?? false,
        }}
        coverUri={coverArtUrl(data.playlist.coverArt ?? data.playlist.id, COVER.card)}
        hidePublic={offline}
        coverUploadId={!offline && auth?.serverType === 'navidrome' ? id : undefined}
        localCoverId={offline ? id : undefined}
        onCancel={() => setEditing(false)}
        onSave={onSaveEdit}
      />

      <Dialog
        visible={confirmDeleteDl}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: data.playlist.name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmDeleteDl(false)}
        onConfirm={() => {
          setConfirmDeleteDl(false);
          const files = useDownloads.getState().files;
          const ids = songIds.filter((sid) => !!files[sid]);
          void deleteSongs(ids);
          toast(t('{n} songs deleted', { n: ids.length }));
        }}
      />

      <Dialog
        visible={confirmAuto}
        title={t('Turn on auto-download?')}
        message={t('{msg} It will keep downloading songs added to this playlist later.', { msg: downloadMsg.message })}
        confirmLabel={t('Turn on')}
        onCancel={() => setConfirmAuto(false)}
        onConfirm={() => {
          setConfirmAuto(false);
          useAutoDownloads.getState().toggle(id);
          toast(t('Auto-download on'));
          // With the data in hand, not in the background: if Wi-Fi is required
          // and there's only cell data, that flow warns with its own toast.
          if (data) {
            void useAutoDownloads.getState().reconcileKnown(data.playlist, data.songs, false);
          }
        }}
      />

      <Dialog
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: data.playlist.name })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void downloadPlaylist(data.playlist, data.songs);
        }}
      />

      <Dialog
        visible={confirmRemoveDl}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: data.playlist.name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmRemoveDl(false)}
        onConfirm={() => {
          setConfirmRemoveDl(false);
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
          cancelDownload(`playlist:${id}`);
        }}
      />

      <Dialog
        visible={deleting}
        title={t('Delete “{name}”?', { name: data.playlist.name })}
        confirmLabel={t('Delete')}
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={onDelete}
      />
    </>
  );
}

const styles = themed((colors) => ({
  center: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  // On the cover viewer, which is near-black in both appearances.
  changeCover: { color: colors.onArtwork, fontSize: fontSize.md, fontWeight: '500' },
  coverError: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
}));
