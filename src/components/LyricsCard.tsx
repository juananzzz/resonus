/**
 * Letra estilo Spotify para el player: tarjeta bajo los controles con el color
 * dominante de la carátula. Dentro, karaoke con auto-scroll si la letra viene
 * sincronizada (tocar una línea salta a ese punto) y botón para expandir a la
 * pantalla completa (/lyrics). Si la canción no tiene letra, no se pinta nada.
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { coverArtUrl } from '@/api/data';
import { type LyricLine } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing } from '@/theme';

export function LyricsCard() {
  const t = useT();
  const router = useRouter();
  const song = usePlayerStore(currentSong);
  const { data } = useLyrics(song ?? undefined);
  const bg = useDominantColor(coverArtUrl(song?.coverArt ?? song?.albumId, 600));

  if (!data) return null;

  return (
    <View style={[styles.card, { backgroundColor: bg }]}>
      <Text style={styles.title}>{t('Lyrics')}</Text>
      <View style={styles.body}>
        {data.synced ? (
          <SyncedLyricsView lines={data.lines} nested />
        ) : (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text style={lyricsStyles.line}>{data.lines.map((l) => l.value).join('\n')}</Text>
          </ScrollView>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [styles.expand, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('Lyrics')}
        hitSlop={8}
        onPress={() => router.push('/lyrics')}
      >
        <MaterialIcons name="open-in-full" size={16} color="#000" />
      </Pressable>
    </View>
  );
}

/**
 * Lista karaoke reutilizable (tarjeta y pantalla completa): lo cantado en
 * blanco, lo que viene atenuado, auto-scroll que mantiene la línea actual
 * arriba; el scroll manual lo pausa unos segundos. Tocar una línea salta a
 * ese punto de la canción.
 */
export function SyncedLyricsView({
  lines,
  large,
  nested,
}: {
  lines: LyricLine[];
  /** Tipografía grande (pantalla completa). */
  large?: boolean;
  /** Dentro de otro scroll (la tarjeta del player). */
  nested?: boolean;
}) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const userScroll = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewH, setViewH] = useState(0);

  // Pequeño adelanto para que el resalte no llegue tarde al oído.
  const posMs = positionSec * 1000 + 300;
  let current = -1;
  for (let i = 0; i < lines.length && (lines[i].start ?? 0) <= posMs; i++) current = i;

  useEffect(() => {
    if (current < 0 || viewH === 0 || userScroll.current) return;
    const y = offsets.current[current];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - viewH * 0.3), animated: true });
  }, [current, viewH]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  return (
    <ScrollView
      ref={scrollRef}
      nestedScrollEnabled={nested}
      onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
      onScrollBeginDrag={() => {
        userScroll.current = true;
        if (resumeTimer.current) clearTimeout(resumeTimer.current);
      }}
      onScrollEndDrag={() => {
        resumeTimer.current = setTimeout(() => {
          userScroll.current = false;
        }, 3000);
      }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {lines.map((line, i) => (
        <Pressable
          key={i}
          onLayout={(e) => {
            offsets.current[i] = e.nativeEvent.layout.y;
          }}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
          disabled={line.start === undefined}
          onPress={() => seekTo(line.start! / 1000)}
        >
          <Text style={[lyricsStyles.line, large && lyricsStyles.lineLarge, i > current && lyricsStyles.upcoming]}>
            {line.value.trim() || '♪'}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Tipografía compartida por la tarjeta y la pantalla completa. */
export const lyricsStyles = StyleSheet.create({
  line: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '700',
    paddingVertical: spacing.xs,
  },
  lineLarge: { fontSize: 24, lineHeight: 34 },
  upcoming: { color: 'rgba(255,255,255,0.4)' },
});

const CARD_BODY_H = 280;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.sm },
  body: { height: CARD_BODY_H, overflow: 'hidden' },
  content: { paddingBottom: spacing.xl },
  expand: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
