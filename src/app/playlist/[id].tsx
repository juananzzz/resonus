/** Detalle de una lista de reproducción con sus canciones. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import {
  coverArtUrl,
  deletePlaylist,
  getPlaylist,
  removeFromPlaylist,
  reorderPlaylist,
  updatePlaylist,
} from '@/api/data';
import { type Song } from '@/api/subsonic';
import { CoverViewer } from '@/components/CoverViewer';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { PlaylistEditSheet, type PlaylistEdit } from '@/components/PlaylistEditSheet';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { PlaylistReorder } from '@/components/PlaylistReorder';
import { SheetModal } from '@/components/SheetModal';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackListView } from '@/components/TrackListView';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { usePlaylistCover } from '@/hooks/usePlaylistCover';
import { useSongSort } from '@/hooks/useSongSort';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { useAutoDownloads } from '@/store/autoDownloads';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { showUndoToast, useToast } from '@/store/toast';
import { colors, fontSize, spacing } from '@/theme';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  // El menú ⋯ vive en un SheetModal (abrir/cerrar no re-renderiza la pantalla).
  const menuRef = useRef<() => void>(() => {});
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmRemoveDl, setConfirmRemoveDl] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  // Canciones marcadas en el modo selección pendientes de "añadir a otra".
  const [addingSongs, setAddingSongs] = useState<Song[] | null>(null);

  // Cambiar la carátula desde el visor ampliado (estilo Spotify). Mismas
  // condiciones que en la hoja de edición: Navidrome en servidor, o perfil local.
  const coverChange = usePlaylistCover({
    coverUploadId: !offline && auth?.serverType === 'navidrome' ? id : undefined,
    localCoverId: offline ? id : undefined,
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => getPlaylist(id),
    enabled: (!!auth || offline) && !!id,
  });

  const songIds = (data?.songs ?? []).map((s) => s.id);
  const downloadMsg = useDownloadMessage(data?.songs ?? []);
  const download = useDownloads(
    useShallow((s) => groupDownloadState(s, `playlist:${id}`, songIds)),
  );
  const downloadPlaylist = useDownloads((s) => s.downloadPlaylist);
  // Auto-descarga: solo tiene sentido en playlists de servidor (no en el perfil
  // local ni en las playlists locales `dl_` que ya son el espejo de descargas).
  const canAutoDownload = !!auth && !id.startsWith('dl_');
  const autoDownload = useAutoDownloads((s) => !!s.ids[id]);
  // Al abrir/refrescar la playlist marcada, reconcilia con lo que ya tenemos en
  // mano (sin re-pedir): descarga lo que falte, pilla cambios de otros clientes.
  useEffect(() => {
    if (autoDownload && data) {
      void useAutoDownloads.getState().reconcileKnown(data.playlist, data.songs, true);
    }
  }, [autoDownload, data]);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  // Estable entre ticks de progreso (solo cambia con el estado): evita que el
  // Pressable pierda el toque al recrearse su onPress con cada actualización.
  const onDownloadPress = useCallback(() => {
    if (download.status === 'none') setConfirmDownload(true);
    else if (download.status === 'done') setConfirmRemoveDl(true);
    else if (download.status === 'active') setConfirmStop(true);
  }, [download.status]);

  // En playlists 'recent' = orden guardado en el servidor = orden manual, así
  // que se etiqueta "Personalizado"; 'added' = orden de adición ("Recientes").
  const {
    songs: displaySongs,
    indices: playlistIndices,
    openSort,
    sortSheet,
    setSort,
  } = useSongSort(data?.songs ?? [], `playlist:${id}`, {
    fields: ['recent', 'added', 'alpha', 'artist', 'album', 'downloaded'],
    labels: { recent: 'Custom', added: 'Recent' },
    // Como Spotify: por defecto "Personalizado" (el orden manual de la lista,
    // lo nuevo se añade abajo); "Recientes" pone lo último añadido arriba.
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
    // Optimista: desaparece de la lista y salimos de la pantalla; el borrado
    // real se difiere hasta que caduca el toast. «Deshacer» lo cancela (el
    // servidor no llegó a enterarse).
    const prev = queryClient.getQueryData<{ id: string }[]>(['playlists']);
    if (prev) {
      queryClient.setQueryData(['playlists'], prev.filter((p) => p.id !== id));
    }
    router.back();
    showUndoToast(t('Playlist deleted'), t('Undo'), {
      commit: () => {
        deletePlaylist(id)
          .then(() => queryClient.invalidateQueries({ queryKey: ['playlists'] }))
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

  /** Guarda el nuevo orden (optimista) y lo reescribe en el servidor. */
  async function onReorderSave(songIds: string[]) {
    setReordering(false);
    // La vista vuelve al orden manual para que se vea el cambio recién hecho.
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

  /** Reordenar disponible en servidores Subsonic y en local (Jellyfin no). */
  const canReorder =
    (data?.songs.length ?? 0) > 1 && (offline || (!!auth && auth.serverType !== 'jellyfin'));

  /** Quita varias canciones (índices reales) con borrado diferido y deshacer. */
  function removeMany(indices: number[]) {
    if ((!auth && !offline) || indices.length === 0) return;
    const key = ['playlist', id];
    const drop = new Set(indices);
    // Optimista: desaparecen ya de la vista; el borrado real se difiere hasta
    // que caduca el toast. «Deshacer» lo cancela y las restaura en su sitio.
    const prev = queryClient.getQueryData<{ playlist: unknown; songs: Song[] }>(key);
    // Conteo optimista en la Biblioteca ('{n} canciones'): sin esto el subtítulo
    // de la lista no cambia hasta recargar esa pantalla.
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
              // Reescribimos la lista al estado final (la original menos las
              // quitadas) en vez de quitar por índice: es un "set", idéntico
              // online y offline, así que no hay desfase de índices ni doble
              // borrado si el commit diferido cae ya en modo offline. Si el
              // resultado es vaciar la lista, el método por índice es lo probado.
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

  // El reorden trabaja siempre sobre el orden manual (crudo del servidor),
  // no sobre la vista ordenada por A-Z/fecha.
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
        meta={metaParts.join(' · ')}
        coverUri={coverArtUrl(data.playlist.coverArt ?? data.playlist.id, 500)}
        onCoverPress={
          data.playlist.coverArt || data.songs.length > 0 ? () => setCoverOpen(true) : undefined
        }
        songs={displaySongs}
        playlistIndices={playlistIndices}
        currentId={playing?.id}
        onMenu={() => menuRef.current()}
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
        onPlay={(start) => playQueue(displaySongs, start, data.playlist.name, `/playlist/${id}`)}
      />
      <PlaylistPickerSheet
        songs={addingSongs}
        excludeId={id}
        onClose={() => setAddingSongs(null)}
      />
      <CoverViewer
        visible={coverOpen}
        uri={coverChange.pickedUri ?? coverArtUrl(data.playlist.coverArt ?? data.playlist.id, 1200)}
        onClose={() => setCoverOpen(false)}
        footer={
          coverChange.enabled ? (
            <>
              {coverChange.uploading ? (
                <ActivityIndicator color={colors.text} />
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
                // En el orden visible (respeta el orden elegido con ⇅).
                for (const s of displaySongs) addToQueue(s);
                toast(t('Added to queue'));
              }}
            >
              <Ionicons name="list" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Add to queue')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                if (displaySongs.length > 0) setAddingSongs(displaySongs);
              }}
            >
              <Ionicons name="add" size={24} color={colors.text} />
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
                <Ionicons name="swap-vertical" size={24} color={colors.text} />
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
              <Ionicons name="create-outline" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Edit playlist')}</Text>
            </Pressable>
            {canAutoDownload ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  const wasOn = !!useAutoDownloads.getState().ids[id];
                  useAutoDownloads.getState().toggle(id);
                  if (wasOn) {
                    toast(t('Auto-download off'));
                  } else {
                    toast(t('Auto-download on'));
                    // Descarga ya con los datos en mano (no en 2º plano: si toca
                    // Wi-Fi y hay datos, el flujo avisa con su toast).
                    if (data) {
                      void useAutoDownloads
                        .getState()
                        .reconcileKnown(data.playlist, data.songs, false);
                    }
                  }
                }}
              >
                <Ionicons
                  name={autoDownload ? 'cloud-done' : 'cloud-download-outline'}
                  size={24}
                  color={autoDownload ? colors.accent : colors.text}
                />
                <Text style={[styles.actionText, autoDownload && { color: colors.accent }]}>
                  {t('Auto-download')}
                </Text>
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
              <Ionicons name="trash-outline" size={24} color={colors.danger} />
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
        coverUri={coverArtUrl(data.playlist.coverArt ?? data.playlist.id, 500)}
        hidePublic={offline}
        coverUploadId={!offline && auth?.serverType === 'navidrome' ? id : undefined}
        localCoverId={offline ? id : undefined}
        onCancel={() => setEditing(false)}
        onSave={onSaveEdit}
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

const styles = StyleSheet.create({
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
  changeCover: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  coverError: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
