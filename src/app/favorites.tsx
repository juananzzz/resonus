/** Favorites screen: starred songs, Spotify-style. */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { getStarred, starredByDate, unstar } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { SheetModal } from '@/components/SheetModal';
import { TrackListView } from '@/components/TrackListView';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { useSongSort } from '@/hooks/useSongSort';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { FAVORITES_AUTODL_ID, useAutoDownloads } from '@/store/autoDownloads';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { currentSong, SOURCE_FAVORITES, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { showUndoToast, useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed, useThemeMode } from '@/theme';

// Indigo header (Spotify's "Liked Songs" style), taken from the Favorites art's
// indigo (#450af5, see FavoritesArt) and moved into the same band
// `useDominantColor` clamps an album's tint to, so this screen's header sits
// exactly where every other one does: darkened for the dark appearance, washed
// out for the light one.
const HEADER_COLOR = { dark: '#290693', light: '#D7CDF8' };

export default function FavoritesScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  const mode = useThemeMode();
  const router = useRouter();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const hasAccount = useAuthStore((s) => !!s.auth);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const queueMany = usePlayerStore((s) => s.queueMany);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);

  // The ⋯ menu lives in a SheetModal (opening/closing doesn't re-render the screen).
  const menuRef = useRef<() => void>(() => {});

  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmDeleteDl, setConfirmDeleteDl] = useState(false);
  const [confirmRemoveDl, setConfirmRemoveDl] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  // Songs selected in selection mode pending "add to another playlist".
  const [addingSongs, setAddingSongs] = useState<Song[] | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });

  const songIds = (data?.songs ?? []).map((s) => s.id);
  // Exact, like the playlist screen's: the songs are here, so the option only
  // shows when some of them are on the device, and it says how many it removed.
  // Only whether there are any: subscribing to the map would re-render the
  // screen with every song that finishes downloading (#50).
  const hasDownloads = useDownloads((s) => songIds.some((sid) => !!s.files[sid]));
  const download = useDownloads(useShallow((s) => groupDownloadState(s, 'favorites', songIds)));
  const downloadFavorites = useDownloads((s) => s.downloadFavorites);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const downloadSongs = useDownloads((s) => s.downloadSongs);

  // Auto-download favorites: keep all starred songs downloaded, syncing on open
  // and on returning to foreground. Only with a server account (offline / local
  // profile has nothing to sync from).
  const canAutoDownload = hasAccount && !offline;
  const autoDownload = useAutoDownloads((s) => !!s.ids[FAVORITES_AUTODL_ID]);
  useEffect(() => {
    if (autoDownload && data) {
      void useAutoDownloads.getState().reconcileFavoritesKnown(data.songs, true);
    }
  }, [autoDownload, data]);
  // Stable between progress ticks (only changes with status): prevents the
  // Pressable from losing its touch when its onPress is recreated on every update.
  const onDownloadPress = useCallback(() => {
    if (download.status === 'none') setConfirmDownload(true);
    else if (download.status === 'done') setConfirmRemoveDl(true);
    else if (download.status === 'active') setConfirmStop(true);
  }, [download.status]);

  /**
   * The first order is the one the list arrives in, and here that is by when
   * each song was favorited, newest first — so it says "Recently added", the
   * name that order has on every other screen. It used to say "Recent", which
   * in this app means something else entirely: what you played or opened last
   * (the Library's own sort), and that is not what this is.
   *
   * On a server that cannot order them that way it falls back to "Default",
   * the word the playlists use for "however this list came" (see `starredByDate`).
   */
  const { songs: displaySongs, openSort, sortSheet } = useSongSort(
    data?.songs ?? [],
    'favorites',
    { labels: { recent: starredByDate() ? 'Recently added' : 'Default' } },
  );
  // Over `displaySongs`: this is what `downloadFavorites` downloads, and with a
  // filter applied it's not the same as `data.songs`.
  const downloadMsg = useDownloadMessage(displaySongs);

  /** Unstars several favorites with deferred delete and undo. */
  function removeMany(sel: Song[]) {
    if (sel.length === 0) return;
    const ids = new Set(sel.map((s) => s.id));
    // Optimistic on the central favorites list: they disappear immediately (also
    // the heart icons on rows, which read from ['starred']). The real unstar is
    // deferred until the toast expires; «Undo» cancels it.
    const prev = queryClient.getQueryData<{ songs: Song[] }>(['starred']);
    if (prev) {
      queryClient.setQueryData(['starred'], {
        ...prev,
        songs: prev.songs.filter((s) => !ids.has(s.id)),
      });
    }
    showUndoToast(
      sel.length === 1
        ? t('Removed from favorites')
        : t('{n} removed from favorites', { n: sel.length }),
      t('Undo'),
      {
        commit: () => {
          Promise.all(sel.map((s) => unstar(s.id)))
            .catch(() => useToast.getState().show(t("Couldn't complete the action")))
            .finally(() => queryClient.invalidateQueries({ queryKey: ['starred'] }));
        },
        undo: () => {
          if (prev) queryClient.setQueryData(['starred'], prev);
          else queryClient.invalidateQueries({ queryKey: ['starred'] });
        },
      },
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Only when there's nothing to show: a failed refresh with data already
  // loaded keeps the list on screen (the toast reports the failure).
  if (!data) {
    return (
      <View style={styles.center}>
        <Message text={t("Couldn't load favorites.")} onRetry={() => refetch()} />
      </View>
    );
  }

  if (displaySongs.length === 0 && offline) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="add-circle-outline"
          iconSolid
          title={t('No favorites yet')}
          subtitle={t('Tap the plus button on songs to see them here.')}
        />
      </View>
    );
  }

  const totalSec = displaySongs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const metaParts = [songsLabel(displaySongs.length, lang)];
  if (totalSec > 0) metaParts.push(formatTotalDuration(totalSec));

  return (
    <>
      <TrackListView
        title={t('Favorites')}
        meta={metaParts.join(' · ')}
        hideCover
        accentColor={HEADER_COLOR[mode]}
        songs={displaySongs}
        currentId={playing?.id}
        showArtwork={showListArtwork}
        searchable
        searchPlaceholder={t('Find in favorites')}
        onMenu={displaySongs.length > 0 ? () => menuRef.current() : undefined}
        onSort={displaySongs.length > 1 ? openSort : undefined}
        addAction={{ label: t('Add to favorites'), onPress: () => router.push('/favorites-add') }}
        download={
          !offline && displaySongs.length > 0
            ? { ...download, onPress: onDownloadPress }
            : undefined
        }
        selection={{
          // No favouriting entries in the ⋯ menu: here "Remove" already is it.
          favorites: false,
          onRemove: (sel) => removeMany(sel),
          onAddTo: (sel) => setAddingSongs(sel),
          onDownload: !offline
            ? (sel) => {
                void downloadSongs(sel);
                toast(t('Downloading…'));
              }
            : undefined,
        }}
        onPlay={(start, opts) => playQueue(displaySongs, start, SOURCE_FAVORITES, '/favorites', opts)}
      />
      <PlaylistPickerSheet songs={addingSongs} onClose={() => setAddingSongs(null)} />
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
            {canAutoDownload ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  const wasOn = !!useAutoDownloads.getState().ids[FAVORITES_AUTODL_ID];
                  useAutoDownloads.getState().toggle(FAVORITES_AUTODL_ID);
                  if (wasOn) {
                    toast(t('Auto-download off'));
                  } else {
                    toast(t('Auto-download on'));
                    // Download now with data in hand (not in background: if
                    // Wi-Fi is required and there's cell data, the flow warns
                    // with its own toast).
                    if (data) {
                      void useAutoDownloads.getState().reconcileFavoritesKnown(data.songs, false);
                    }
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
            {/* Same bulk delete albums and playlists have: clears whatever of
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
          </>
        )}
      </SheetModal>

      <Dialog
        visible={confirmDeleteDl}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: t('Favorites') })}
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
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: t('Favorites') })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void downloadFavorites(displaySongs);
        }}
      />

      <Dialog
        visible={confirmRemoveDl}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: t('Favorites') })}
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
          cancelDownload('favorites');
        }}
      />
    </>
  );
}

const styles = themed((colors) => ({
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
