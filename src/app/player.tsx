/** Reproductor a pantalla completa (modal): carátula, progreso y controles. */
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl } from '@/api/data';
import { AudioQualityBadge } from '@/components/AudioQualityBadge';
import { Cover } from '@/components/Cover';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { formatDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { currentSong, SOURCE_FAVORITES, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { useT } from '@/i18n';
import { colors, fontSize, spacing } from '@/theme';

const SCREEN_W = Dimensions.get('window').width;
const COVER = SCREEN_W - spacing.xl * 2;
const SWIPE_THRESHOLD = SCREEN_W * 0.25;

function CircleButton({
  name,
  label,
  onPress,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: (e: GestureResponderEvent) => void;
}) {
  return (
    <Pressable
      style={styles.circle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Ionicons name={name} size={22} color={colors.text} />
    </Pressable>
  );
}

export default function PlayerScreen() {
  const router = useRouter();
  const song = usePlayerStore(currentSong);
  const source = usePlayerStore((s) => s.source);
  const sourceHref = usePlayerStore((s) => s.sourceHref);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const openMenu = useSongMenu((s) => s.open);
  const t = useT();
  const showQuality = useSettings((s) => s.showAudioQuality);
  const showQualityBadge = showQuality === 'player' || showQuality === 'everywhere';
  const offline = useAuthStore((s) => s.offline);
  const favIds = useFavoriteIds(!!song && (!song?.localUri || offline));

  // Deslizar la carátula: izquierda → siguiente, derecha → anterior. A
  // diferencia de los botones, el swipe siempre cambia de pista y da la vuelta
  // a la lista al llegar al final/inicio.
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const canSwitch = usePlayerStore((s) => s.queue.length > 1);
  const goNext = () => {
    const { queue, index } = usePlayerStore.getState();
    if (queue.length > 1) jumpTo(index < queue.length - 1 ? index + 1 : 0);
  };
  const goPrev = () => {
    const { queue, index } = usePlayerStore.getState();
    if (queue.length > 1) jumpTo(index > 0 ? index - 1 : queue.length - 1);
  };

  const swipeX = useSharedValue(0);
  const coverPan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      swipeX.value = e.translationX;
    })
    .onEnd((e) => {
      const wantNext = e.translationX < -SWIPE_THRESHOLD || e.velocityX < -600;
      const wantPrev = e.translationX > SWIPE_THRESHOLD || e.velocityX > 600;
      // Saca la carátula actual por un lado, cambia de pista y mete la nueva
      // por el lado opuesto: así el cambio de imagen ocurre fuera de pantalla
      // y no hay flash de la carátula anterior.
      if (canSwitch && wantNext) {
        swipeX.value = withTiming(-SCREEN_W, { duration: 180 }, (f) => {
          if (f) {
            runOnJS(goNext)();
            swipeX.value = SCREEN_W;
            swipeX.value = withTiming(0, { duration: 200 });
          }
        });
      } else if (canSwitch && wantPrev) {
        swipeX.value = withTiming(SCREEN_W, { duration: 180 }, (f) => {
          if (f) {
            runOnJS(goPrev)();
            swipeX.value = -SCREEN_W;
            swipeX.value = withTiming(0, { duration: 200 });
          }
        });
      } else {
        swipeX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });
  const coverStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
    opacity: interpolate(
      Math.abs(swipeX.value),
      [0, SCREEN_W * 0.5],
      [1, 0.3],
      Extrapolation.CLAMP,
    ),
  }));

  if (!song) {
    router.back();
    return null;
  }

  const isLocal = !!song.localUri;
  const favorited = !!song.starred || (favIds?.has(song.id) ?? false);
  // La capa de datos resuelve la carátula: del servidor (online) o del índice
  // local por álbum (offline). Ya no se guarda el base64 en cada canción.
  const cover = coverArtUrl(song.coverArt ?? song.albumId, 600);
  const duration = durationSec || song.duration || 0;
  const repeatActive = repeat !== 'off';

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#3a4042', colors.background] as const}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <CircleButton name="chevron-down" label={t('Close')} onPress={() => router.back()} />
          <Pressable
            style={styles.topTitleWrap}
            disabled={!sourceHref}
            accessibilityRole={sourceHref ? 'button' : undefined}
            onPress={() => {
              if (!sourceHref) return;
              router.back();
              router.navigate(sourceHref as never);
            }}
          >
            {source ? (
              <>
                <Text style={styles.topLabel}>{t('PLAYING FROM')}</Text>
                <Text style={styles.topSource} numberOfLines={1}>
                  {source === SOURCE_FAVORITES ? t('Favorites') : source}
                </Text>
              </>
            ) : (
              <Text style={styles.topTitle}>{t('NOW PLAYING')}</Text>
            )}
          </Pressable>
          {isLocal && !offline ? (
            <View style={{ width: 40 }} />
          ) : (
            <CircleButton name="ellipsis-vertical" label={t('More options')} onPress={() => openMenu(song)} />
          )}
        </View>

        <View style={styles.coverWrap}>
          <GestureDetector gesture={coverPan}>
            <Animated.View style={coverStyle}>
              <Cover uri={cover} size={COVER} />
            </Animated.View>
          </GestureDetector>
          {showQualityBadge ? (
            <View style={styles.qualityWrap}>
              <AudioQualityBadge song={song} />
            </View>
          ) : null}
        </View>

        <View style={styles.bottom}>
          <View style={styles.meta}>
            <View style={{ flex: 1 }}>
              {song.albumId ? (
                <Pressable
                  style={styles.tapText}
                  hitSlop={6}
                  onPress={() => router.push(`/album/${song.albumId}` as never)}
                >
                  <Text style={styles.title} numberOfLines={1}>
                    {song.title}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.title} numberOfLines={1}>
                  {song.title}
                </Text>
              )}
              {song.artistId ? (
                <Pressable
                  style={styles.tapText}
                  hitSlop={6}
                  onPress={() => router.push(`/artist/${song.artistId}`)}
                >
                  <Text style={styles.artist} numberOfLines={1}>
                    {song.artist ?? t('Unknown')}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.artist} numberOfLines={1}>
                  {song.artist ?? t('Unknown')}
                </Text>
              )}
            </View>
            {(isLocal && !offline) ? null : <FavoriteButton id={song.id} starred={favorited} size={26} />}
          </View>

          <View style={styles.progress}>
            <Slider
              minimumValue={0}
              maximumValue={duration}
              value={positionSec}
              onSlidingComplete={seekTo}
              minimumTrackTintColor={colors.text}
              maximumTrackTintColor={colors.surfaceHighlight}
              thumbTintColor={colors.text}
            />
            <View style={styles.times}>
              <Text style={styles.time}>{formatDuration(positionSec)}</Text>
              <Text style={styles.time}>{formatDuration(duration)}</Text>
            </View>
          </View>

          <View style={styles.controls}>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Shuffle')}
              onPress={toggleShuffle}
            >
              <Ionicons
                name="shuffle"
                size={26}
                color={shuffle ? colors.accent : colors.text}
              />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Previous')}
              onPress={previous}
            >
              <Ionicons name="play-skip-back" size={34} color={colors.text} />
            </Pressable>
            <Pressable
              style={styles.playButton}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('Pause') : t('Play')}
              onPress={toggle}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={34}
                color="#101010"
                style={!isPlaying && { marginLeft: 3 }}
              />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Next')}
              onPress={next}
            >
              <Ionicons name="play-skip-forward" size={34} color={colors.text} />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Repeat')}
              onPress={cycleRepeat}
            >
              <MaterialIcons
                name={repeat === 'one' ? 'repeat-one' : 'repeat'}
                size={26}
                color={repeatActive ? colors.accent : colors.text}
              />
            </Pressable>
          </View>

          <View style={styles.bottomRow}>
            <MaterialIcons name="cast" size={22} color={colors.textMuted} />
            <MaterialIcons name="speaker" size={22} color={colors.textMuted} />
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('View queue')}
              onPress={() => router.push('/queue')}
            >
              <MaterialIcons name="queue-music" size={24} color={colors.text} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  safe: { flex: 1, paddingHorizontal: spacing.xl },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitleWrap: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  topTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  topLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  topSource: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  coverWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.lg,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  // El área pulsable se ajusta al texto (no a todo el ancho), para no navegar
  // al tocar el hueco vacío de la derecha.
  tapText: { alignSelf: 'flex-start', maxWidth: '100%' },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  progress: { marginBottom: spacing.md },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.textMuted, fontSize: fontSize.xs },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.lg,
  },
  playButton: {
    backgroundColor: colors.text,
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityWrap: { alignItems: 'center', marginTop: spacing.md },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
});
