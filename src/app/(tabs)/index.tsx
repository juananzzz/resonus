/** Inicio estilo Spotify: accesos rápidos + carruseles de álbumes. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  getAlbumList,
  getArtists,
  getPlaylists,
  type Album,
  type Artist,
  type Playlist,
} from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { PlaylistCard } from '@/components/PlaylistCard';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { ArtistCard } from '@/components/ArtistCard';
import { Cover } from '@/components/Cover';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { checkAutoUrlNow } from '@/store/autoUrl';
import { useLastPlayed } from '@/store/lastPlayed';
import { useScanProgress } from '@/store/scanProgress';
import { useSettings, type ExploreChipKey, type HomeSectionKey } from '@/store/settings';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { listPerf } from '@/lib/listPerf';
import { playShuffle } from '@/lib/playShuffle';

const TILE_W = (Dimensions.get('window').width - spacing.lg * 2 - spacing.sm) / 2;

function QuickTile({
  href,
  name,
  cover,
  favorites,
}: {
  href: string;
  name: string;
  cover?: string;
  favorites?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.tile}>
        {favorites ? (
          <FavoritesArt size={52} />
        ) : (
          <Cover uri={cover} size={52} />
        )}
        <Text style={styles.tileText} numberOfLines={2}>
          {name}
        </Text>
      </Pressable>
    </Link>
  );
}

function QuickGrid() {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const times = useLastPlayed((s) => s.times);
  const t = useT();
  // Fuentes y tamaño configurables (Ajustes → Aspecto → Quick grid). Cada
  // fuente solo se consulta si está activa; el tamaño es el total de mosaicos
  // (Favoritos incluido cuando está fijado).
  const withFavorites = useSettings((s) => s.quickGridFavorites);
  const withAlbums = useSettings((s) => s.quickGridAlbums);
  const withPlaylists = useSettings((s) => s.quickGridPlaylists);
  const size = useSettings((s) => s.quickGridSize);
  const { data: playlists } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canFetch && withPlaylists,
  });
  const { data: albums } = useQuery({
    queryKey: ['albumList', offline ? 'newest' : 'recent'],
    queryFn: () => getAlbumList(offline ? 'newest' : 'recent'),
    enabled: canFetch && withAlbums,
  });

  // Rejilla dinámica estilo Spotify: mezcla listas y álbumes recientes ordenados
  // por última escucha (mismo store que "Recientes" de Biblioteca). Lo que
  // acabas de escuchar sube; el resto se rellena con álbumes recientes (orden
  // del servidor) y listas frescas (por fecha de modificación). Favoritos queda
  // siempre fijo el primero, fuera de esta ordenación.
  // Favoritos, si está fijado, ocupa un hueco del total; el resto se reparte
  // entre las fuentes activas ordenadas por última escucha.
  const dynamicCount = Math.max(0, size - (withFavorites ? 1 : 0));
  const tiles = useMemo(() => {
    type Item = { key: string; href: string; name: string; cover?: string; ts: number };
    const pl: Item[] = withPlaylists
      ? (playlists ?? []).map((p) => {
          const href = `/playlist/${p.id}`;
          return {
            key: href,
            href,
            name: p.name,
            cover: coverArtUrl(p.coverArt ?? p.id, 100),
            ts: times[href] ?? (Date.parse(p.changed ?? p.created ?? '') || 0),
          };
        })
      : [];
    const al: Item[] = withAlbums
      ? (albums ?? []).map((a) => {
          const href = `/album/${a.id}`;
          return {
            key: href,
            href,
            name: a.name,
            cover: coverArtUrl(a.coverArt ?? a.id, 100),
            ts: times[href] ?? 0,
          };
        })
      : [];
    return [...al, ...pl].sort((x, y) => y.ts - x.ts).slice(0, dynamicCount);
  }, [playlists, albums, times, withPlaylists, withAlbums, dynamicCount]);

  // Sin fuentes activas no hay nada que enseñar (el interruptor general sigue
  // decidiendo si se monta el bloque; esto cubre "todo apagado" desde aquí).
  if (!withFavorites && tiles.length === 0) return null;

  return (
    <View style={styles.grid}>
      {withFavorites ? <QuickTile href="/favorites" name={t('Favorites')} favorites /> : null}
      {tiles.map((it) => (
        <QuickTile key={it.key} href={it.href} name={it.name} cover={it.cover} />
      ))}
    </View>
  );
}

function AlbumSection({
  title,
  type,
}: {
  title: string;
  type: 'recent' | 'newest' | 'frequent' | 'random';
}) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const { data, isLoading } = useQuery({
    queryKey: ['albumList', type],
    queryFn: () => getAlbumList(type),
    enabled: canFetch,
  });

  if (isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <AlbumCardsSkeleton horizontal />
      </View>
    );
  }
  if (!data || data.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList
        {...listPerf}
        horizontal
        data={data}
        keyExtractor={(item: Album) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item }) => <AlbumCard album={item} />}
      />
    </View>
  );
}

/** Fila de playlists (acceso rápido desde Inicio). Existe también en offline
 *  (playlists locales), así que no se filtra como las de solo-servidor. */
