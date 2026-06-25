/**
 * Barra de reproducción compacta sobre la barra de pestañas. Muestra la
 * canción actual y un botón play/pausa; al tocarla abre el reproductor.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { coverArtUrl } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';

export function MiniPlayer() {
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const song = usePlayerStore(currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);

  const cover = song
    ? coverArtUrl(auth!, song.coverArt ?? song.albumId, 100)
    : undefined;
  const bg = useDominantColor(cover);

  if (!song) return null;

  return (
    <Pressable
      style={[styles.container, { backgroundColor: bg }]}
      onPress={() => router.push('/player')}
    >
      <Cover uri={cover} size={44} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {song.title}
        </Text>
        {song.artist ? (
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist}
          </Text>
        ) : null}
      </View>
      <Pressable
        hitSlop={12}
        onPress={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={28}
          color={colors.text}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceHighlight,
    marginHorizontal: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  info: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
});
