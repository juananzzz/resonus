/**
 * Barra de reproducción compacta sobre la barra de pestañas. Muestra la
 * canción actual y un botón play/pausa; al tocarla abre el reproductor.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
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
const SCREEN_H = Dimensions.get('window').height;
// Umbrales de gesto: horizontal para cambiar de pista, vertical para descartar.
const SWIPE_X = SCREEN_W * 0.25;
const DISMISS_Y = 80;

export function MiniPlayer() {
  const router = useRouter();
  const song = usePlayerStore(currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const reset = usePlayerStore((s) => s.reset);
  const t = useT();

  // Gestos del mini-reproductor: arrastrar hacia la derecha → siguiente, hacia
  // la izquierda → anterior, hacia abajo → descartar (para y limpia). El pan se
  // bloquea al eje dominante para que no vaya en diagonal.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const pan = Gesture.Pan()
    .minDistance(10)
    .onUpdate((e) => {
      if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
        translateX.value = e.translationX;
        translateY.value = 0;
      } else {
        translateY.value = Math.max(0, e.translationY);
        translateX.value = 0;
      }
    })
    .onEnd((e) => {
      const horizontal = Math.abs(e.translationX) > Math.abs(e.translationY);
      if (horizontal) {
        if (e.translationX > SWIPE_X || e.velocityX > 800) runOnJS(next)();
        else if (e.translationX < -SWIPE_X || e.velocityX < -800) runOnJS(previous)();
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        translateY.value = 0;
      } else if (e.translationY > DISMISS_Y || e.velocityY > 800) {
        translateY.value = withTiming(SCREEN_H, { duration: 220 }, (finished) => {
          if (finished) runOnJS(reset)();
        });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });
  // La tarjeta entera solo se mueve (y desvanece) al descartar hacia abajo.
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(translateY.value, [0, SCREEN_W * 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  // En horizontal la barra se queda fija: solo se desplazan/atenúan los detalles
  // de la canción, para que se lea como "cambiar de pista", no como descartar.
  const detailsStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: interpolate(Math.abs(translateX.value), [0, SCREEN_W * 0.5], [1, 0.15], Extrapolation.CLAMP),
  }));

  // Al cambiar de canción (o volver a sonar algo) devolvemos la tarjeta a su
  // sitio por si quedó desplazada de un gesto.
  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
  }, [song?.id, translateX, translateY]);

  const cover = song ? coverArtUrl(song.coverArt ?? song.albumId, 100) : undefined;
  const bg = useDominantColor(cover);
  const offline = useAuthStore((s) => s.offline);
  const favIds = useFavoriteIds(!!song && (!song.localUri || offline));

  if (!song) return null;

  const duration = durationSec || song.duration || 0;
  const progress = duration > 0 ? Math.min(1, positionSec / duration) : 0;
  const favorited = !!song.starred || (favIds?.has(song.id) ?? false);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={cardStyle}>
        <Pressable
          style={[styles.container, { backgroundColor: bg }]}
          onPress={() => router.push('/player')}
        >
      <Animated.View style={[styles.details, detailsStyle]}>
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
      </Animated.View>
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
        {isBuffering ? (
          <ActivityIndicator size="small" color={colors.text} style={styles.spinner} />
        ) : (
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={28}
            color={colors.text}
          />
        )}
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
  spinner: { width: 28, height: 28 },
  details: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
