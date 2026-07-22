/** Reproductor a pantalla completa (modal): carátula, progreso y controles. */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl, type Song } from '@/api/data';
import { AudioQualityBadge } from '@/components/AudioQualityBadge';
import { Cover } from '@/components/Cover';
import { FavoriteButton } from '@/components/FavoriteButton';
import { StarRating } from '@/components/StarRating';
import { CoverLyrics, LyricsCard } from '@/components/LyricsCard';
import { MarqueeText } from '@/components/MarqueeText';
import { OutputSheet } from '@/components/OutputSheet';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useLyrics } from '@/hooks/useLyrics';
import { artistTargets } from '@/lib/artistNav';
import { formatDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useArtistPicker } from '@/store/artistPicker';
import { useAuthStore } from '@/store/auth';
import { currentSong, SOURCE_FAVORITES, SOURCE_HISTORY, usePlayerStore } from '@/store/player';
import { useRadioCovers } from '@/store/radioCovers';
import { useSettings } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { useToast } from '@/store/toast';
import { useJukebox } from '@/store/jukebox';
import { useUpnp } from '@/store/upnp';
import { useT } from '@/i18n';
import { colors, fontSize, spacing } from '@/theme';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const COVER = SCREEN_W - spacing.xl * 2;
const SWIPE_THRESHOLD = SCREEN_W * 0.25;
const DISMISS_THRESHOLD = 120;
// Cuánto asoma la tarjeta de letra bajo la primera página (invita a deslizar).
const LYRICS_PEEK = 56;

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

/**
 * Posición y atenuado de un panel del carrusel de carátulas (reciclado).
 *
 * Los 3 paneles forman una tira infinita: el panel `k` se coloca en el
 * múltiplo de 3 pantallas más cercano al centro, así siempre queda a ≤1,5
 * pantallas y el salto de un extremo al otro ocurre fuera de pantalla. Todo se
 * calcula en el hilo de UI a partir de `offset` (que acumula, nunca se
 * resetea), de modo que consolidar un swipe no mueve ningún panel visible: el
 * que era vecino queda centrado y solo cambia el contenido del panel oculto.
 */
function usePaneStyle(offset: SharedValue<number>, k: number) {
  return useAnimatedStyle(() => {
    const m = k + 3 * Math.round((-offset.value / SCREEN_W - k) / 3);
    const x = m * SCREEN_W + offset.value;
    return {
      transform: [{ translateX: x }],
      opacity: interpolate(Math.abs(x), [0, SCREEN_W * 0.6], [1, 0.4], Extrapolation.CLAMP),
    };
  });
}

