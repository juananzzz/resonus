/**
 * Bottom sheet with quick actions for an album or playlist (opened via
 * long-press on its cards/rows): play, shuffle, queue, download, and
 * favorite, without entering the screen. Songs are fetched when the action
 * is chosen (same query the screen uses, so cache is shared).
 */
import Icon from '@/components/Icon';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COVER, coverArtUrl, getAlbum, getPlaylist, star, unstar, type Song } from '@/api/data';
import { useAlbumDownloads } from '@/hooks/useAlbumDownloads';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useCanShare } from '@/hooks/useCanShare';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { songsLabel, useT } from '@/i18n';
import { artistTargets } from '@/lib/artistNav';
import { exportManyToFolder, totalBytes } from '@/lib/exportSong';
import { formatBytes } from '@/lib/format';
import { pickFolder } from '@/lib/localLibrary';
import { queryClient } from '@/lib/query';
import { canShareResonusLink, shareResonusLink } from '@/lib/shareLink';
import { useArtistPicker } from '@/store/artistPicker';
import { useAuthStore } from '@/store/auth';
import { anyDownloads, useDownloads } from '@/store/downloads';
import { useMediaMenu, type MediaMenuItem } from '@/store/mediaMenu';
import { MAX_PINS, usePins } from '@/store/pins';
import { usePlayerStore } from '@/store/player';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useSharePicker } from '@/store/sharePicker';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';

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

/** Album/playlist songs, sharing cache with its screen. */
async function fetchSongs(item: MediaMenuItem): Promise<Song[]> {
  if (item.kind === 'album') {
    const data = await queryClient.fetchQuery({
      queryKey: ['album', item.album.id],
      queryFn: () => getAlbum(item.album.id),
    });
    return data.songs;
  }
  const data = await queryClient.fetchQuery({
    queryKey: ['playlist', item.playlist.id],
    queryFn: () => getPlaylist(item.playlist.id),
  });
  return data.songs;
}

