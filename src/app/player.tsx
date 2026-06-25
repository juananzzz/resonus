/** Reproductor a pantalla completa (modal): carátula, progreso y controles. */
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { formatDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, spacing } from '@/theme';

export default function PlayerScreen() {
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const song = usePlayerStore(currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const seekTo = usePlayerStore((s) => s.seekTo);

  if (!song) {
    router.back();
    return null;
  }

  const cover = coverArtUrl(auth!, song.coverArt ?? song.albumId, 600);
  const duration = durationSec || song.duration || 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.topTitle}>Reproduciendo</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.coverWrap}>
        <Cover uri={cover} size={300} />
      </View>

      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist ?? 'Desconocido'}
        </Text>
      </View>

      <View style={styles.progress}>
        <Slider
          minimumValue={0}
          maximumValue={duration}
          value={positionSec}
          onSlidingComplete={seekTo}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.surfaceHighlight}
          thumbTintColor={colors.text}
        />
        <View style={styles.times}>
          <Text style={styles.time}>{formatDuration(positionSec)}</Text>
          <Text style={styles.time}>{formatDuration(duration)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable hitSlop={12} onPress={previous}>
          <Ionicons name="play-skip-back" size={36} color={colors.text} />
        </Pressable>
        <Pressable style={styles.playButton} onPress={toggle}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={36}
            color="#000"
          />
        </Pressable>
        <Pressable hitSlop={12} onPress={next}>
          <Ionicons name="play-skip-forward" size={36} color={colors.text} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  topTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  coverWrap: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  meta: {
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  progress: {
    marginBottom: spacing.xl,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  playButton: {
    backgroundColor: colors.accent,
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
