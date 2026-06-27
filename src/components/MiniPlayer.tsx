/**
 * Barra de reproducción compacta sobre la barra de pestañas. Muestra la
 * canción actual y un botón play/pausa; al tocarla abre el reproductor.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { coverArtUrl } from '@/api/data';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';
import { FavoriteButton } from './FavoriteButton';

const SCREEN_W = Dimensions.get('window').width;
const DISMISS_THRESHOLD = SCREEN_W * 0.35;

export function MiniPlayer() {
  const router = useRouter();
  const song = usePlayerStore(currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const toggle = usePlayerStore((s) => s.toggle);
  const reset = usePlayerStore((s) => s.reset);
  const t = useT();

  // Deslizar el mini-reproductor hacia la derecha lo descarta (para y limpia).
  const translateX = useSharedValue(0);
  const dismiss = Gesture.Pan()
    .activeOffsetX(20)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      translateX.value = Math.max(0, e.translationX);
    })
    .onEnd((e) => {
      if (e.translationX > DISMISS_THRESHOLD || e.velocityX > 800) {
        translateX.value = withTiming(SCREEN_W, { duration: 200 }, (finished) => {
          if (finished) runOnJS(reset)();
        });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: interpolate(translateX.value, [0, SCREEN_W * 0.6], [1, 0], Extrapolation.CLAMP),
  }));

  // Tras descartarlo, el desplazamiento queda en el borde; al cambiar de
  // canción (o volver a sonar algo) lo devolvemos a su sitio.
  useEffect(() => {
    translateX.value = 0;
  }, [song?.id, translateX]);

  const cover = song ? coverArtUrl(song.coverArt ?? song.albumId, 100) : undefined;
  const bg = useDominantColor(cover);
  const offline = useAuthStore((s) => s.offline);
  const favIds = useFavoriteIds(!!song && (!song.localUri || offline));

  if (!song) return null;

  const duration = durationSec || song.duration || 0;
  const progress = duration > 0 ? Math.min(1, positionSec / duration) : 0;
  const favorited = !!song.starred || (favIds?.has(song.id) ?? false);

  return (
    <GestureDetector gesture={dismiss}>
      <Animated.View style={cardStyle}>
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
        accessibilityLabel={isPlaying ? t('Pause') : t('Play')}
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
      </Animated.View>
    </GestureDetector>
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
