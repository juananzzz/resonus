/** Detalle de artista estilo Spotify: cabecera grande, acciones, secciones. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  getArtist,
  getArtistInfo,
  getTopSongs,
} from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { FavoriteButton } from '@/components/FavoriteButton';
import { Message } from '@/components/Message';
import { TrackRow } from '@/components/TrackRow';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

const WIDTH = Dimensions.get('window').width;
const HEADER_H = Math.min(WIDTH, 360);

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [songsExpanded, setSongsExpanded] = useState(false);
  const dominant = useDominantColor(auth ? coverArtUrl(auth, id, 400) : undefined);

  const scrollY = useRef(new Animated.Value(0)).current;
  const barContentOpacity = scrollY.interpolate({
    inputRange: [HEADER_H * 0.45, HEADER_H * 0.75],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const barBgOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_H * 0.75],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const nameOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_H * 0.55],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const imgTranslate = scrollY.interpolate({
    inputRange: [-HEADER_H, 0, HEADER_H],
    outputRange: [HEADER_H / 2, 0, -HEADER_H / 3],
    extrapolate: 'clamp',
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(auth!, id),
    enabled: !!auth && !!id,
  });
  const name = data?.artist.name;

  const { data: topSongs } = useQuery({
    queryKey: ['topSongs', name],
    queryFn: () => getTopSongs(auth!, name!, 20),
    enabled: !!auth && !!name,
  });

  const { data: info } = useQuery({
    queryKey: ['artistInfo', id],
    queryFn: () => getArtistInfo(auth!, id),
    enabled: !!auth && !!id,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.center}>
        <Message text={t('No se pudo cargar el artista.')} onRetry={() => refetch()} />
      </View>
    );
  }

  const top = topSongs ?? [];
  const albums = [...data.albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const headerUri =
    info?.imageUrl ?? coverArtUrl(auth!, data.artist.coverArt ?? data.artist.id, 800);

  async function shufflePlay() {
    if (top.length === 0) return;
    await playQueue(top, 0, name, `/artist/${id}`);
    toggleShuffle();
  }

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: SCREEN_BOTTOM_PADDING }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
      >
        <View style={styles.headerWrap}>
          <Animated.Image
            source={{ uri: headerUri }}
            style={[styles.headerImg, { transform: [{ translateY: imgTranslate }] }]}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['transparent', 'transparent', colors.background] as const}
            style={StyleSheet.absoluteFill}
          />
          <Animated.Text style={[styles.name, { opacity: nameOpacity }]} numberOfLines={2}>
            {data.artist.name}
          </Animated.Text>
        </View>

        <View style={styles.actions}>
          <FavoriteButton id={data.artist.id} type="artist" starred={!!data.artist.starred} size={30} />
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Aleatorio')}
            onPress={shufflePlay}
          >
            <Ionicons name="shuffle" size={28} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            style={styles.playButton}
            accessibilityRole="button"
            accessibilityLabel={t('Reproducir')}
            onPress={() => top.length > 0 && playQueue(top, 0, data.artist.name, `/artist/${id}`)}
          >
            <Ionicons name="play" size={28} color="#000" style={{ marginLeft: 2 }} />
          </Pressable>
        </View>

        {top.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Populares')}</Text>
            {top.slice(0, songsExpanded ? 10 : 5).map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                position={i + 1}
                isCurrent={playing?.id === song.id}
                onPress={() => playQueue(top, i, data.artist.name, `/artist/${id}`)}
              />
            ))}
            {top.length > 5 ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                onPress={() => setSongsExpanded((v) => !v)}
              >
                <Text style={styles.bioToggle}>
                  {songsExpanded ? t('Ver menos') : t('Ver más')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {albums.length > 0 ? (
          <View style={styles.section}>
            <Link href={`/artist/discography/${id}`} asChild>
              <Pressable style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderTitle}>{t('Discografía')}</Text>
                {albums.length > 1 ? (
                  <Text style={styles.showAll}>{t('Mostrar todo')}</Text>
                ) : null}
              </Pressable>
            </Link>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {albums.slice(0, 10).map((album) => (
                <AlbumCard key={album.id} album={album} width={140} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {info?.biography ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Acerca de')}</Text>
            <Text style={styles.bio} numberOfLines={bioExpanded ? undefined : 4}>
              {info.biography}
            </Text>
            {info.biography.length > 220 ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                onPress={() => setBioExpanded((v) => !v)}
              >
                <Text style={styles.bioToggle}>
                  {bioExpanded ? t('Ver menos') : t('Ver más')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {info && info.similarArtists.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Artistas similares')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {info.similarArtists.map((a) => (
                <Link key={a.id} href={`/artist/${a.id}`} asChild>
                  <Pressable style={styles.similar}>
                    <Cover uri={coverArtUrl(auth!, a.coverArt ?? a.id, 200)} size={110} rounded />
                    <Text style={styles.similarName} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </Animated.ScrollView>

      {/* Barra fija: el botón de volver siempre; fondo + título + play al colapsar. */}
      <View style={[styles.bar, { height: insets.top + 48, paddingTop: insets.top }]}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: dominant, opacity: barBgOpacity }]}
        />
        <Pressable
          style={styles.back}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('Cerrar')}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Animated.Text style={[styles.barTitle, { opacity: barContentOpacity }]} numberOfLines={1}>
          {data.artist.name}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  headerWrap: { width: WIDTH, height: HEADER_H, justifyContent: 'flex-end' },
  headerImg: { ...StyleSheet.absoluteFillObject, width: WIDTH, height: HEADER_H },
  name: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  playButton: {
    backgroundColor: colors.accent,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginBottom: spacing.xl },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionHeaderTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  showAll: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  bio: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
  },
  bioToggle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
  similar: { width: 110, alignItems: 'center', gap: spacing.xs },
  similarName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
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
