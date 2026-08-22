/**
 * Full-screen lyrics page (expanded from the player card), Spotify-style:
 * background from the cover's dominant color, karaoke with tap-line-to-seek
 * and basic controls (progress and play/pause) at the bottom.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COVER, songCoverUrl } from '@/api/data';
import { lyricsStyles, SyncedLyricsView } from '@/components/LyricsCard';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';

export default function LyricsScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const router = useRouter();
  const t = useT();
  const { width } = useScreenSize();
  const song = usePlayerStore(currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const toggle = usePlayerStore((s) => s.toggle);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const previous = usePlayerStore((s) => s.previous);
  const next = usePlayerStore((s) => s.next);
  const dragging = useRef(false);
  const dragValue = useRef(positionSec);
  const [, forceUpdate] = useState(0);
  const { data, isLoading } = useLyrics(song ?? undefined);
  const background = useSettings((s) => s.lyricsBackground);
  const cover = song ? songCoverUrl(song, COVER.card) : undefined;
  // Only extract the palette when it's actually going to be used.
  const dominant = useDominantColor(background === 'color' ? cover : undefined);
  const bg = background === 'color' ? dominant : colors.background;
  // No edge fade over the artwork: that effect paints a gradient from a SOLID
  // colour, and with an image behind there is no colour to fade into — it came
  // out as two black bands with hard edges, only as wide as the lyrics body.
  // The scrim already keeps the text readable, so the fade just goes away.
  const fadeColor = background === 'cover' ? undefined : bg;
  const duration = durationSec || song?.duration || 0;
  const insets = useSafeAreaInsets();
  const topPad = insets.top > 0 ? insets.top : 12;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {background === 'cover' && cover ? (
        <>
          {/* Same as the player: no `recyclingKey`, or the change of song
              blanks this to black before the next cover arrives. */}
          <Image
            source={{ uri: cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={60}
            transition={600}
          />
          {/* Same wash as the player: blur alone doesn't guarantee the lyrics
              stay readable over a bright cover, and which way it washes
              follows the appearance. */}
          <View style={styles.coverScrim} />
        </>
      ) : null}
      <View style={[styles.safe, { paddingTop: topPad, paddingBottom: insets.bottom }]}>
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

      {/* Lyrics are a column of text: across a tablet a line runs the whole
          width and the eye loses the next one on the way back (#131). */}
      <View style={[styles.body, { paddingHorizontal: centredPadding(width, spacing.xl) }]}>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.text} />
        ) : data?.synced ? (
          <SyncedLyricsView lines={data.lines} large fadeColor={fadeColor} />
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
          style={[styles.slider, { height: 24, marginHorizontal: 0 }]}
          thumbSize={12}
          minimumValue={0}
          maximumValue={duration}
          value={dragging.current ? dragValue.current : positionSec}
          onSlidingStart={() => { dragging.current = true; }}
          onValueChange={(v) => { dragValue.current = v; }}
          onSlidingComplete={(v) => { dragging.current = false; forceUpdate((n) => n + 1); seekTo(v); }}
          minimumTrackTintColor={colors.text}
          maximumTrackTintColor={colors.mediaTrack}
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
              color={colors.onInverse}
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
    </View>
    </View>
  );
}

const styles = themed((colors) => ({
  root: { flex: 1, backgroundColor: colors.background },
  safe: { flex: 1 },
  coverScrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.coverWash },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  titleBox: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs },
  body: { flex: 1 },
  plainContent: { paddingVertical: spacing.lg, paddingBottom: spacing.xxl },
  empty: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  controls: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  // Same as the player: the visible track edge to edge of the content.
  slider: { marginHorizontal: -15 },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  time: { color: colors.textSecondary, fontSize: fontSize.xs },
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
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
