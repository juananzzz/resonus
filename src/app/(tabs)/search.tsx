/** Album and song search on the server. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Link, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
// gesture-handler ScrollView: needed so the song row swipe-to-queue coexists
// with scrolling (see TrackRow).
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COVER, coverArtUrl, getPlaylists, search } from '@/api/data';
import { getGenres, getRadioStations } from '@/api/backend';
import { playRadio } from '@/lib/playRadio';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { GenreCard } from '@/components/GenreCard';
import { GenreGridSkeleton } from '@/components/GenreGridSkeleton';
import { Message } from '@/components/Message';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { TrackRow } from '@/components/TrackRow';
import { useDebounce } from '@/hooks/useDebounce';
import { songsLabel, useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { onTabReselect, takeSearchFocus } from '@/lib/tabOrigin';
import { bump } from '@/lib/perfLog';
import { useAuthStore } from '@/store/auth';
import { useMediaMenu } from '@/store/mediaMenu';
import { currentSong, usePlayerStore } from '@/store/player';
import { useRecentSearches, type RecentItem } from '@/store/recentSearches';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';

/** How wide a genre card wants to be, in dp: two across a phone, and as many
 *  as fit at that size on anything wider (#131). */
const GENRE_IDEAL = 220;

export default function SearchScreen() {
  // Counted, to answer whether a tab you have visited keeps working
  // afterwards: they stay mounted once opened, and freezing them is
  // supposed to stop them rendering while they are not on screen. If this
  // climbs while you are somewhere else, it does not.
  bump('render · search');
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  useSettings((s) => s.appFont); // re-render when font changes
  // Worked out while rendering, so turning the phone re-lays the cards out.
  // The whole page is one centred column on a wide screen, like the lists and
  // the settings, and the cards are measured against that column and not
  // against the screen (#131).
  const { width } = useScreenSize();
  const pagePad = centredPadding(width, spacing.lg);
  const inner = width - pagePad * 2;
  const genreCols = Math.max(2, Math.min(5, Math.round(inner / GENRE_IDEAL)));
  const genreW = (inner - spacing.sm * (genreCols - 1)) / genreCols;
  const offline = useAuthStore((s) => s.offline);
  const canSearch = useAuthStore((s) => !!s.auth || s.offline);
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const bottomPad = useScreenBottomPadding();
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

  // Tapping the Search tab while already on Search raises the keyboard.
  //
  // Entering here doesn't focus on purpose: without focus the screen offers
  // the genre grid, and the keyboard would cover it. But whoever already knows
  // what they want was paying an extra tap on the box, always. So both
  // intentions coexist, each with its own gesture.
  //
  // It's not a double tap with a time window, which would be an arbitrary
  // number (short for some, long for others): `tabPress` arrives before the
  // tab activates, so coming from another tab the first tap doesn't focus and
  // the second one does — feels the same as a double tap. And if you're already
  // here, one is enough.
  // Typed by what is used and nothing else. `tabPress` belongs to the tab
  // navigator, and the types for it used to come from `@react-navigation/*`,
  // which expo-router no longer installs: the navigation API is its own now.
  const navigation = useNavigation<{
    addListener: (event: 'tabPress' | 'blur', callback: () => void) => () => void;
    isFocused: () => boolean;
  }>();
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    const focusBox = () => {
      if (navigation.isFocused()) inputRef.current?.focus();
    };
    // Two bars can raise this and only one of them is the navigator's: see
    // `onTabReselect`.
    const stopTabPress = navigation.addListener('tabPress', focusBox);
    const stopReselect = onTabReselect('search', focusBox);
    // Leaving the tab gives the box up.
    //
    // Nothing does it otherwise: the tab is never unmounted, only frozen, so
    // the input keeps the focus it had while you are away. Asking an input
    // that already has focus to take it does nothing at all, keyboard
    // included, so the gesture worked once and then never again for the rest
    // of the session. It also left the screen showing the recent searches, on
    // the strength of a focus nobody could see.
    const stopBlur = navigation.addListener('blur', () => inputRef.current?.blur());
    return () => {
      stopTabPress();
      stopReselect();
      stopBlur();
    };
  }, [navigation]);

  // Arriving from the button on Home, which asks for the box before it sends
  // anybody here. On focus rather than on mount: the tab is never unmounted
  // once opened, so every visit after the first is a focus and nothing else.
  useFocusEffect(
    useCallback(() => {
      if (!takeSearchFocus()) return;
      inputRef.current?.focus();
      // Asked for twice, because once is not reliable. A screen still on its
      // way in will take the cursor and leave the keyboard down, and there is
      // nothing to retry from: the input answers `isFocused()` yes, so only
      // the keyboard itself can say whether it worked. The second go is
      // preceded by a `blur` for the reason the tab gesture below documents:
      // asking an input that already has focus to take it does nothing at all,
      // keyboard included.
      const id = setTimeout(() => {
        if (Keyboard.isVisible()) return;
        inputRef.current?.blur();
        inputRef.current?.focus();
      }, 250);
      return () => clearTimeout(id);
    }, []),
  );

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => search(debouncedQuery),
    enabled: canSearch && debouncedQuery.length > 1,
  });

  // Genres for the browse grid (server only) when there's no active search.
  //
  // Not offline: a genre is the server's idea and there is no local index of
  // them, so the section had nothing to open even when it drew. What it did
  // instead was ask, fail, and leave its skeleton behind on the way.
  const { data: genres, isLoading: genresLoading } = useQuery({
    queryKey: ['genres'],
    queryFn: () => getGenres(auth!),
    enabled: !!auth && !offline,
  });

  const openMediaMenu = useMediaMenu((s) => s.open);
  // Playlists: Subsonic's search3 doesn't return them, so they're filtered by
  // name client-side (the full list is already cached by other screens).
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
  // Stations, filtered the same way and for the same reason. Server only:
  // Jellyfin doesn't manage them and offline there's nothing to stream.
  const { data: stations } = useQuery({
    queryKey: ['radioStations'],
    queryFn: () => getRadioStations(auth!),
    enabled: !!auth && !offline && debouncedQuery.length > 1,
  });
  const stationMatches =
    debouncedQuery.length > 1
      ? (stations ?? []).filter((r) =>
          r.name.toLowerCase().includes(debouncedQuery.toLowerCase()),
        )
      : [];

  // Built once per genre list and not on every render of this screen. There is
  // no ceiling on how many a library has, they are all laid out at once (no
  // list to recycle them), and this screen re-renders for reasons that have
  // nothing to do with them: a setting, the song that started playing, a
  // keystroke. Same elements, so React walks past the whole grid instead of
  // rebuilding it.
  const genreGrid = useMemo(
    () =>
      genres?.map((g) => (
        <GenreCard key={g.value} name={g.value} albumCount={g.albumCount} width={genreW} />
      )),
    [genres, genreW],
  );

  const isEmpty = query.trim().length === 0;
  const showRecent = focused && isEmpty && recent.length > 0;
  const showBrowse = isEmpty && !showRecent && !!genres && genres.length > 0;
  const showBrowseSkeleton = isEmpty && !showRecent && !!auth && !offline && genresLoading;

  /** Recent item subtitle: type (+ artist for albums/songs). */
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
          ref={inputRef}
          style={styles.input}
          placeholder={t('What do you want to listen to?')}
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
        <OfflineIndicator />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPad, paddingHorizontal: pagePad },
        ]}
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
                      uri={coverArtUrl(item.coverArt ?? item.id, COVER.thumb)}
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
            <View style={styles.genreGrid}>{genreGrid}</View>
          </View>
        ) : showBrowseSkeleton ? (
          <View style={styles.section}>
            <GenreGridSkeleton width={genreW} />
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
          playlistMatches.length === 0 &&
          stationMatches.length === 0 ? (
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
              // Its own, and not the page's: a nested scroll view does not
              // inherit it, so with the keyboard up the first tap on a card
              // was spent closing it and the second one was the one that
              // opened the artist.
              keyboardShouldPersistTaps="handled"
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
                      uri={coverArtUrl(artist.coverArt ?? artist.id, COVER.thumb)}
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
              // Its own, like the row of artists above it.
              keyboardShouldPersistTaps="handled"
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
                  onLongPress={() => { haptic('light'); openMediaMenu({ kind: 'playlist', playlist: p }); }}
                >
                  <Cover uri={coverArtUrl(p.coverArt ?? p.id, COVER.thumb)} size={48} />
                  <View style={styles.recentInfo}>
                    <Text style={styles.recentTitle} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.songCount != null ? (
                      <Text style={styles.recentSub}>
                        {songsLabel(p.songCount, lang)}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              </Link>
            ))}
          </View>
        ) : null}

        {stationMatches.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Radio')}</Text>
            {stationMatches.map((r) => (
              <Pressable
                key={r.id}
                style={styles.recentRow}
                onPress={() => void playRadio(r)}
              >
                <Cover
                  uri={coverArtUrl(r.coverArt, COVER.thumb)}
                  size={48}
                  rounded
                  placeholderIcon="radio"
                />
                <View style={styles.recentInfo}>
                  <Text
                    style={[styles.recentTitle, playing?.id === r.id && { color: colors.accent }]}
                    numberOfLines={1}
                  >
                    {r.name}
                  </Text>
                  {r.homePageUrl ? (
                    <Text style={styles.recentSub} numberOfLines={1}>
                      {r.homePageUrl}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
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
}));
