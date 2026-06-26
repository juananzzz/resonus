/** Detalle de una lista de reproducción con sus canciones. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  deletePlaylist,
  getPlaylist,
  renamePlaylist,
} from '@/api/subsonic';
import { Dialog } from '@/components/Dialog';
import { Message } from '@/components/Message';
import { TrackListView } from '@/components/TrackListView';
import { songsLabel, useT } from '@/i18n';
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
    queryFn: () => getPlaylist(auth!, id),
    enabled: !!auth && !!id,
  });

  async function onRename(name: string) {
    setRenaming(false);
    if (!auth) return;
    try {
      await renamePlaylist(auth, id, name);
      queryClient.invalidateQueries({ queryKey: ['playlist', id] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Lista renombrada'));
    } catch {
      toast(t('No se pudo completar la acción'));
    }
  }

  async function onDelete() {
    setDeleting(false);
    if (!auth) return;
    try {
      await deletePlaylist(auth, id);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Lista eliminada'));
      router.back();
    } catch {
      toast(t('No se pudo completar la acción'));
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
        <Message text={t('No se pudo cargar la lista.')} onRetry={() => refetch()} />
      </View>
    );
  }

  return (
    <>
      <TrackListView
        title={data.playlist.name}
        subtitle={songsLabel(data.songs.length, lang)}
        coverUri={coverArtUrl(auth!, data.playlist.coverArt ?? data.playlist.id, 500)}
        songs={data.songs}
        currentId={playing?.id}
        onMenu={() => setMenuOpen(true)}
        playlistId={id}
        onPlay={(start) => playQueue(data.songs, start)}
      />

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
            <Text style={styles.actionText}>{t('Renombrar')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              setMenuOpen(false);
              setDeleting(true);
            }}
          >
            <Ionicons name="trash-outline" size={24} color={colors.danger} />
            <Text style={[styles.actionText, { color: colors.danger }]}>
              {t('Eliminar lista')}
            </Text>
          </Pressable>
        </View>
      </Modal>

      <Dialog
        visible={renaming}
        title={t('Renombrar lista')}
        input={{ initialValue: data.playlist.name, placeholder: t('Nombre de la lista') }}
        confirmLabel={t('Renombrar')}
        onCancel={() => setRenaming(false)}
        onConfirm={onRename}
      />

      <Dialog
        visible={deleting}
        title={t('¿Eliminar «{name}»?', { name: data.playlist.name })}
        message={t('Esta acción no se puede deshacer.')}
        confirmLabel={t('Eliminar')}
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
