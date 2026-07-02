/**
 * Cabecera estilo Spotify (degradado de color dominante + carátula que se
 * desvanece al hacer scroll y barra fija que se colapsa) y la lista de
 * canciones. Compartida por las pantallas de álbum y de lista de reproducción.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Song, type StarType } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { usePlayerStore } from '@/store/player';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { Cover } from './Cover';
import { FavoriteButton } from './FavoriteButton';
import { TrackRow } from './TrackRow';

const COVER = Math.min(Dimensions.get('window').width * 0.58, 250);
const TOPBAR_H = 48;

interface Props {
  title: string;
  subtitle?: string;
  /** Si se indica, el subtítulo lleva al artista al pulsarlo. */
  artistId?: string;
  /** Foto circular del artista junto al subtítulo (estilo Spotify). */
  artistImageUri?: string;
  /** Línea de metadatos (p. ej. "Álbum · 2021 · 12 canciones · 48 min"). */
  meta?: string;
  coverUri?: string;
  /** Carátula personalizada (p. ej. el arte de Favoritos); sustituye a coverUri. */
  renderCover?: (size: number) => ReactNode;
  /** Oculta la carátula de la cabecera y recupera ese espacio (p. ej. Favoritos). */
  hideCover?: boolean;
  /** Color del degradado/barra si no hay carátula con color dominante. */
  accentColor?: string;
  songs: Song[];
  currentId?: string;
  /** Numera las pistas (útil en álbumes). */
  numbered?: boolean;
  /** Si se indica, muestra un corazón para marcar el álbum como favorito. */
  favorite?: { id: string; type: StarType; starred: boolean };
  /** Botón de descarga sin conexión (cabecera de álbum/playlist). */
  download?: {
    status: 'none' | 'active' | 'done';
    /** Progreso 0..1 mientras `status` es 'active'. */
    progress: number;
    onPress: () => void;
  };
  /** Si se indica, muestra un botón ⋯. */
  onMenu?: () => void;
  /** Si se indica, el menú de cada canción permite quitarla de esta playlist. */
  playlistId?: string;
  /** Índice real (en el servidor) de cada canción, por si la lista va reordenada. */
  playlistIndices?: number[];
  /** Si se indica, muestra un botón de orden a la izquierda del ⋯. */
  onSort?: () => void;
  /** Contenido extra al pie de la lista (p. ej. "Más de este artista"). */
  footer?: ReactNode;
  /** Qué mostrar bajo la cabecera cuando no hay canciones (p. ej. playlist vacía). */
  emptyState?: ReactNode;
  /** Muestra la mini carátula del álbum en cada fila (playlists/favoritos). */
  showArtwork?: boolean;
  onPlay: (startIndex: number) => void;
}

