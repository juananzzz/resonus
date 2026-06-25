/** Fila de una canción dentro de una lista (álbum, playlist, resultados). */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Song } from '@/api/subsonic';
import { formatDuration } from '@/lib/format';
import { colors, fontSize, spacing } from '@/theme';

interface Props {
  song: Song;
  /** Número opcional a la izquierda (p. ej. la pista en un álbum). */
  position?: number;
  isCurrent?: boolean;
  onPress: () => void;
}

export function TrackRow({ song, position, isCurrent, onPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
    >
      {position !== undefined ? (
        <Text style={styles.position}>{position}</Text>
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
      <Text style={styles.duration}>{formatDuration(song.duration)}</Text>
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
    width: 24,
    textAlign: 'center',
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