function PlaylistsSection({ title }: { title: string }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const { data, isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canFetch,
  });

  if (isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <AlbumCardsSkeleton horizontal />
      </View>
    );
  }
  if (!data || data.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList
        {...listPerf}
        horizontal
        data={data}
        keyExtractor={(item: Playlist) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item }) => <PlaylistCard playlist={item} />}
      />
    </View>
  );
}

/** Baraja una copia (Fisher-Yates); para las secciones "al azar". */
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ARTIST_SIZE = 130;

/** Fila de artistas al azar (para redescubrir). */
function ArtistSection({ title, reshuffleKey }: { title: string; reshuffleKey: number }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const { data, isLoading } = useQuery({
    queryKey: ['artists'],
    queryFn: () => getArtists(),
    enabled: canFetch,
  });
  // Rebaraja al cambiar la lista o al tirar para refrescar (`reshuffleKey`). Sin
  // esa key, cuando la lista no cambia react-query conserva la misma referencia
  // (structural sharing) y el memo devolvería siempre los mismos 10 artistas.
  const artists = useMemo(
    () => (data ? shuffled(data).slice(0, 10) : []),
    [data, reshuffleKey],
  );

  if (isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <AlbumCardsSkeleton horizontal />
      </View>
    );
  }
  if (artists.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList
        {...listPerf}
        horizontal
        data={artists}
        keyExtractor={(item: Artist) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item }) => <ArtistCard artist={item} width={ARTIST_SIZE} />}
      />
    </View>
  );
}

// Discover = redescubrir: OpenSubsonic no tiene endpoint propio, así que
// tomamos tus álbumes por última reproducción (`recent`), saltamos los más
// recientes (offset) y barajamos la cola → "escuchado pero no últimamente".
const DISCOVER_OFFSET = 15;
const DISCOVER_POOL = 50;

function DiscoverSection({ title, reshuffleKey }: { title: string; reshuffleKey: number }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const { data, isLoading } = useQuery({
    queryKey: ['albumList', 'discover'],
    queryFn: () => getAlbumList('recent', DISCOVER_POOL, DISCOVER_OFFSET),
    enabled: canFetch,
  });
  // Rebaraja al cambiar la lista o al tirar para refrescar (`reshuffleKey`); ver
  // la nota en ArtistSection sobre el structural sharing de react-query.
  const albums = useMemo(
    () => (data ? shuffled(data).slice(0, 10) : []),
    [data, reshuffleKey],
  );

  if (isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <AlbumCardsSkeleton horizontal />
      </View>
    );
  }
  if (albums.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList
        {...listPerf}
        horizontal
        data={albums}
        keyExtractor={(item: Album) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item }) => <AlbumCard album={item} />}
      />
    </View>
  );
}

/** Aspecto y destino de cada chip; el orden y el estado los pone el usuario
 *  (Ajustes → Aspecto → Chips de explorar). Sin `href` = reproduce en vez de
 *  navegar (solo el de aleatorio). */
const EXPLORE: Record<ExploreChipKey, { href?: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  shuffle: { icon: 'shuffle', label: 'Shuffle' },
  favorites: { href: '/favorites', icon: 'heart-outline', label: 'Favorites' },
  albums: { href: '/browse/albums', icon: 'disc-outline', label: 'Albums' },
  artists: { href: '/browse/artists', icon: 'people-outline', label: 'Artists' },
  genres: { href: '/genres', icon: 'pricetags-outline', label: 'Genres' },
  radio: { href: '/radio', icon: 'radio-outline', label: 'Radio' },
  history: { href: '/history', icon: 'time-outline', label: 'Recently played' },
};

// En local hay aleatorio, álbumes y artistas (radio y géneros son de servidor).
const OFFLINE_KEYS = new Set<ExploreChipKey>(['shuffle', 'favorites', 'albums', 'artists']);

