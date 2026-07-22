/**
 * Hoja inferior con acciones rápidas para un álbum o playlist (se abre con
 * long-press en sus tarjetas/filas): reproducir, aleatorio, a la cola,
 * descargar y favorito, sin entrar a la pantalla. Las canciones se piden al
 * elegir la acción (misma query que usa la pantalla, así se comparte caché).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coverArtUrl, getAlbum, getPlaylist, star, unstar, type Song } from '@/api/data';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { queryClient } from '@/lib/query';
import { songsLabel, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useMediaMenu, type MediaMenuItem } from '@/store/mediaMenu';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { MAX_PINS, usePins } from '@/store/pins';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';

function Action({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={24} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

/** Canciones del álbum/playlist, compartiendo caché con su pantalla. */
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
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(!!item);
  const pins = usePins((s) => s.pins);
  const togglePin = usePins((s) => s.toggle);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const downloadAlbum = useDownloads((s) => s.downloadAlbum);
  const downloadPlaylist = useDownloads((s) => s.downloadPlaylist);

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

  /** Cierra, pide las canciones y ejecuta la acción (con toast si falla). */
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
        // Sin favorito el álbum ya no aparece en la Biblioteca, así que su pin
        // quedaría huérfano ocupando un slot: lo soltamos al desfavoritar.
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
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
        onLayout={onSheetLayout}
      >
        <View style={styles.headerRow}>
          <Cover uri={coverArtUrl(coverId, 100)} size={48} />
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
          icon="play"
          label={t('Play')}
          onPress={() => withSongs((songs) => void playQueue(songs, 0, name, href))}
        />
        <Action
          icon="shuffle"
          label={t('Shuffle')}
          onPress={() =>
            withSongs((songs) => {
              // Igual que el botón de las pantallas: pista inicial al azar y
              // modo aleatorio activo (playQueue lo resetea, de ahí el orden).
              void playQueue(songs, Math.floor(Math.random() * songs.length), name, href);
              if (!usePlayerStore.getState().shuffle) usePlayerStore.getState().toggleShuffle();
            })
          }
        />
        <Action
          icon="list"
          label={t('Add to queue')}
          onPress={() =>
            withSongs((songs) => {
              for (const song of songs) addToQueue(song);
              toast(t('Added to queue'));
            })
          }
        />
        <Action
          icon="add"
          label={t('Add to a playlist')}
          onPress={() => withSongs((songs) => usePlaylistPicker.getState().open(songs))}
        />
        {!offline ? (
          <Action
            icon="download-outline"
            label={t('Download')}
            onPress={() =>
              withSongs((songs) => {
                if (album) void downloadAlbum(album, songs);
                else void downloadPlaylist(playlist!, songs);
                toast(t('Downloading…'));
              })
            }
          />
        ) : null}
        {album ? (
          <Action
            icon={album.starred ? 'heart' : 'heart-outline'}
            label={album.starred ? t('Remove from favorites') : t('Add to favorites')}
            onPress={() => void toggleFavorite()}
          />
        ) : null}
        {/* Chincheta diagonal (MaterialCommunity), como la de Spotify; la de
            Ionicons es otra cosa y queda rara. Solo tiene sentido si el ítem
            puede aparecer en la Biblioteca: las playlists siempre salen, pero
            los álbumes solo si son favoritos (la lista viene de getStarred). */}
        {playlist || album?.starred ? (
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              const ok = togglePin(pinKey);
              close();
              if (!ok) toast(t('You can pin up to {n} items.', { n: MAX_PINS }));
            }}
          >
            <MaterialCommunityIcons
              name={pinned ? 'pin' : 'pin-outline'}
              size={24}
              color={colors.text}
              style={styles.pinIcon}
            />
            <Text style={styles.actionText}>{pinned ? t('Unpin') : t('Pin to top')}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
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
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
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
  // La chincheta de MCI viene vertical; girada 45° queda como la de Spotify.
  pinIcon: { transform: [{ rotate: '45deg' }] },
});
