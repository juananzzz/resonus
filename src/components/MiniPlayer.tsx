/**
 * Barra de reproducción compacta sobre la barra de pestañas. Muestra la
 * canción actual y un botón play/pausa; al tocarla abre el reproductor.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { coverArtUrl } from '@/api/data';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';
import { FavoriteButton } from './FavoriteButton';

export function MiniPlayer() {
  const router = useRouter();
  const song = usePlayerStore(currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const toggle = usePlayerStore((s) => s.toggle);
  const t = useT();

  const cover = song ? coverArtUrl(song.coverArt ?? song.albumId, 100) : undefined;
  const bg = useDominantColor(cover);
  const offline = useAuthStore((s) => s.offline);
  const favIds = useFavoriteIds(!!song && (!song.localUri || offline));

  if (!song) return null;

  const duration = durationSec || song.duration || 0;
  const progress = duration > 0 ? Math.min(1, positionSec / duration) : 0;
  const favorited = !!song.starred || (favIds?.has(song.id) ?? false);

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
      {(song.localUri && !offline) ? null : (
        <FavoriteButton id={song.id} starred={favorited} size={24} />
      )}
      <Pressable
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? t('Pausar') : t('Reproducir')}
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

      <View style={styles.progressTrack} pointerEvents="none">
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
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
    overflow: 'hidden',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  progressFill: { height: 2, backgroundColor: colors.text },
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
