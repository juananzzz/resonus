/**
 * Hoja inferior para elegir una playlist destino y añadirle canciones en lote
 * (selección múltiple). Permite crear una playlist nueva. Hace el añadido y
 * los toasts ella misma, para reutilizarla desde cualquier pantalla.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addToPlaylist, coverArtUrl, createPlaylist, getPlaylist, getPlaylists } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { useAutoDownloads } from '@/store/autoDownloads';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';

/** Alto máximo de la lista de playlists: proporcional a la pantalla para que
 *  no quede compacta en móviles grandes (antes era un fijo de 400). */
const PLAYLISTS_MAX_H = Math.round(Dimensions.get('window').height * 0.6);

/** Instancia global (montada una vez en el layout raíz): la abre cualquier sitio
 *  vía `usePlaylistPicker.open(songs)` sin renderizar su propia hoja. */
export function GlobalPlaylistPicker() {
  const songs = usePlaylistPicker((s) => s.songs);
  const close = usePlaylistPicker((s) => s.close);
  return <PlaylistPickerSheet songs={songs} onClose={close} />;
}


export function PlaylistPickerSheet({
  songs,
  excludeId,
  onClose,
}: {
  /** Canciones a añadir; null = hoja oculta. */
  songs: Song[] | null;
  /** Playlist a ocultar de la lista (la de origen). */
  excludeId?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const t = useT();
  const visible = !!songs && songs.length > 0;
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(visible);
  const close = () => dismiss(onClose);
  const [creating, setCreating] = useState(false);
  // Aviso "ya está(n) en la playlist" pendiente de confirmar (estilo Spotify).
  const [dupPrompt, setDupPrompt] = useState<{ playlistId: string; name: string } | null>(null);

  const { data: playlists, isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: visible,
  });

  if (!songs || songs.length === 0) return null;

  /** Añade de verdad (sin comprobar duplicados) y cierra con toast. */
  async function doAdd(playlistId: string, name: string) {
    if (!songs) return;
    close();
    try {
      for (const s of songs) await addToPlaylist(playlistId, s.id);
      // Conteo optimista en la Biblioteca ('{n} canciones'): sin esto el
      // subtítulo no cambia hasta recargar esa pantalla.
      queryClient.setQueryData<{ id: string; songCount?: number }[]>(['playlists'], (list) =>
        list?.map((p) =>
          p.id === playlistId ? { ...p, songCount: (p.songCount ?? 0) + songs.length } : p,
        ),
      );
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      // Si la lista es de auto-descarga, baja ya las canciones recién añadidas.
      void useAutoDownloads.getState().reconcile(playlistId, true);
      toast(
        songs.length === 1
          ? t('Added to “{name}”', { name })
          : t('{n} added to “{name}”', { n: songs.length, name }),
      );
    } catch {
      toast(t("Couldn't add to the playlist"));
    }
  }

  async function addAllTo(playlistId: string, name: string) {
    if (!songs) return;
    // Aviso de duplicados estilo Spotify: si alguna ya está, preguntar antes.
    // Si la comprobación falla (red), se añade sin aviso: mejor que bloquear.
    try {
      const { songs: existing } = await getPlaylist(playlistId);
      const have = new Set(existing.map((s) => s.id));
      if (songs.some((s) => have.has(s.id))) {
        setDupPrompt({ playlistId, name });
        return;
      }
    } catch {
      // ignore
    }
    await doAdd(playlistId, name);
  }

  async function createAndAdd(name: string) {
    setCreating(false);
    if (!name.trim()) return;
    try {
      const id = await createPlaylist(name.trim());
      await addAllTo(id, name.trim());
    } catch {
      close();
      toast(t("Couldn't create the playlist"));
    }
  }

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
        onLayout={onSheetLayout}
      >
        <Text style={styles.title}>{t('Add to a playlist')}</Text>
        <View style={styles.divider} />
        <View style={{ maxHeight: PLAYLISTS_MAX_H }}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            onPress={() => setCreating(true)}
          >
            <View style={styles.newPlaylistIcon}>
              <Ionicons name="add" size={24} color={colors.text} />
            </View>
            <Text style={styles.rowText}>{t('New playlist')}</Text>
          </Pressable>
          {isLoading ? (
            <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
          ) : (
            <ScrollView>
              {(playlists ?? [])
                .filter((p) => p.id !== excludeId)
                .map((p) => (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                    onPress={() => addAllTo(p.id, p.name)}
                  >
                    <Cover uri={coverArtUrl(p.coverArt ?? p.id, 100)} size={40} />
                    <Text style={styles.rowText} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          )}
        </View>
      </Animated.View>

      <Dialog
        visible={creating}
        title={t('New playlist')}
        input={{ placeholder: t('Playlist name') }}
        confirmLabel={t('Create')}
        onCancel={() => setCreating(false)}
        onConfirm={createAndAdd}
      />

      <Dialog
        visible={!!dupPrompt}
        title={t('Already added')}
        message={
          dupPrompt
            ? songs.length === 1
              ? t('This song is already in “{name}”.', { name: dupPrompt.name })
              : t('Some of these songs are already in “{name}”.', { name: dupPrompt.name })
            : undefined
        }
        confirmLabel={t('Add anyway')}
        onCancel={() => setDupPrompt(null)}
        onConfirm={() => {
          const d = dupPrompt;
          setDupPrompt(null);
          if (d) void doAdd(d.playlistId, d.name);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', paddingBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  newPlaylistIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
