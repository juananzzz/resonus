/** Fila de una canción dentro de una lista (álbum, playlist, resultados). */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Song } from '@/api/subsonic';
import { formatDuration } from '@/lib/format';
import { usePlayerStore } from '@/store/player';
import { useSongMenu } from '@/store/songMenu';
import { colors, fontSize, spacing } from '@/theme';
import { FavoriteButton } from './FavoriteButton';
import { NowPlayingBars } from './NowPlayingBars';

interface Props {
  song: Song;
  /** Número opcional a la izquierda (p. ej. la pista en un álbum). */
  position?: number;
  isCurrent?: boolean;
  onPress: () => void;
}

export function TrackRow({ song, position, isCurrent, onPress }: Props) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const openMenu = useSongMenu((s) => s.open);

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

      <FavoriteButton id={song.id} starred={!!song.starred} size={20} />
      <Text style={styles.duration}>{formatDuration(song.duration)}</Text>
      <Pressable hitSlop={8} onPress={() => openMenu(song)}>
        <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
      </Pressable>
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
