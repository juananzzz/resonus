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

const COVER = Dimensions.get('window').width - spacing.xl * 2;

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
          <CircleButton name="chevron-down" label={t('Cerrar')} onPress={() => router.back()} />
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
                <Text style={styles.topLabel}>{t('REPRODUCIENDO DESDE')}</Text>
                <Text style={styles.topSource} numberOfLines={1}>
                  {source === SOURCE_FAVORITES ? t('Favoritos') : source}
                </Text>
              </>
            ) : (
              <Text style={styles.topTitle}>{t('REPRODUCIENDO')}</Text>
            )}
          </Pressable>
          {isLocal && !offline ? (
            <View style={{ width: 40 }} />
          ) : (
            <CircleButton name="ellipsis-vertical" label={t('Más opciones')} onPress={() => openMenu(song)} />
          )}
        </View>

        <View style={styles.coverWrap}>
          <Cover uri={cover} size={COVER} />
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
                  hitSlop={6}
                  onPress={() => {
                    router.back();
                    router.navigate(`/album/${song.albumId}` as never);
                  }}
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
                  hitSlop={6}
                  onPress={() => router.push(`/artist/${song.artistId}`)}
                >
                  <Text style={styles.artist} numberOfLines={1}>
                    {song.artist ?? t('Desconocido')}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.artist} numberOfLines={1}>
                  {song.artist ?? t('Desconocido')}
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
              accessibilityLabel={t('Aleatorio')}
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
              accessibilityLabel={t('Anterior')}
              onPress={previous}
            >
              <Ionicons name="play-skip-back" size={34} color={colors.text} />
            </Pressable>
            <Pressable
              style={styles.playButton}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('Pausar') : t('Reproducir')}
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
              accessibilityLabel={t('Siguiente')}
              onPress={next}
            >
              <Ionicons name="play-skip-forward" size={34} color={colors.text} />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Repetir')}
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
              accessibilityLabel={t('Ver la cola')}
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
