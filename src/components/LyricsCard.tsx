/**
 * Letra estilo Spotify/Apple Music para el player: tarjeta bajo los controles
 * con el color dominante de la carátula. Dentro, karaoke con auto-scroll si la
 * letra viene sincronizada (tocar una línea salta a ese punto) y foco animado
 * en la línea que suena (las demás se atenúan). Botón para expandir a la
 * pantalla completa (/lyrics). Si la canción no tiene letra, no se pinta nada.
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

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
          <SyncedLyricsView lines={data.lines} nested fadeColor={bg} />
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
 * Lista karaoke reutilizable (tarjeta y pantalla completa): la línea que suena
 * se ilumina y crece un poco (resorte), el resto se atenúa. Auto-scroll que
 * mantiene el foco arriba; el scroll manual lo pausa unos segundos. Tocar una
 * línea salta a ese punto de la canción.
 */
export function SyncedLyricsView({
  lines,
  large,
  nested,
  fadeColor,
}: {
  lines: LyricLine[];
  /** Tipografía grande (pantalla completa). */
  large?: boolean;
  /** Dentro de otro scroll (la tarjeta del player). */
  nested?: boolean;
  /** Color al que se funden los bordes superior/inferior (el fondo). */
  fadeColor?: string;
}) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const userScroll = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // El primer posicionamiento salta directo a la línea que suena (sin animar),
  // para no hacer un scroll rápido y feo desde arriba al abrir. A partir de ahí
  // el avance de una línea a la siguiente sí se anima.
  const didInitialScroll = useRef(false);
  const [viewH, setViewH] = useState(0);

  // Pequeño adelanto para que el resalte no llegue tarde al oído.
  const posMs = positionSec * 1000 + 300;
  let current = -1;
  for (let i = 0; i < lines.length && (lines[i].start ?? 0) <= posMs; i++) current = i;

  // A pantalla completa anclamos la línea activa cerca del centro (y rellenamos
  // arriba/abajo) para que al empezar la canción la letra arranque centrada y
  // legible, no pegada al borde superior. En la tarjeta pequeña, más arriba.
  const anchor = large ? 0.42 : 0.3;

  const onMeasure = useCallback((index: number, y: number) => {
    offsets.current[index] = y;
  }, []);

  useEffect(() => {
    if (current < 0 || viewH === 0 || userScroll.current) return;
    const y = offsets.current[current];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, y - viewH * anchor),
      animated: didInitialScroll.current,
    });
    didInitialScroll.current = true;
  }, [current, viewH, anchor]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  const fadeH = large ? 56 : 36;

  return (
    <View style={styles.wrap}>
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
        contentContainerStyle={[
          styles.content,
          // Relleno para que la primera/última línea puedan quedar en el ancla
          // (centro) en vez de tope arriba/abajo. Solo a pantalla completa.
          large && viewH > 0 ? { paddingTop: viewH * anchor, paddingBottom: viewH * (1 - anchor) } : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {lines.map((line, i) => (
          <LyricRow
            key={i}
            index={i}
            text={line.value.trim() || '♪'}
            start={line.start ?? 0}
            seekable={line.start !== undefined}
            active={i === current}
            next={i === current + 1}
            large={large}
            seekTo={seekTo}
            onMeasure={onMeasure}
          />
        ))}
      </ScrollView>
      {fadeColor ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={[fadeColor, `${fadeColor}00`]}
            style={[styles.fade, { top: 0, height: fadeH }]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[`${fadeColor}00`, fadeColor]}
            style={[styles.fade, { bottom: 0, height: fadeH }]}
          />
        </>
      ) : null}
    </View>
  );
}

/** Una línea de letra con foco animado (resorte al activarse). */
const LyricRow = memo(({
  index,
  text,
  start,
  seekable,
  active,
  next,
  large,
  seekTo,
  onMeasure,
}: {
  index: number;
  text: string;
  start: number;
  seekable: boolean;
  active: boolean;
  next: boolean;
  large?: boolean;
  seekTo: (sec: number) => void;
  onMeasure: (index: number, y: number) => void;
}) => {
  // Solo la línea activa crece (resorte) y se ve al 100 %. El resto se atenúa:
  // la siguiente que va a sonar un poco, las demás bastante más.
  const focus = useSharedValue(active ? 1 : 0);
  const dim = useSharedValue(active ? 1 : next ? 0.55 : 0.3);
  useEffect(() => {
    focus.value = withSpring(active ? 1 : 0, { damping: 20, stiffness: 180, mass: 0.5 });
  }, [active, focus]);
  useEffect(() => {
    dim.value = withTiming(active ? 1 : next ? 0.55 : 0.3, { duration: 300 });
  }, [active, next, dim]);
  // El crecimiento (8 %) se compensa con el hueco derecho de `content` para que
  // la línea activa, al escalar desde la izquierda, no se salga por el borde.
  const anim = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: [{ scale: 1 + focus.value * 0.08 }],
  }));
  return (
    <Pressable
      onLayout={(e) => onMeasure(index, e.nativeEvent.layout.y)}
      style={({ pressed }) => pressed && { opacity: 0.6 }}
      disabled={!seekable}
      onPress={() => seekTo(start / 1000)}
    >
      <Animated.Text style={[lyricsStyles.line, large && lyricsStyles.lineLarge, styles.leftOrigin, anim]}>
        {text}
      </Animated.Text>
    </Pressable>
  );
});
LyricRow.displayName = 'LyricRow';

/** Tipografía compartida por la tarjeta y la pantalla completa. */
export const lyricsStyles = StyleSheet.create({
  line: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '700',
    paddingVertical: spacing.xs,
  },
  lineLarge: { fontSize: 28, lineHeight: 40, paddingVertical: spacing.sm },
});

const CARD_BODY_H = 280;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    // El player ya no tiene padding lateral global (por el slider): el margen
    // de la tarjeta lo pone ella misma.
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.sm },
  body: { height: CARD_BODY_H, overflow: 'hidden' },
  wrap: { flex: 1 },
  // Hueco a la derecha para que la línea activa (que crece un 8 % desde la
  // izquierda) no se recorte contra el borde.
  content: { paddingBottom: spacing.xl, paddingRight: '10%' },
  leftOrigin: { transformOrigin: 'left center' },
  fade: { position: 'absolute', left: 0, right: 0 },
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
