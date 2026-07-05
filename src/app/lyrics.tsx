/**
 * Letra a pantalla completa (expandida desde la tarjeta del player), estilo
 * Spotify: fondo del color dominante de la carátula, karaoke con tocar-línea
 * -para-saltar y controles básicos (progreso y play/pausa) abajo.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl } from '@/api/data';
import { lyricsStyles, SyncedLyricsView } from '@/components/LyricsCard';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, spacing } from '@/theme';

export default function LyricsScreen() {
  const router = useRouter();
  const t = useT();
  const song = usePlayerStore(currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const toggle = usePlayerStore((s) => s.toggle);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const previous = usePlayerStore((s) => s.previous);
  const next = usePlayerStore((s) => s.next);
  const { data, isLoading } = useLyrics(song ?? undefined);
  const bg = useDominantColor(coverArtUrl(song?.coverArt ?? song?.albumId, 600));
  const duration = durationSec || song?.duration || 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>
            {song?.title ?? t('Lyrics')}
          </Text>
          {song?.artist ? (
            <Text style={styles.artist} numberOfLines={1}>
              {song.artist}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.body}>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.text} />
        ) : data?.synced ? (
          <SyncedLyricsView lines={data.lines} large fadeColor={bg} />
        ) : data ? (
          <ScrollView contentContainerStyle={styles.plainContent} showsVerticalScrollIndicator={false}>
            <Text style={[lyricsStyles.line, lyricsStyles.lineLarge]}>
              {data.lines.map((l) => l.value).join('\n')}
            </Text>
          </ScrollView>
        ) : (
          <Text style={styles.empty}>{t('No lyrics available for this song.')}</Text>
        )}
      </View>

      <View style={styles.controls}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={duration}
          value={positionSec}
          onSlidingComplete={seekTo}
          minimumTrackTintColor={colors.text}
          maximumTrackTintColor="rgba(255,255,255,0.3)"
          thumbTintColor={colors.text}
        />
        <View style={styles.times}>
          <Text style={styles.time}>{formatDuration(positionSec)}</Text>
          <Text style={styles.time}>{formatDuration(duration)}</Text>
        </View>
        <View style={styles.buttons}>
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Previous')}
            onPress={previous}
          >
            <Ionicons name="play-skip-back" size={32} color={colors.text} />
          </Pressable>
          <Pressable
            style={styles.playButton}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? t('Pause') : t('Play')}
            onPress={toggle}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={30}
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
            <Ionicons name="play-skip-forward" size={32} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  titleBox: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  artist: { color: 'rgba(255,255,255,0.7)', fontSize: fontSize.xs },
  body: { flex: 1, paddingHorizontal: spacing.xl },
  plainContent: { paddingVertical: spacing.lg, paddingBottom: spacing.xxl },
  empty: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  controls: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  // Igual que en el player: la pista visible de borde a borde del contenido.
  slider: { marginHorizontal: -15 },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  time: { color: 'rgba(255,255,255,0.7)', fontSize: fontSize.xs },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
    marginTop: spacing.sm,
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
