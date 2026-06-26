/** Fila de una canción dentro de una lista (álbum, playlist, resultados). */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Song } from '@/api/subsonic';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { formatDuration } from '@/lib/format';
import { usePlayerStore } from '@/store/player';
import { useSongMenu, type SongMenuContext } from '@/store/songMenu';
import { useT } from '@/i18n';
import { colors, fontSize, spacing } from '@/theme';
import { FavoriteButton } from './FavoriteButton';
import { NowPlayingBars } from './NowPlayingBars';

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
  onPress: () => void;
}

export function TrackRow({
  song,
  position,
  isCurrent,
  menuContext,
  showFavorite = true,
  showMenu = true,
  onPress,
}: Props) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const openMenu = useSongMenu((s) => s.open);
  const t = useT();

  // Favorito = marcado por el endpoint o presente en la lista central de
  // favoritos (fiable), ya que no todos los endpoints traen `starred`.
  const favIds = useFavoriteIds(showFavorite);
  const favorited = showFavorite && (!!song.starred || (favIds?.has(song.id) ?? false));

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
    >
      {isCurrent ? (
        <View style={styles.leftSlot}>
          <NowPlayingBars playing={isPlaying} />
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
        {song.artist ? (
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist}
          </Text>
        ) : null}
      </View>

      {favorited ? <FavoriteButton id={song.id} starred size={20} /> : null}
      <Text style={styles.duration}>{formatDuration(song.duration)}</Text>
      {showMenu ? (
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('Más opciones')}
          onPress={() => openMenu(song, menuContext)}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
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
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  duration: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
});
