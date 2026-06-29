/** Inicio estilo Spotify: accesos rápidos + carruseles de álbumes. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
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
  getPlaylists,
  type Album,
} from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useScanProgress } from '@/store/scanProgress';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { listPerf } from '@/lib/listPerf';

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
  const t = useT();
  const { data: playlists } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: !offline && canFetch,
  });
  const { data: albums } = useQuery({
    queryKey: ['albumList', 'newest'],
    queryFn: () => getAlbumList('newest', 7),
    enabled: offline && canFetch,
  });

  return (
    <View style={styles.grid}>
      <QuickTile href="/favorites" name={t('Favorites')} favorites />
      {offline
        ? (albums ?? []).map((a) => (
            <QuickTile
              key={a.id}
              href={`/album/${a.id}`}
              name={a.name}
              cover={coverArtUrl(a.coverArt ?? a.id, 100)}
            />
          ))
        : (playlists ?? []).slice(0, 7).map((p) => (
            <QuickTile
              key={p.id}
              href={`/playlist/${p.id}`}
              name={p.name}
              cover={coverArtUrl(p.coverArt ?? p.id, 100)}
            />
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
    return <ActivityIndicator style={styles.rowLoader} color={colors.accent} />;
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

const EXPLORE: { href: string; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { href: '/browse/albums', icon: 'disc-outline', label: 'Albums' },
  { href: '/browse/artists', icon: 'people-outline', label: 'Artists' },
  { href: '/genres', icon: 'pricetags-outline', label: 'Genres' },
  { href: '/radio', icon: 'radio-outline', label: 'Radio' },
];

// En local solo hay álbumes y artistas (radio y géneros son de servidor).
const OFFLINE_HREFS = new Set(['/browse/albums', '/browse/artists']);

function ExploreChips({ offline }: { offline: boolean }) {
  const t = useT();
  const chips = offline ? EXPLORE.filter((c) => OFFLINE_HREFS.has(c.href)) : EXPLORE;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipsRow}
      contentContainerStyle={styles.chips}
    >
      {chips.map((c) => (
        <Link key={c.href} href={c.href} asChild>
          <Pressable style={styles.chip}>
            <Ionicons name={c.icon} size={16} color={colors.text} />
            <Text style={styles.chipText}>{t(c.label)}</Text>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

function ScanningPanel() {
  const t = useT();
  const count = useScanProgress((s) => s.count);
  const total = useScanProgress((s) => s.total);
  return (
    <View style={styles.scanPanel}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.scanTitle}>{t('Scanning your music…')}</Text>
      <Text style={styles.scanSub}>
        {total > 0 ? `${count} / ${total}` : `${count}`}
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const scanning = useScanProgress((s) => s.scanning);
  const queryClient = useQueryClient();
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  const initial = offline ? 'O' : (auth?.username ?? '?').charAt(0).toUpperCase();

  // Detecta si el servidor no responde (comparte caché con la sección "newest").
  // Solo online: en local no hay servidor y la key la usa también QuickGrid.
  const { isError: serverUnreachable } = useQuery({
    queryKey: ['albumList', 'newest'],
    queryFn: () => getAlbumList('newest'),
    enabled: !!auth && !offline,
  });

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={styles.greeting}>{t('Your music')}</Text>
            {offline ? (
              <Ionicons
                name="phone-portrait-outline"
                size={28}
                color={colors.accent}
                accessibilityLabel={t('Offline')}
              />
            ) : null}
          </View>
          <View style={styles.headerRight}>
            <Link href="/settings" asChild>
              <Pressable hitSlop={10} accessibilityLabel={t('Settings')}>
                <Ionicons name="settings-outline" size={24} color={colors.textSecondary} />
              </Pressable>
            </Link>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
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
            <QuickGrid />

            {offline ? (
              <>
                <AlbumSection title={t('Recently added')} type="newest" />
                <AlbumSection title={t('Most played')} type="frequent" />
                <AlbumSection title={t('Shuffle')} type="random" />
              </>
            ) : (
              <>
                <AlbumSection title={t('Recently added')} type="newest" />
                <AlbumSection title={t('Recently played')} type="recent" />
                <AlbumSection title={t('Most played')} type="frequent" />
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.md, paddingBottom: SCREEN_BOTTOM_PADDING },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  greeting: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800' },
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
  rowLoader: { marginVertical: spacing.xl },
  scanPanel: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  scanTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  scanSub: { color: colors.textSecondary, fontSize: fontSize.sm },
});
