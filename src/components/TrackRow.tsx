/** Fila de una canción dentro de una lista (álbum, playlist, resultados). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { coverArtUrl } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { formatDuration } from '@/lib/format';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSongMenu, type SongMenuContext } from '@/store/songMenu';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, spacing } from '@/theme';
import { AudioQualityBadge } from './AudioQualityBadge';
import { Cover } from './Cover';
import { FavoriteButton } from './FavoriteButton';

interface Props {
  song: Song;
  /** Número opcional a la izquierda (p. ej. la pista en un álbum). */
  position?: number;
  isCurrent?: boolean;
  /** Contexto de playlist (para permitir "quitar de la lista" en el menú). */
  menuContext?: SongMenuContext;
  /**
   * Permite mostrar el corazón en las canciones favoritas (por defecto sí).
   * Solo aparece si la canción está marcada como favorita (estilo Spotify).
   * En offline se pasa `false` (no hay favoritos de servidor).
   */
  showFavorite?: boolean;
  /** Muestra el botón de menú ⋯ (por defecto sí; desactivado en offline). */
  showMenu?: boolean;
  /** Muestra la mini carátula del álbum a la izquierda (estilo Spotify). */
  showArtwork?: boolean;
  onPress: () => void;
}

export function TrackRow({
  song,
  position,
  isCurrent,
  menuContext,
  showFavorite = true,
  showMenu = true,
  showArtwork = false,
  onPress,
}: Props) {
  const openMenu = useSongMenu((s) => s.open);
  const t = useT();
  const showQuality = useSettings((s) => s.showAudioQuality);
  const showDuration = useSettings((s) => s.showSongDuration);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const toast = useToast((s) => s.show);
  const swipeRef = useRef<SwipeableMethods>(null);

  // Favorito = marcado por el endpoint o presente en la lista central de
  // favoritos (fiable), ya que no todos los endpoints traen `starred`.
  const favIds = useFavoriteIds(showFavorite);
  const favorited = showFavorite && (!!song.starred || (favIds?.has(song.id) ?? false));
  const downloaded = useDownloads((s) => !!s.files[song.id]);

  // Swipe a la derecha = añadir a la cola (gesto estilo Spotify). La fila
  // vuelve sola a su sitio; la acción de fondo solo asoma durante el gesto.
  function onSwipeToQueue() {
    swipeRef.current?.close();
    addToQueue(song);
    toast(t('Added to queue'));
  }

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      renderLeftActions={() => (
        <View style={styles.queueAction}>
          <Ionicons name="list" size={22} color={colors.text} />
        </View>
      )}
      leftThreshold={64}
      friction={2}
      onSwipeableWillOpen={(direction) => {
        if (direction === 'left') onSwipeToQueue();
      }}
    >
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
    >
      {showArtwork ? (
        <View style={styles.artwork}>
          <Cover uri={coverArtUrl(song.coverArt ?? song.albumId, 100)} size={44} />
        </View>
      ) : position !== undefined ? (
        <Text style={[styles.position, styles.leftSlot]}>{position}</Text>
      ) : null}

      <View style={styles.info}>
        <Text
          style={[styles.title, isCurrent && styles.current]}
          numberOfLines={1}
        >
          {song.title}
        </Text>
        {downloaded || song.artist ? (
          <View style={styles.subRow}>
            {downloaded ? (
              <Ionicons name="arrow-down-circle" size={13} color={colors.accent} />
            ) : null}
            {song.artist ? (
              <Text style={styles.artist} numberOfLines={1}>
                {song.artist}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {favorited ? <FavoriteButton id={song.id} starred size={20} /> : null}
      {showQuality === 'everywhere' ? <AudioQualityBadge song={song} /> : null}
      {showDuration ? <Text style={styles.duration}>{formatDuration(song.duration)}</Text> : null}
      {showMenu ? (
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('More options')}
          onPress={() => openMenu(song, menuContext)}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
    // Opaca para tapar la acción de swipe mientras la fila está en reposo.
    backgroundColor: colors.background,
  },
  queueAction: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.6,
  },
  position: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  leftSlot: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artwork: {
    width: 44,
    height: 44,
  },
  info: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  current: {
    color: colors.accent,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  duration: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
});