function ExploreChips({ offline }: { offline: boolean }) {
  const t = useT();
  const chips = useSettings((s) => s.exploreChips).filter(
    (c) => c.enabled && (!offline || OFFLINE_KEYS.has(c.key)),
  );
  // El aleatorio tarda lo que tarde el servidor: sin esto, tocas y no pasa nada
  // durante medio segundo y parece roto.
  const [shuffling, setShuffling] = useState(false);

  async function onShuffle() {
    if (shuffling) return;
    setShuffling(true);
    try {
      await playShuffle();
    } finally {
      setShuffling(false);
    }
  }

  // Sin chips no hay fila: eso sustituye al interruptor general que había.
  if (chips.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipsRow}
      contentContainerStyle={styles.chips}
    >
      {chips.map(({ key }) => {
        const cfg = EXPLORE[key];
        // El de aleatorio es el único que suena en vez de llevarte a un sitio:
        // pedirlo y que te salga una lista es lo contrario de lo que pediste.
        if (!cfg.href) {
          return (
            <Pressable
              key={key}
              style={styles.chip}
              accessibilityRole="button"
              onPress={onShuffle}
            >
              {shuffling ? (
                <ActivityIndicator size={16} color={colors.text} />
              ) : (
                <Ionicons name={cfg.icon} size={16} color={colors.text} />
              )}
              <Text style={styles.chipText}>{t(cfg.label)}</Text>
            </Pressable>
          );
        }
        return (
          <Link key={key} href={cfg.href} asChild>
            <Pressable style={styles.chip}>
              <Ionicons name={cfg.icon} size={16} color={colors.text} />
              <Text style={styles.chipText}>{t(cfg.label)}</Text>
            </Pressable>
          </Link>
        );
      })}
    </ScrollView>
  );
}

function ScanningPanel() {
  const t = useT();
  const phase = useScanProgress((s) => s.phase);
  const count = useScanProgress((s) => s.count);
  const total = useScanProgress((s) => s.total);
  const fraction = total > 0 ? Math.min(count / total, 1) : 0;
  // El ancho sale directo de la fracción, sin animar. Animarlo tenía sentido
  // cuando el progreso llegaba a saltos del 10%, pero ahora viene en pasos del
  // 1%: eso YA es la animación. Con tics tan seguidos, cada `timing` de 250 ms
  // moría a medias y arrancaba otro desde donde se hubiera quedado, así que la
  // barra no alcanzaba nunca la verdad — al acabar se quedaba por la mitad.
  // Tampoco ahorraba renders: este panel ya se repinta en cada tic por el texto.
  const width = `${fraction * 100}%` as const;
  // Cada fase dice lo suyo: el número sube igual, pero bajo un título que
  // promete lo que de verdad está pasando.
  const title =
    phase === 'finding'
      ? t('Looking for music…')
      : phase === 'covers'
        ? t('Loading covers…')
        : t('Scanning your music…');
  return (
    <View style={styles.scanPanel}>
      <Text style={styles.scanTitle}>{title}</Text>
      {total > 0 ? (
        <View style={styles.scanBarTrack}>
          <View style={[styles.scanBarFill, { width, backgroundColor: colors.accent }]} />
        </View>
      ) : (
        <ActivityIndicator color={colors.accent} />
      )}
      <Text style={styles.scanSub}>
        {total > 0
          ? `${count} / ${total} · ${Math.round(fraction * 100)}%`
          : t('{n} songs', { n: count })}
      </Text>
    </View>
  );
}

/** Título (clave i18n) y tipo de lista de las secciones que usan AlbumSection.
 *  «discover» y «randomArtists» se pintan con sus propios componentes. */
const HOME_ALBUM_CONFIG: Record<
  Exclude<HomeSectionKey, 'randomArtists' | 'discover' | 'playlists'>,
  { title: string; type: 'newest' | 'recent' | 'frequent' | 'random' }
> = {
  recentlyAdded: { title: 'Recently added', type: 'newest' },
  recentlyPlayed: { title: 'Recently played', type: 'recent' },
  mostPlayed: { title: 'Most played', type: 'frequent' },
  randomAlbums: { title: 'Random albums', type: 'random' },
};