export default function PlayerScreen() {
  useSettings((s) => s.accentColor); // re-render al cambiar el acento
  useSettings((s) => s.appFont); // re-render al cambiar la fuente
  const router = useRouter();
  const isFocused = useIsFocused();
  const song = usePlayerStore(currentSong);
  const source = usePlayerStore((s) => s.source);
  const sourceHref = usePlayerStore((s) => s.sourceHref);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
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
  const rateSong = usePlayerStore((s) => s.rateSong);
  const openMenu = useSongMenu((s) => s.open);
  const openArtistPicker = useArtistPicker((s) => s.open);
  const t = useT();
  const showQualityBadge = useSettings((s) => s.showAudioQuality);
  const showRating = useSettings((s) => s.showRating);
  const showAlbumInfo = useSettings((s) => s.showAlbumInfo);
  const showLyricsCard = useSettings((s) => s.showLyricsCard);
  const coverTapAction = useSettings((s) => s.coverTapAction);
  const marqueeTitles = useSettings((s) => s.marqueeTitles);
  const showQueueButton = useSettings((s) => s.showQueueButton);
  const showDevicesButton = useSettings((s) => s.showDevicesButton);
  const seekButtonsSec = useSettings((s) => s.seekButtonsSec);
  const offline = useAuthStore((s) => s.offline);
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const hasAccount = useAuthStore((s) => !!s.auth);
  const upnpDevice = useUpnp((s) => (s.connected ? s.deviceName : null));
  const jukeboxActive = useJukebox((s) => s.active);
  const remoteDevice = upnpDevice ?? (jukeboxActive ? t('Server speakers (Jukebox)') : null);
  const [outputOpen, setOutputOpen] = useState(false);
  // Con letra local (.lrc/USLT/LRCLIB) el modo offline también tiene lyrics;
  // solo la radio (url directa) queda fuera. Ocultar la tarjeta (ajuste) no
  // desactiva las letras: tocar la carátula sigue abriendo pantalla completa.
  const canLyrics = !song?.url;
  const favIds = useFavoriteIds(!!song && (!song?.localUri || offline));

  // La capa de datos resuelve la carátula: del servidor (online) o del índice
  // local por álbum (offline). Ya no se guarda el base64 en cada canción.
  // Emisoras de radio: carátula propia guardada en el dispositivo (Subsonic no
  // tiene carátula para radios). Se resuelve por id de canción/emisora.
  const radioCovers = useRadioCovers((s) => s.covers);
  const radioCoverOf = (s?: Song) => (s?.url ? radioCovers[s.id] : undefined);
  const cover = song
    ? (song.url ? radioCoverOf(song) : coverArtUrl(song.coverArt ?? song.albumId, 600))
    : undefined;
  // Fondo estilo Spotify: degradado del color dominante de la carátula
  // (desactivable en Ajustes → Aspecto). El color transiciona suave al cambiar
  // de canción: se anima un color plano y el degradado hacia el fondo es una
  // capa fija encima (mismo aspecto que animar el degradado, que no se puede).
  const colorBackground = useSettings((s) => s.playerColorBackground);
  const dominant = useDominantColor(colorBackground ? cover : undefined);
  const targetBg = colorBackground ? dominant : '#3a4042';
  const bgColor = useSharedValue(targetBg);
  useEffect(() => {
    // reduceMotion Never: el fundido de color es parte del look y algunos
    // móviles (ahorro de batería / "reducir movimiento") lo saltarían.
    bgColor.value = withTiming(targetBg, { duration: 600, reduceMotion: ReduceMotion.Never });
  }, [targetBg, bgColor]);
  const bgStyle = useAnimatedStyle(() => ({ backgroundColor: bgColor.value }));
  // Misma query que usa la tarjeta de letra (cacheada): aquí solo para saber
  // si hay letra y dejar la tarjeta asomando bajo la primera página.
  const { data: lyrics } = useLyrics(canLyrics ? (song ?? undefined) : undefined);

  // El player es desplazable (como Spotify): la primera "página" ocupa la
  // pantalla y debajo asoma la tarjeta de la letra. La altura real la da el
  // onLayout del ScrollView; hasta entonces, una aproximación.
  const [pageH, setPageH] = useState(0);
  // El gesto de cerrar arrastrando solo debe actuar con el scroll arriba del
  // todo; si no, robaría el gesto al volver de la tarjeta de letra.
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);

  // Deslizar la carátula: izquierda → siguiente, derecha → anterior. A
  // diferencia de los botones, el swipe siempre cambia de pista y da la vuelta
  // a la lista al llegar al final/inicio.
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const canSwitch = usePlayerStore((s) => s.queue.length > 1);
  // Vecinas en la cola (con vuelta), para que el carrusel las enseñe al
  // arrastrar. Referencias estables: solo re-renderiza si cambia la canción.
  const prevSong = usePlayerStore((s) =>
    s.queue.length > 1 ? s.queue[(s.index - 1 + s.queue.length) % s.queue.length] : undefined,
  );
  const nextSong = usePlayerStore((s) =>
    s.queue.length > 1 ? s.queue[(s.index + 1) % s.queue.length] : undefined,
  );
  const prevCover = prevSong
    ? (prevSong.url ? radioCoverOf(prevSong) : coverArtUrl(prevSong.coverArt ?? prevSong.albumId, 600))
    : undefined;
  const nextCover = nextSong
    ? (nextSong.url ? radioCoverOf(nextSong) : coverArtUrl(nextSong.coverArt ?? nextSong.albumId, 600))
    : undefined;
  const goNext = () => {
    const { queue, index } = usePlayerStore.getState();
    if (queue.length > 1) jumpTo(index < queue.length - 1 ? index + 1 : 0);
  };
  const goPrev = () => {
    const { queue, index } = usePlayerStore.getState();
    if (queue.length > 1) jumpTo(index > 0 ? index - 1 : queue.length - 1);
  };

  // Avances netos consumados del carrusel: espejo entero de `-offset/W` en
  // reposo. Vive en React porque decide qué canción enseña cada panel.
  const [spins, setSpins] = useState(0);
  const offset = useSharedValue(0);
  const dragBase = useSharedValue(0);
  const commitSwipe = (advance: 1 | -1) => {
    setSpins((n) => n + advance);
    (advance === 1 ? goNext : goPrev)();
  };
  const coverPan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onStart(() => {
      dragBase.value = offset.value;
    })
    .onUpdate((e) => {
      // Sin más pistas, resistencia (se nota que no hay a dónde ir). El
      // arrastre se acota a los paneles vecinos ya cargados: más allá habría
      // un panel con contenido viejo.
      const raw = dragBase.value + (canSwitch ? e.translationX : e.translationX / 4);
      const min = -(spins + 1) * SCREEN_W;
      const max = -(spins - 1) * SCREEN_W;
      offset.value = Math.min(max, Math.max(min, raw));
    })
    .onEnd((e) => {
      const wantNext = canSwitch && (e.translationX < -SWIPE_THRESHOLD || e.velocityX < -600);
      const wantPrev = canSwitch && (e.translationX > SWIPE_THRESHOLD || e.velocityX > 600);
      const advance = wantNext ? 1 : wantPrev ? -1 : 0;
      const target = -(spins + advance) * SCREEN_W;
      if (advance !== 0) {
        // El carrusel termina el recorrido con la vecina centrada; la pista
        // cambia al acabar. Si React tarda, no se nota: el panel centrado ya
        // enseña la carátula correcta y el swap ocurre en el panel oculto.
        offset.value = withTiming(
          target,
          { duration: 220, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(commitSwipe)(advance as 1 | -1);
          },
        );
      } else {
        offset.value = withSpring(target, { damping: 20, stiffness: 200 });
      }
    });
  // Tocar la carátula muestra la letra (si la hay). Convive con el swipe: el tap
  // solo gana si no hubo arrastre. `hasLyrics` es un booleano para poder leerlo
  // desde el hilo de UI del gesto.
  const hasLyrics = !!lyrics;
  // Qué hace el tap según el ajuste: «inline» la muestra en el sitio de la
  // carátula (toggle), «screen» abre la pantalla completa, «none» nada.
  const [inlineLyrics, setInlineLyrics] = useState(false);
  // Al cambiar de canción se vuelve a la carátula (cada canción se toca aparte).
  useEffect(() => {
    setInlineLyrics(false);
  }, [song?.id]);
  const openLyrics = () => {
    if (coverTapAction === 'inline') setInlineLyrics((v) => !v);
    else if (coverTapAction === 'screen') router.push('/lyrics');
  };
  const coverTap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((_e, success) => {
      if (success && hasLyrics) runOnJS(openLyrics)();
    });
  const coverGesture = Gesture.Race(coverPan, coverTap);
  const paneStyles = [usePaneStyle(offset, 0), usePaneStyle(offset, 1), usePaneStyle(offset, 2)];
  // Qué canción (actual, siguiente o anterior) toca en cada panel según los
  // avances consumados; misma fórmula de reciclado que la posición en UI.
  const paneRel = (k: number) => k + 3 * Math.round((spins - k) / 3) - spins;

  // Deslizar hacia abajo cierra el reproductor (gesto propio: el modal nativo
  // no lo soporta en Android).
  const transY = useSharedValue(0);
  const closePlayer = () => router.back();
  const dismissPan = Gesture.Pan()
    .enabled(atTop)
    .activeOffsetY(15)
    .failOffsetX([-25, 25])
    .onUpdate((e) => {
      transY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_THRESHOLD || e.velocityY > 800) {
        transY.value = withTiming(SCREEN_H, { duration: 220 }, (f) => {
          if (f) runOnJS(closePlayer)();
        });
      } else {
        transY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });
  const rootStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: transY.value }],
  }));

  // Si no hay canción (p. ej. al vaciar la cola), cierra el reproductor. En un
  // efecto (no en render) para no actualizar el Stack mientras se pinta otro
  // componente, y solo si el player es la pantalla visible: si encima está la
  // cola, dejamos que esa muestre su estado vacío en vez de cerrarla nosotros.
  useEffect(() => {
    if (!song && isFocused) router.back();
  }, [song, isFocused, router]);

  if (!song) return null;

  const isLocal = !!song.localUri;
  // La lista central manda cuando está cargada (se refresca al marcar desde
  // cualquier sitio); `song.starred` de la cola queda obsoleto, así que solo
  // sirve de reserva para canciones locales o mientras carga.
  const favorited = favIds ? favIds.has(song.id) : !!song.starred;
  // Las estrellas (setRating) son cosa de Subsonic: se activan en Ajustes y
  // necesitan cuenta de servidor no-Jellyfin; no aplican en radio (url directa)
  // ni en el perfil local (sin cuenta). Offline se apunta y sube al reconectar.
  const canRate = showRating && hasAccount && serverType !== 'jellyfin' && !song.url;
  // Álbum · año bajo el título (opcional). Radio no tiene: solo si hay algo.
  const albumLine = [song.album, song.year].filter(Boolean).join(' · ');
  const duration = durationSec || song.duration || 0;
  const repeatActive = repeat !== 'off';

  return (
    <GestureDetector gesture={dismissPan}>
      <Animated.View style={[styles.root, rootStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, bgStyle]} />
        <LinearGradient
          colors={[colors.background + '00', colors.background] as const}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safe}>
        <ScrollView
          style={{ flex: 1 }}
          onLayout={(e) => setPageH(e.nativeEvent.layout.height)}
          onScroll={(e) => {
            const next = e.nativeEvent.contentOffset.y <= 4;
            if (next !== atTopRef.current) {
              atTopRef.current = next;
              setAtTop(next);
            }
          }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
        <View
          style={{
            height: pageH ? pageH - (lyrics && showLyricsCard ? LYRICS_PEEK : 0) : SCREEN_H * 0.85,
          }}
        >
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
                  {song?.url
                    ? t('Radio')
                    : source === SOURCE_FAVORITES
                      ? t('Favorites')
                      : source === SOURCE_HISTORY
                        ? t('History')
                        : source}
                </Text>
              </>
            ) : (
              <Text style={styles.topTitle}>{t('NOW PLAYING')}</Text>
            )}
          </Pressable>
          {isLocal && !offline ? (
            <View style={{ width: 40 }} />
          ) : (
            <CircleButton name="ellipsis-vertical" label={t('More options')} onPress={() => openMenu(song, undefined, { showLyrics: hasLyrics })} />
          )}
        </View>

        <View style={styles.coverWrap}>
          <GestureDetector gesture={coverGesture}>
            {/* Carrusel reciclado: la carátula actual centrada y las vecinas a
                una pantalla, entrando ya al arrastrar. Sin fundido (transition
                0): el contenido de un panel solo cambia fuera de pantalla y un
                fundido no pinta nada aquí. */}
            <Animated.View style={styles.coverRow}>
              {paneStyles.map((paneStyle, k) => {
                const rel = paneRel(k);
                const paneSong = rel === 0 ? song : rel === 1 ? nextSong : prevSong;
                const paneCover = rel === 0 ? cover : rel === 1 ? nextCover : prevCover;
                return (
                  <Animated.View key={k} style={[styles.coverPane, paneStyle]}>
                    {/* Con la letra en el sitio se oculta la carátula: la letra
                        (fondo transparente) queda sobre el fondo del player. */}
                    {paneSong && !inlineLyrics ? (
                      <Cover
                        uri={paneCover}
                        size={COVER}
                        transition={0}
                        placeholderIcon={paneSong.url ? 'radio' : 'musical-notes'}
                      />
                    ) : null}
                  </Animated.View>
                );
              })}
            </Animated.View>
          </GestureDetector>
          {/* Letra en el sitio de la carátula (ajuste): mismo cuadro, encima. */}
          {inlineLyrics && hasLyrics ? (
            <View style={styles.lyricsOverlay}>
              <CoverLyrics size={COVER} onClose={() => setInlineLyrics(false)} />
            </View>
          ) : null}
          {canRate ? (
            <View style={styles.belowCover}>
              <StarRating
                id={song.id}
                rating={song.userRating}
                size={18}
                onRated={(r) => rateSong(song.id, r)}
              />
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
                  <MarqueeText text={song.title} style={styles.title} enabled={marqueeTitles} />
                </Pressable>
              ) : (
                <MarqueeText text={song.title} style={styles.title} enabled={marqueeTitles} />
              )}
              {(() => {
                const targets = artistTargets(song);
                if (targets.length === 0) {
                  return (
                    <MarqueeText
                      text={song.artist ?? t('Unknown artist')}
                      style={styles.artist}
                      enabled={marqueeTitles}
                    />
                  );
                }
                return (
                  <Pressable
                    style={styles.tapText}
                    hitSlop={6}
                    onPress={() =>
                      targets.length > 1
                        ? openArtistPicker(targets)
                        : router.push(`/artist/${targets[0].id}`)
                    }
                  >
                    <MarqueeText
                      text={song.artist ?? t('Unknown artist')}
                      style={styles.artist}
                      enabled={marqueeTitles}
                    />
                  </Pressable>
                );
              })()}
            </View>
            {(isLocal && !offline) ? null : <FavoriteButton id={song.id} starred={favorited} size={26} />}
          </View>

          {(showAlbumInfo && albumLine) || showQualityBadge ? (
            <View style={styles.subInfo}>
              {showAlbumInfo && albumLine ? (
                song.albumId ? (
                  <Pressable
                    style={styles.tapText}
                    hitSlop={6}
                    onPress={() => router.push(`/album/${song.albumId}` as never)}
                  >
                    <MarqueeText text={albumLine} style={styles.albumInfo} enabled={marqueeTitles} />
                  </Pressable>
                ) : (
                  <MarqueeText text={albumLine} style={styles.albumInfo} enabled={marqueeTitles} />
                )
              ) : null}
              {showQualityBadge ? <AudioQualityBadge song={song} /> : null}
            </View>
          ) : null}

          <View style={styles.progress}>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={duration}
              value={positionSec}
              onSlidingComplete={seekTo}
              minimumTrackTintColor={colors.text}
              maximumTrackTintColor="rgba(255,255,255,0.35)"
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
            {seekButtonsSec > 0 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Back {n} seconds', { n: seekButtonsSec })}
                onPress={() => seekTo(Math.max(0, positionSec - seekButtonsSec))}
              >
                <MaterialIcons
                  name={`replay-${seekButtonsSec}` as 'replay-10'}
                  size={28}
                  color={colors.text}
                />
              </Pressable>
            ) : null}
            <Pressable
              style={styles.playButton}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('Pause') : t('Play')}
              onPress={toggle}
              // Stop de verdad: para y elimina cola, mini player y
              // notificación. No hace falta cerrar el player a mano: el efecto
              // de "sin canción" ya lo cierra, y el toast con Deshacer queda
              // en la pantalla de debajo.
              onLongPress={() => {
                haptic('medium');
                void usePlayerStore
                  .getState()
                  .stopAndClear()
                  .then((undo) => {
                    if (!undo) return;
                    useToast.getState().show(t('Playback stopped'), { label: t('Undo'), run: undo });
                  });
              }}
            >
              {isBuffering ? (
                <ActivityIndicator size="small" color="#101010" />
              ) : (
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={34}
                  color="#101010"
                  style={!isPlaying && { marginLeft: 3 }}
                />
              )}
            </Pressable>
            {seekButtonsSec > 0 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Forward {n} seconds', { n: seekButtonsSec })}
                onPress={() =>
                  // Tope antes del final: saltarse el didJustFinish a pelo
                  // dejaría el avance automático sin disparar.
                  seekTo(duration > 0 ? Math.min(duration - 1, positionSec + seekButtonsSec) : positionSec + seekButtonsSec)
                }
              >
                <MaterialIcons
                  name={`forward-${seekButtonsSec}` as 'forward-10'}
                  size={28}
                  color={colors.text}
                />
              </Pressable>
            ) : null}
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

          {showDevicesButton || showQueueButton || remoteDevice ? (
            <View style={styles.bottomRow}>
              <View style={styles.bottomSlot}>
                {/* Conectado a un dispositivo remoto se muestra siempre: es la
                    única vía para desconectar el cast. */}
                {showDevicesButton || remoteDevice ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('Devices')}
                    disabled={offline}
                    onPress={() => setOutputOpen(true)}
                    style={styles.deviceRow}
                  >
                    <MaterialIcons
                      name="devices"
                      size={22}
                      color={remoteDevice ? colors.accent : offline ? colors.textMuted : colors.text}
                    />
                    {remoteDevice ? (
                      <Text style={[styles.deviceName, { color: colors.accent }]} numberOfLines={1}>
                        {remoteDevice}
                      </Text>
                    ) : null}
                  </Pressable>
                ) : null}
              </View>
              {showQueueButton ? (
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('View queue')}
                  onPress={() => router.push('/queue')}
                >
                  <MaterialIcons name="queue-music" size={24} color={colors.text} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        </View>
        {canLyrics && showLyricsCard ? <LyricsCard /> : null}
        </ScrollView>
        </SafeAreaView>
        <OutputSheet visible={outputOpen} onClose={() => setOutputOpen(false)} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  // El padding lateral vive en cada sección (no aquí): así el slider puede
  // sobresalir su margen interno sin que el ScrollView recorte el pulgar.
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  circle: {
    width: 40,
    height: 40,
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
  // Los paneles del carrusel son absolutos (usePaneStyle los coloca); la fila
  // reserva el hueco de la carátula.
  coverRow: { width: COVER, height: COVER },
  coverPane: { position: 'absolute', top: 0, left: 0 },
  // Superposición de la letra sobre el cuadro de la carátula: ocupa el mismo
  // alto (top 0, height COVER) y se centra en horizontal (coverWrap es más
  // ancho que la carátula; sin esto la letra queda pegada a la izquierda).
  lyricsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: COVER,
    alignItems: 'center',
  },
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  // El área pulsable se ajusta al texto (no a todo el ancho), para no navegar
  // al tocar el hueco vacío de la derecha.
  // Abraza el texto: la zona pulsable es solo el título/artista, no la fila.
  tapText: { alignSelf: 'flex-start', maxWidth: '100%' },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  // Líneas de info bajo el título/artista (álbum·año y/o calidad), en versión
  // compacta: son opcionales y la primera página va justa con todo activado —
  // cada píxel vertical cuenta (el slider ya trae aire propio debajo). Un único
  // tirón hacia arriba para todo el grupo y un gap pequeño entre líneas, así no
  // se solapan cuando se muestran las dos.
  subInfo: { marginTop: -spacing.sm, marginBottom: spacing.xs, gap: 2 },
  albumInfo: { color: colors.textSecondary, fontSize: fontSize.sm },
  progress: { marginBottom: spacing.md },
  // Compensa el margen interno del slider (~15px, donde centra el pulgar en
  // los extremos): la pista visible va de borde a borde del contenido, como
  // Spotify, y el pulgar sobresale hacia el hueco sin que nada lo recorte.
  slider: { marginHorizontal: -15 },
  // Pegados a la barra: el slider trae mucho aire vertical (zona táctil).
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
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
  // Estrellas centradas bajo la carátula (elemento opcional).
  belowCover: { alignItems: 'center', marginTop: spacing.md },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  // Hueco flexible para el botón de dispositivos: mantiene la cola en su
  // sitio aunque el botón esté oculto, y deja crecer el nombre del aparato.
  bottomSlot: {
    flex: 1,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  // Como Spotify Connect: icono + nombre del aparato en acento al castear.
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
    paddingRight: spacing.lg,
  },
  deviceName: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '600',
    flexShrink: 1,
  },
});
