/** Detalle de artista estilo Spotify: cabecera grande, acciones, secciones. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
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
import { AlbumGrid } from '@/components/AlbumGrid';
import { Cover } from '@/components/Cover';
import { FavoriteButton } from '@/components/FavoriteButton';
import { Message } from '@/components/Message';
import { TrackRow } from '@/components/TrackRow';
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
  const headerUri =
    info?.imageUrl ?? coverArtUrl(auth!, data.artist.coverArt ?? data.artist.id, 800);

  async function shufflePlay() {
    if (top.length === 0) return;
    await playQueue(top, 0);
    toggleShuffle();
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: SCREEN_BOTTOM_PADDING }}>
        <View style={styles.headerWrap}>
          <Image source={{ uri: headerUri }} style={styles.headerImg} contentFit="cover" />
          <LinearGradient
            colors={['transparent', 'transparent', colors.background] as const}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.name} numberOfLines={2}>
            {data.artist.name}
          </Text>
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
            onPress={() => top.length > 0 && playQueue(top, 0)}
          >
            <Ionicons name="play" size={28} color="#000" style={{ marginLeft: 2 }} />
          </Pressable>
        </View>

        {top.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Populares')}</Text>
            {top.slice(0, 5).map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                position={i + 1}
                isCurrent={playing?.id === song.id}
                onPress={() => playQueue(top, i)}
              />
            ))}
          </View>
        ) : null}

        {data.albums.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Álbumes')}</Text>
            <AlbumGrid albums={data.albums} columns={4} />
          </View>
        ) : null}

        {info?.biography ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Acerca de')}</Text>
            <Text style={styles.bio}>{info.biography}</Text>
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
      </ScrollView>

      <Pressable
        style={[styles.back, { top: insets.top + spacing.sm }]}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('Cerrar')}
        onPress={() => router.back()}
      >
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
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
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
  similar: { width: 110, alignItems: 'center', gap: spacing.xs },
  similarName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  back: {
    position: 'absolute',
    left: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