export default function HomeScreen() {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const bottomPad = useScreenBottomPadding();
  const scanning = useScanProgress((s) => s.phase !== 'idle');
  const queryClient = useQueryClient();
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  // Sube en cada pull-to-refresh para forzar que las filas al azar (artistas y
  // Discover) traigan una selección nueva aunque la biblioteca no haya cambiado.
  const [reshuffleKey, setReshuffleKey] = useState(0);
  const showHistoryButton = useSettings((s) => s.showHistoryButton);
  const showProfileButton = useSettings((s) => s.showProfileButton);
  const showQuickGrid = useSettings((s) => s.showQuickGrid);
  const showGreeting = useSettings((s) => s.showGreeting);
  const customGreeting = useSettings((s) => s.customGreeting);
  const homeSections = useSettings((s) => s.homeSections);
  // El anillo del avatar lee el acento del store (no la constante global), así
  // se recolorea siempre al cambiarlo o al hidratar; Home es la pantalla
  // inicial y se pinta antes de aplicarse el acento guardado.
  const accentColor = useSettings((s) => s.accentColor);
  useSettings((s) => s.appFont); // re-render al cambiar la fuente
  // 'O' solo en perfil local (sin cuenta); una cuenta de servidor offline sigue
  // mostrando su inicial.
  const initial = offline && !auth ? 'O' : (auth?.username ?? '?').charAt(0).toUpperCase();

  // Saludo según la hora (estilo Spotify). Tramos a la española: mañana hasta
  // las 13, tarde hasta las 21, noche el resto (incluida la madrugada).
  const hour = new Date().getHours();
  const byHour =
    hour >= 6 && hour < 13
      ? t('Good morning')
      : hour >= 13 && hour < 21
        ? t('Good afternoon')
        : t('Good evening');
  // El personalizado manda; en blanco vuelve el de la hora, así que borrarlo es
  // la forma de deshacerlo (no hace falta un botón de "restablecer").
  const greeting = customGreeting.trim() || byHour;

  // Detecta si el servidor no responde (comparte caché con la sección "newest").
  // Solo online: en local no hay servidor y la key la usa también QuickGrid.
  const { isError: serverUnreachable } = useQuery({
    queryKey: ['albumList', 'newest'],
    queryFn: () => getAlbumList('newest'),
    enabled: !!auth && !offline,
  });

  // El servidor no responde con la red arriba (no solo cuando cae la red):
  // dispara un sondeo. Si de verdad no llega y hay descargas, el motor cae a
  // offline solo (ver store/autoUrl.ts).
  useEffect(() => {
    if (serverUnreachable) checkAutoUrlNow();
  }, [serverUnreachable]);

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setReshuffleKey((k) => k + 1);
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.header}>
          {/* `flexShrink` y `numberOfLines`: el saludo se puede personalizar, y
              aunque el ajuste lo limite a GREETING_MAX, esos caracteres miden
              distinto según la fuente elegida. Encogiendo y recortando, no hay
              texto capaz de empujar los botones fuera de la pantalla. */}
          <View style={styles.headerLeft}>
            {showGreeting ? (
              <Text style={styles.greeting} numberOfLines={1}>
                {greeting}
              </Text>
            ) : null}
            {offline && !auth ? (
              <Ionicons
                name="phone-portrait-outline"
                size={28}
                color={colors.accent}
                accessibilityLabel={t('Offline')}
              />
            ) : null}
          </View>
          <View style={styles.headerRight}>
            {showHistoryButton ? (
              <Link href="/history" asChild>
                <Pressable hitSlop={10} accessibilityLabel={t('History')}>
                  <Ionicons name="time-outline" size={24} color={colors.textSecondary} />
                </Pressable>
              </Link>
            ) : null}
            <Link href="/settings" asChild>
              <Pressable hitSlop={10} accessibilityLabel={t('Settings')}>
                <Ionicons name="settings-outline" size={24} color={colors.textSecondary} />
              </Pressable>
            </Link>
            {showProfileButton ? (
              <View style={[styles.avatar, { borderColor: accentColor }]}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {offline && scanning ? <ScanningPanel /> : null}

        <ExploreChips offline={offline} />

        {!offline && serverUnreachable ? (
          <Message
            text={t("Couldn't reach the server. Check your connection.")}
            onRetry={onRefresh}
          />
        ) : (
          <>
            {showQuickGrid ? <QuickGrid /> : null}

            {/* Filas activables y reordenables (Ajustes → Personalización →
                Secciones de Inicio). «Recently played» no existe en offline. */}
            {homeSections.map((s) => {
              // «Discover» depende del historial del servidor (recent con
              // offset): no aplica en offline. «Recently played» sí: el
              // historial local registra igual en ese modo.
              if (!s.enabled) return null;
              if (s.key === 'discover' && offline) return null;
              if (s.key === 'discover') {
                return (
                  <DiscoverSection key={s.key} title={t('Discover')} reshuffleKey={reshuffleKey} />
                );
              }
              if (s.key === 'randomArtists') {
                return (
                  <ArtistSection
                    key={s.key}
                    title={t('Random artists')}
                    reshuffleKey={reshuffleKey}
                  />
                );
              }
              if (s.key === 'playlists') {
                return <PlaylistsSection key={s.key} title={t('Playlists')} />;
              }
              const cfg = HOME_ALBUM_CONFIG[s.key];
              return <AlbumSection key={s.key} title={t(cfg.title)} type={cfg.type} />;
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  greeting: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800', flexShrink: 1 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  chipsRow: { flexGrow: 0, marginBottom: spacing.lg },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surfaceHighlight,
  },
  chipText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  tile: {
    width: TILE_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    overflow: 'hidden',
    paddingRight: spacing.sm,
  },
  tileText: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  rowContent: { paddingHorizontal: spacing.lg, gap: spacing.md },
  scanPanel: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  scanBarTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceHighlight,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  scanBarFill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
  scanTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  scanSub: { color: colors.textSecondary, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
});
