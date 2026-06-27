/** Detalle de una lista de reproducción con sus canciones. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coverArtUrl, deletePlaylist, getPlaylist, renamePlaylist } from '@/api/data';
import { Dialog } from '@/components/Dialog';
import { Message } from '@/components/Message';
import { TrackListView } from '@/components/TrackListView';
import { useSongSort } from '@/hooks/useSongSort';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing } from '@/theme';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => getPlaylist(id),
    enabled: !!auth && !!id,
  });

  const { songs: displaySongs, indices: playlistIndices, openSort, sortSheet } = useSongSort(
    data?.songs ?? [],
  );

  async function onRename(name: string) {
    setRenaming(false);
    if (!auth) return;
    try {
      await renamePlaylist(id, name);
      queryClient.invalidateQueries({ queryKey: ['playlist', id] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Playlist renamed'));
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  async function onDelete() {
    setDeleting(false);
    if (!auth) return;
    try {
      await deletePlaylist(id);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Playlist deleted'));
      router.back();
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.center}>
        <Message
          text={offline ? t('Playlists are not available in offline mode.') : t("Couldn't load the playlist.")}
          onRetry={offline ? undefined : () => refetch()}
        />
      </View>
    );
  }

  const totalSec = data.songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const metaParts = [t('Playlist'), songsLabel(data.songs.length, lang)];
  if (totalSec > 0) metaParts.push(formatTotalDuration(totalSec));

  return (
    <>
      <TrackListView
        title={data.playlist.name}
        meta={metaParts.join(' · ')}
        coverUri={coverArtUrl(data.playlist.coverArt ?? data.playlist.id, 500)}
        songs={displaySongs}
        playlistIndices={playlistIndices}
        currentId={playing?.id}
        onMenu={() => setMenuOpen(true)}
        playlistId={id}
        onSort={data.songs.length > 1 ? openSort : undefined}
        onPlay={(start) => playQueue(displaySongs, start, data.playlist.name, `/playlist/${id}`)}
      />
      {sortSheet}

      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              setMenuOpen(false);
              setRenaming(true);
            }}
          >
            <Ionicons name="create-outline" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Rename')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              setMenuOpen(false);
              setDeleting(true);
            }}
          >
            <Ionicons name="trash-outline" size={24} color={colors.danger} />
            <Text style={[styles.actionText, { color: colors.danger }]}>{t('Delete playlist')}</Text>
          </Pressable>
        </View>
      </Modal>

      <Dialog
        visible={renaming}
        title={t('Rename playlist')}
        input={{ initialValue: data.playlist.name, placeholder: t('Playlist name') }}
        confirmLabel={t('Rename')}
        onCancel={() => setRenaming(false)}
        onConfirm={onRename}
      />

      <Dialog
        visible={deleting}
        title={t('Delete “{name}”?', { name: data.playlist.name })}
        message={t("This can't be undone.")}
        confirmLabel={t('Delete')}
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={onDelete}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
});