export function TrackListView({
  title,
  subtitle,
  artistId,
  artistImageUri,
  meta,
  coverUri,
  renderCover,
  hideCover,
  accentColor,
  songs,
  currentId,
  numbered,
  favorite,
  download,
  onMenu,
  playlistId,
  playlistIndices,
  onSort,
  footer,
  emptyState,
  showArtwork,
  onPlay,
}: Props) {
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  const dominant = useDominantColor(coverUri);
  const headerColor = accentColor ?? dominant;
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  const scrollY = useRef(new Animated.Value(0)).current;

  // Sin carátula la cabecera es más corta: el degradado y el colapso de la
  // barra se ajustan a una distancia menor para que la transición cuadre.
  const cover = hideCover ? 0 : COVER;
  const collapse = hideCover ? 120 : COVER;
  const gradientH = insets.top + TOPBAR_H + cover + 220;
  const coverOpacity = scrollY.interpolate({
    inputRange: [0, collapse * 0.7],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const barContentOpacity = scrollY.interpolate({
    inputRange: [collapse * 0.5, collapse * 0.85],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const barBgOpacity = scrollY.interpolate({
    inputRange: [0, collapse * 0.85],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  function shufflePlay() {
    if (songs.length === 0) return;
    // Arranca en una pista aleatoria y activa el modo aleatorio. playQueue
    // (dentro de onPlay) resetea shuffle a false, así que leemos el estado
    // fresco con getState() en vez de la variable del render (desactualizada).
    onPlay(Math.floor(Math.random() * songs.length));
    if (!usePlayerStore.getState().shuffle) toggleShuffle();
  }

  return (
    <View style={styles.root}>
      {/* Degradado de color dominante; hace parallax 1:1 con el scroll. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.gradientWrap,
          { height: gradientH, transform: [{ translateY: Animated.multiply(scrollY, -1) }] },
        ]}
      >
        <LinearGradient colors={[headerColor, colors.background]} style={StyleSheet.absoluteFill} />
      </Animated.View>

      <Animated.FlatList
        {...listPerf}
        data={songs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + TOPBAR_H + spacing.md },
        ]}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
        ListHeaderComponent={
          <View style={styles.header}>
            {hideCover ? null : (
              <Animated.View style={[styles.coverCenter, { opacity: coverOpacity }]}>
                {renderCover ? renderCover(COVER) : <Cover uri={coverUri} size={COVER} />}
              </Animated.View>
            )}
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {subtitle ? (
              artistId ? (
                <Pressable
                  hitSlop={6}
                  style={styles.subtitleRow}
                  onPress={() => router.push(`/artist/${artistId}`)}
                >
                  {artistImageUri ? (
                    <View style={styles.artistPhoto}>
                      <Cover uri={artistImageUri} size={24} />
                    </View>
                  ) : null}
                  <Text style={[styles.subtitle, styles.subtitleLink]}>{subtitle}</Text>
                </Pressable>
              ) : (
                <Text style={styles.subtitle}>{subtitle}</Text>
              )
            ) : null}
            {meta ? <Text style={styles.meta}>{meta}</Text> : null}

            <View style={styles.actions}>
              <View style={styles.actionsLeft}>
                {favorite ? (
                  <FavoriteButton
                    id={favorite.id}
                    type={favorite.type}
                    starred={favorite.starred}
                    size={28}
                  />
                ) : null}
                {download ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={
                      download.status === 'done' ? t('Remove download') : t('Download')
                    }
                    onPress={download.onPress}
                    style={styles.downloadWrap}
                  >
                    {download.status === 'active' ? (
                      <>
                        <ActivityIndicator size="small" color={colors.accent} />
                        <Text style={styles.downloadProgress}>
                          {Math.round(download.progress * 100)}%
                        </Text>
                      </>
                    ) : (
                      <Ionicons
                        name={
                          download.status === 'done'
                            ? 'arrow-down-circle'
                            : 'arrow-down-circle-outline'
                        }
                        size={26}
                        color={download.status === 'done' ? colors.accent : colors.textSecondary}
                      />
                    )}
                  </Pressable>
                ) : null}
                {onSort ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('Sort')}
                    onPress={onSort}
                  >
                    <Ionicons name="swap-vertical" size={24} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
                {onMenu ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('More options')}
                    onPress={onMenu}
                  >
                    <Ionicons name="ellipsis-horizontal" size={26} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.actionsRight}>
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('Shuffle')}
                  onPress={shufflePlay}
                >
                  <Ionicons
                    name="shuffle"
                    size={26}
                    color={shuffle ? colors.accent : colors.textSecondary}
                  />
                </Pressable>
                <Pressable
                  style={styles.playButton}
                  accessibilityRole="button"
                  accessibilityLabel={t('Play')}
                  onPress={() => songs.length > 0 && onPlay(0)}
                >
                  <Ionicons name="play" size={28} color="#000" style={{ marginLeft: 3 }} />
                </Pressable>
              </View>
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <TrackRow
            song={item}
            position={numbered ? item.track ?? index + 1 : undefined}
            isCurrent={currentId === item.id}
            showArtwork={showArtwork}
            menuContext={
              playlistId
                ? { playlistId, index: playlistIndices ? playlistIndices[index] : index }
                : undefined
            }
            onPress={() => onPlay(index)}
          />
        )}
        ListEmptyComponent={emptyState ? <>{emptyState}</> : null}
        ListFooterComponent={footer ? <>{footer}</> : null}
      />

      {/* Barra fija superior: el fondo y el título aparecen al colapsar. */}
      <View style={[styles.bar, { height: insets.top + TOPBAR_H, paddingTop: insets.top }]}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: headerColor, opacity: barBgOpacity }]}
        />
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Animated.Text style={[styles.barTitle, { opacity: barContentOpacity }]} numberOfLines={1}>
          {title}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  gradientWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
  },
  header: {
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  coverCenter: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  subtitleLink: {
    color: colors.text,
    fontWeight: '700',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
  },
  artistPhoto: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  downloadWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  downloadProgress: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '600',
    minWidth: 32,
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  playButton: {
    backgroundColor: colors.accent,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  barTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
});