export function MediaMenuSheet() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);
  const offline = useAuthStore((s) => s.offline);
  const item = useMediaMenu((s) => s.item);
  const closeNow = useMediaMenu((s) => s.close);
  const { dismiss, pan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    !!item,
    closeNow,
  );
  const pins = usePins((s) => s.pins);
  const togglePin = usePins((s) => s.toggle);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const queueMany = usePlayerStore((s) => s.queueMany);
  const router = useRouter();
  const openArtistPicker = useArtistPicker((s) => s.open);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Songs gathered for the download dialog (its size needs them). */
  const [pending, setPending] = useState<Song[] | null>(null);
  /** The downloaded songs and what they weigh, for the export question. */
  const [pendingExport, setPendingExport] = useState<{ songs: Song[]; bytes: number } | null>(
    null,
  );
  const downloadMsg = useDownloadMessage(pending ?? []);
  const downloadAlbum = useDownloads((s) => s.downloadAlbum);
  const downloadPlaylist = useDownloads((s) => s.downloadPlaylist);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const files = useDownloads((s) => s.files);
  const canShare = useCanShare();
  // Before the early return: hooks can't be conditional. For an album this is
  // exact; a playlist can't be answered without fetching its songs, so there
  // it stays on "the profile has downloads" and its own screen, which does
  // have the songs, decides properly.
  const albumHasDownloads = useAlbumDownloads(
    item?.kind === 'album' ? item.album.id : undefined,
  );
  const hasDownloads =
    item?.kind === 'album' ? albumHasDownloads : anyDownloads({ files });

  if (!item) return null;

  const close = () => dismiss(closeNow);
  const album = item.kind === 'album' ? item.album : null;
  const playlist = item.kind === 'playlist' ? item.playlist : null;
  const name = album ? album.name : playlist!.name;
  const subtitle = album ? album.artist : songsLabel(playlist!.songCount ?? 0, lang);
  const coverId = album ? (album.coverArt ?? album.id) : (playlist!.coverArt ?? playlist!.id);
  const href = album ? `/album/${album.id}` : `/playlist/${playlist!.id}`;
  const pinKey = album ? `album:${album.id}` : `playlist:${playlist!.id}`;
  const pinned = !!pins[pinKey];
  const extraActions = item.kind === 'album' ? item.extraActions ?? [] : [];

  /** Fetches the songs WITHOUT closing, so the dialog has a size to show.
   *  They usually come from the cache: same query key the screens use. */
  async function askDownload() {
    try {
      const songs = await fetchSongs(item!);
      if (songs.length > 0) setPending(songs);
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  /**
   * Gathers what can actually be exported, WITHOUT closing: the question that
   * follows needs the count and the size, and only the downloaded songs are
   * going anywhere. What is not on the phone is not offered as if it were
   * (#57).
   */
  async function askExport() {
    try {
      const songs = (await fetchSongs(item!)).filter((s) => files[s.id]);
      if (songs.length === 0) {
        toast(t('Nothing here is downloaded'));
        close();
        return;
      }
      setPendingExport({ songs, bytes: totalBytes(songs.map((s) => files[s.id])) });
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  /** Copies them into a folder of their own, and says how many made it. */
  async function runExport(songs: Song[]) {
    closeNow();
    const folder = await pickFolder();
    if (!folder) return;
    toast(t('Exporting…'));
    const items = songs.map((s) => ({ song: s, uri: files[s.id] }));
    const { saved, failed } = await exportManyToFolder(items, folder, name);
    toast(
      failed > 0
        ? t('{n} of {m} songs exported', { n: saved, m: songs.length })
        : t('{n} songs exported', { n: saved }),
    );
  }

  /** Closes, fetches the songs, and runs the action (with toast on failure). */
  async function withSongs(fn: (songs: Song[]) => void) {
    close();
    try {
      const songs = await fetchSongs(item!);
      if (songs.length > 0) fn(songs);
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  async function toggleFavorite() {
    if (!album) return;
    close();
    try {
      if (album.starred) {
        await unstar(album.id, 'album');
        // Without favorite the album no longer appears in the Library, so its
        // pin would be orphaned taking up a slot: we release it on unfavorite.
        if (pins[pinKey]) togglePin(pinKey);
        toast(t('Removed from favorites'));
      } else {
        await star(album.id, 'album');
        toast(t('Added to favorites'));
      }
      void queryClient.invalidateQueries({ queryKey: ['starred'] });
      void queryClient.invalidateQueries({ queryKey: ['album', album.id] });
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      {/* Gestures inside an RN Modal need a root view of their own: the
          Modal renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        {/* One drag around the whole sheet: this list of actions never
            scrolls, so nothing else competes for the gesture. */}
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
            onLayout={onSheetLayout}
          >
            {/* Spotify-style grabber: the visual cue that the sheet can be
                dragged down to dismiss. */}
            <View style={styles.grabber} />
            <View style={styles.headerRow}>
              <Cover uri={coverArtUrl(coverId, COVER.thumb)} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {name}
                </Text>
                {subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.divider} />

            <Action
              icon="play-outline"
              label={t('Play')}
              onPress={() => withSongs((songs) => void playQueue(songs, 0, name, href))}
            />
            <Action
              icon="shuffle-outline"
              label={t('Shuffle')}
              onPress={() =>
                withSongs((songs) => {
                  // Same as the screen buttons: the queue comes out dealt and
                  // the shuffle mode stays as it was.
                  void playQueue(songs, 0, name, href, { shuffled: true });
                })
              }
            />
            {extraActions.map((action) => (
              <Action
                key={action.label}
                icon={action.icon}
                label={action.label}
                onPress={() => {
                  close();
                  void Promise.resolve(action.onPress()).catch(() => {
                    toast(t("Couldn't complete the action"));
                  });
                }}
              />
            ))}
            <Action
              icon="play-forward-outline"
              label={t('Play next')}
              onPress={() =>
                withSongs((songs) => {
                  queueMany(songs, 'next');
                  toast(t('Playing next'));
                })
              }
            />
            <Action
              icon="list-outline"
              label={t('Add to queue')}
              onPress={() =>
                withSongs((songs) => {
                  queueMany(songs, 'end');
                  toast(t('Added to queue'));
                })
              }
            />
            <Action
              icon="add-outline"
              label={t('Add to a playlist')}
              onPress={() => withSongs((songs) => usePlaylistPicker.getState().open(songs))}
            />
            {!offline ? (
              <Action
                icon="download-outline"
                label={t('Download')}
                // Asks with the size, like the button on the album's own screen:
                // the same action shouldn't warn down one path and not the other.
                onPress={() => void askDownload()}
              />
            ) : null}
            {/* What is downloaded is what can be exported, and whether these
                songs are among this profile's downloads takes fetching them,
                which is what the press does. */}
            {hasDownloads ? (
              <Action icon="save-outline" label={t('Export')} onPress={() => void askExport()} />
            ) : null}
            {/* Moved here from the header row, which had grown to four icons for
                something used now and then. Covers the long press on a card too,
                which never had it. */}
            {canShare ? (
              <Action
                icon="share-social-outline"
                label={t('Share')}
                onPress={() => {
                  dismiss(() => {
                    closeNow();
                    useSharePicker.getState().open({ id: album ? album.id : playlist!.id, name });
                  });
                }}
              />
            ) : null}
            {/* For another Resonus user on the same server (#176). A private
                playlist would open for nobody else, and one made offline has
                no id on the server yet. */}
            {canShareResonusLink() &&
            (album || (playlist!.public !== false && !playlist!.id.startsWith('tmp_'))) ? (
              <Action
                icon="link-outline"
                label={t('Share Resonus link')}
                onPress={() => {
                  close();
                  void shareResonusLink(
                    album
                      ? { kind: 'album', id: album.id, name, artist: album.artist }
                      : { kind: 'playlist', id: playlist!.id, name },
                  );
                }}
              />
            ) : null}
            {/* Albums only: a playlist is nobody's. The song menu has had this
                since always and an album is the one thing on screen that names
                an artist without offering a way to them. */}
            {album && artistTargets(album).length > 0 ? (
              <Action
                icon="person-outline"
                label={t('Go to artist')}
                onPress={() => {
                  const targets = artistTargets(album);
                  if (targets.length > 1) {
                    // The sheet goes first and the picker opens after its exit
                    // animation: two Modals visible at once is the thing to
                    // avoid, same as in the song menu.
                    dismiss(() => {
                      closeNow();
                      openArtistPicker(targets);
                    });
                    return;
                  }
                  dismiss(() => {
                    closeNow();
                    router.push(`/artist/${targets[0].id}`);
                  });
                }}
              />
            ) : null}
            {album ? (
              <Action
                icon={album.starred ? 'heart' : 'heart-outline'}
                label={album.starred ? t('Remove from favorites') : t('Add to favorites')}
                onPress={() => void toggleFavorite()}
              />
            ) : null}
            {/* Only makes sense if the item can
                appear in the Library: playlists always do, but albums only if
                favorited (the list comes from getStarred). */}
            {playlist || album?.starred ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  const ok = togglePin(pinKey);
                  close();
                  if (!ok) toast(t('You can pin up to {n} items.', { n: MAX_PINS }));
                }}
              >
                <Icon
                  name={pinned ? 'pin' : 'pin-outline'}
                  size={24}
                  color={colors.text}
                />
                <Text style={styles.actionText}>{pinned ? t('Unpin') : t('Pin to top')}</Text>
              </Pressable>
            ) : null}
            {/* Last, because it is the only thing here that takes something
                away, but not in red: the files come back with one tap and red
                is kept for what does not, like deleting a playlist itself.

                The header button on an album's own screen only turns into
                "delete" once EVERYTHING is downloaded, and offline there is no
                header button at all — so a half-downloaded album could only be
                cleared song by song (#47). For an album `hasDownloads` is about
                this album; for a playlist, whose songs are not known without
                fetching them, it is only about the profile. */}
            {hasDownloads ? (
              <Action
                icon="trash-outline"
                label={t('Delete downloads')}
                onPress={() => setConfirmDelete(true)}
              />
            ) : null}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>

      {/* Over the sheet, which stays open behind it: closing it would take the
          dialog with it. How many of these songs are actually downloaded takes
          fetching them, so the question is asked before, not after. */}
      <Dialog
        visible={!!pending}
        title={t('Download “{name}”?', { name })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const songs = pending ?? [];
          setPending(null);
          close();
          if (album) void downloadAlbum(album, songs);
          else void downloadPlaylist(playlist!, songs);
          toast(t('Downloading…'));
        }}
      />

      {/* Asked before the folder picker, not after: the size is the part worth
          knowing while there is still nothing to undo. */}
      <Dialog
        visible={!!pendingExport}
        title={t('Export “{name}”?', { name })}
        message={
          pendingExport
            ? t('{n} songs, {size}, copied into a folder of their own.', {
                n: pendingExport.songs.length,
                size: formatBytes(pendingExport.bytes),
              })
            : undefined
        }
        confirmLabel={t('Export')}
        onCancel={() => setPendingExport(null)}
        onConfirm={() => {
          const songs = pendingExport?.songs ?? [];
          setPendingExport(null);
          void runExport(songs);
        }}
      />

      <Dialog
        visible={confirmDelete}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void withSongs((songs) => {
            const ids = songs.filter((s) => files[s.id]).map((s) => s.id);
            if (ids.length === 0) {
              toast(t('Nothing here is downloaded'));
              return;
            }
            void deleteSongs(ids);
            toast(t('{n} songs deleted', { n: ids.length }));
          });
        }}
      />
    </Modal>
  );
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    // Smaller than the old spacing.lg because the grabber below already brings
    // its own margin: together they add up to the same top gap as before.
    paddingTop: spacing.sm,
  },
  // Spotify's little handle. Its only job is to advertise the drag gesture, so
  // it stays discreet: it must read as an affordance, not as a control.
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  // The MCI pin comes vertical; rotated 45° it looks like Spotify's.
}));
