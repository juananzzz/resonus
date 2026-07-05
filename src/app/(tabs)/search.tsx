/** Búsqueda de álbumes y canciones en el servidor. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
// ScrollView de gesture-handler: necesario para que el swipe-a-cola de las
// filas de canciones conviva con el scroll (ver TrackRow).
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl, getPlaylists, search } from '@/api/data';
import { getGenres } from '@/api/backend';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { GenreCard } from '@/components/GenreCard';
import { GenreGridSkeleton } from '@/components/GenreGridSkeleton';
import { Message } from '@/components/Message';
import { TrackRow } from '@/components/TrackRow';
import { useDebounce } from '@/hooks/useDebounce';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useMediaMenu } from '@/store/mediaMenu';
import { currentSong, usePlayerStore } from '@/store/player';
import { useRecentSearches, type RecentItem } from '@/store/recentSearches';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

const GENRE_W = (Dimensions.get('window').width - spacing.lg * 2 - spacing.sm) / 2;

export default function SearchScreen() {
  const canSearch = useAuthStore((s) => !!s.auth || s.offline);
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const debouncedQuery = useDebounce(query.trim(), 350);
  const playing = usePlayerStore(currentSong);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const recent = useRecentSearches((s) => s.items);
  const addRecent = useRecentSearches((s) => s.add);
  const removeRecent = useRecentSearches((s) => s.remove);
  const clearRecent = useRecentSearches((s) => s.clear);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => search(debouncedQuery),
    enabled: canSearch && debouncedQuery.length > 1,
  });

  // Géneros para "Explorar todo" (solo servidor) cuando no hay búsqueda activa.
  const { data: genres, isLoading: genresLoading } = useQuery({
    queryKey: ['genres'],
    queryFn: () => getGenres(auth!),
    enabled: !!auth,
  });

  const openMediaMenu = useMediaMenu((s) => s.open);
  // Playlists: search3 de Subsonic no las devuelve, así que se filtran por
  // nombre en cliente (la lista completa ya está cacheada por otras pantallas).
  const { data: playlists } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: canSearch && debouncedQuery.length > 1,
  });
  const playlistMatches =
    debouncedQuery.length > 1
      ? (playlists ?? []).filter((p) =>
          p.name.toLowerCase().includes(debouncedQuery.toLowerCase()),
        )
      : [];

  const isEmpty = query.trim().length === 0;
  const showRecent = focused && isEmpty && recent.length > 0;
  const showBrowse = isEmpty && !showRecent && !!genres && genres.length > 0;
  const showBrowseSkeleton = isEmpty && !showRecent && !!auth && genresLoading;

  /** Subtítulo de un reciente: tipo (+ artista en álbumes/canciones). */
  const recentLabel = (item: RecentItem): string => {
    if (item.kind === 'artist') return t('Artist');
    const type = item.kind === 'album' ? t('Album') : t('Song');
    return item.artist ? `${type} · ${item.artist}` : type;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder={t('Songs, albums, artists')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {query.length > 0 ? (
          <Pressable hitSlop={10} accessibilityLabel={t('Clear')} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {showRecent ? (
          <View style={styles.section}>
            <View style={styles.recentHeader}>
              <Text style={styles.sectionTitle}>{t('Recent searches')}</Text>
              <Pressable hitSlop={8} onPress={() => clearRecent()}>
                <Text style={styles.clearAll}>{t('Clear all')}</Text>
              </Pressable>
            </View>
            <View>
              {recent.map((item) => (
                <Link key={`${item.kind}:${item.id}`} href={item.href} asChild>
                  <Pressable style={styles.recentRow}>
                    <Cover
                      uri={coverArtUrl(item.coverArt ?? item.id, 100)}
                      size={48}
                      rounded={item.kind === 'artist'}
                    />
                    <View style={styles.recentInfo}>
                      <Text style={styles.recentTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.recentSub} numberOfLines={1}>
                        {recentLabel(item)}
                      </Text>
                    </View>
                    <Pressable
                      hitSlop={10}
                      accessibilityLabel={t('Clear')}
                      onPress={() => removeRecent(item)}
                    >
                      <Ionicons name="close" size={20} color={colors.textMuted} />
                    </Pressable>
                  </Pressable>
                </Link>
              ))}
            </View>
          </View>
        ) : null}

        {showBrowse ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Browse all')}</Text>
            <View style={styles.genreGrid}>
              {genres!.map((g) => (
                <GenreCard key={g.value} name={g.value} width={GENRE_W} />
              ))}
            </View>
          </View>
        ) : showBrowseSkeleton ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Browse all')}</Text>
            <GenreGridSkeleton width={GENRE_W} />
          </View>
        ) : null}

        {isFetching ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
        ) : isError ? (
          <Message
            text={t("Couldn't reach the server. Check your connection.")}
            onRetry={() => refetch()}
          />
        ) : data &&
          debouncedQuery.length > 1 &&
          data.artists.length === 0 &&
          data.albums.length === 0 &&
          data.songs.length === 0 &&
          playlistMatches.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title={t('No results')}
            subtitle={t('No results for “{q}”', { q: debouncedQuery })}
          />
        ) : null}

        {data && data.artists.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Artists')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.albumRow}
            >
              {data.artists.map((artist) => (
                <Link key={artist.id} href={`/artist/${artist.id}`} asChild>
                  <Pressable
                    style={styles.artist}
                    onPress={() =>
                      addRecent({
                        kind: 'artist',
                        id: artist.id,
                        title: artist.name,
                        coverArt: artist.coverArt ?? artist.id,
                        href: `/artist/${artist.id}`,
                      })
                    }
                  >
                    <Cover
                      uri={coverArtUrl(artist.coverArt ?? artist.id, 200)}
                      size={110}
                      rounded
                    />
                    <Text style={styles.artistName} numberOfLines={1}>
                      {artist.name}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {data && data.albums.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Albums')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.albumRow}
            >
              {data.albums.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onPress={() =>
                    addRecent({
                      kind: 'album',
                      id: album.id,
                      title: album.name,
                      artist: album.artist,
                      coverArt: album.coverArt ?? album.id,
                      href: `/album/${album.id}`,
                    })
                  }
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {data && data.songs.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Songs')}</Text>
            {data.songs.map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                isCurrent={playing?.id === song.id}
                showArtwork={showListArtwork}
                onPress={() => {
                  if (song.albumId) {
                    addRecent({
                      kind: 'song',
                      id: song.id,
                      title: song.title,
                      artist: song.artist,
                      coverArt: song.coverArt ?? song.albumId,
                      href: `/album/${song.albumId}`,
                    });
                  }
                  playQueue(data.songs, i);
                }}
              />
            ))}
          </View>
        ) : null}

        {playlistMatches.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Playlists')}</Text>
            {playlistMatches.map((p) => (
              <Link key={p.id} href={`/playlist/${p.id}`} asChild>
                <Pressable
                  style={styles.recentRow}
                  onLongPress={() => openMediaMenu({ kind: 'playlist', playlist: p })}
                >
                  <Cover uri={coverArtUrl(p.coverArt ?? p.id, 100)} size={48} />
                  <View style={styles.recentInfo}>
                    <Text style={styles.recentTitle} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.songCount != null ? (
                      <Text style={styles.recentSub}>
                        {t('{n} songs', { n: p.songCount })}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              </Link>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    margin: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    paddingVertical: spacing.md,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clearAll: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  recentInfo: { flex: 1 },
  recentTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  recentSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  albumRow: {
    gap: spacing.md,
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  artist: {
    width: 110,
    alignItems: 'center',
    gap: spacing.xs,
  },
  artistName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
});
