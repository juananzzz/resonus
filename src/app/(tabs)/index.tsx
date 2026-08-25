/** Spotify-style Home: quick access tiles + album carousels. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  getAlbumList,
  getArtists,
  getSongList,
  getPlaylists,
  type Album,
  type Artist,
  type Playlist,
  type Song,
  COVER,
} from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { PlaylistCard } from '@/components/PlaylistCard';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { ArtistCard } from '@/components/ArtistCard';
import { Cover } from '@/components/Cover';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { SongCard } from '@/components/SongCard';
import { songsLabel, useT } from '@/i18n';
import { greetingHours } from '@/i18n/languages';
import { useAuthStore } from '@/store/auth';
import { checkAutoUrlNow } from '@/store/autoUrl';
import { useLastPlayed } from '@/store/lastPlayed';
import { usePlayerStore } from '@/store/player';
import { useScanProgress } from '@/store/scanProgress';
import { useSettings, type ExploreChipKey, type HomeSectionKey } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { columnsFor, useScreenSize } from '@/hooks/useScreenSize';
import { listPerf } from '@/lib/listPerf';
import { haptic } from '@/lib/haptics';
import { bump } from '@/lib/perfLog';
import { playShuffle } from '@/lib/playShuffle';

/**
 * How wide a quick tile wants to be, in dp.
 *
 * Two of them across a phone is what this grid has always been, and two across
 * a tablet is two buttons the length of a forearm. What it is really made of
 * is a cover and a name beside it, so that is what decides how many fit (#131).
 */
const TILE_IDEAL = 300;

/**
 * How big the covers on the shelves are.
 *
 * 150 is what a phone has always shown. On a tablet the same number is a row
 * of stamps: the screen is three times as wide and the shelf answered by
 * showing three times as many, each no bigger than before (#131).
 */
const SHELF_CARD = 150;
const SHELF_CARD_WIDE = 190;

/** How big this screen's shelf cards are. */
function useShelfCard(): number {
  const { wide } = useScreenSize();
  return wide ? SHELF_CARD_WIDE : SHELF_CARD;
}

function QuickTile({
  href,
  name,
  cover,
  favorites,
  width,
}: {
  href: string;
  name: string;
  cover?: string;
  favorites?: boolean;
  width: number;
}) {
  return (
    <Link href={href} asChild>
      {/* Flattened, not an array: expo-router hands the style straight to the
          child it clones and refuses a list. */}
      <Pressable style={StyleSheet.flatten([styles.tile, { width }])}>
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
  // Measured on every render, not once when the file was first imported:
  // otherwise turning the phone leaves the tiles at the width they had when
  // the app started (#131).
  const { width } = useScreenSize();
  const columns = columnsFor(width, TILE_IDEAL, 2, 4);
  const tile = (width - spacing.lg * 2 - spacing.sm * (columns - 1)) / columns;
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const times = useLastPlayed((s) => s.times);
  const names = useLastPlayed((s) => s.names);
  const t = useT();
  // Configurable sources and size (Settings → Appearance → Quick grid). Each
  // source is only queried if active; size is the total tile count (Favorites
  // included when pinned).
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

  // Spotify-style dynamic grid: mixes playlists and recent albums sorted by
  // last play (same store as "Recents" in the Library). What you just listened
  // to rises; the rest is filled with recent albums (server order) and fresh
  // playlists (by modification date). Favorites is always pinned first, outside
  // this sorting.
  // Favorites, if pinned, takes one slot from the total; the rest is
  // distributed among active sources sorted by last play.
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
            cover: coverArtUrl(p.coverArt ?? p.id, COVER.thumb),
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
            cover: coverArtUrl(a.coverArt ?? a.id, COVER.thumb),
            ts: times[href] ?? 0,
          };
        })
      : [];
    // What was played and neither list mentions. The order here has always
    // been what YOU listened to, but what could be sorted was whatever the
    // server had handed over: its "recent" albums are the ones it has a play
    // date for, so an album whose scrobble never landed — or that was played
    // with no connection at all — had no tile to rise to the top, and the
    // grid looked like it updated for some things and not for others. The
    // name was written down when it played and the cover comes from the id,
    // so nothing else has to be asked for.
    const known = new Set([...pl, ...al].map((it) => it.href));
    const played: Item[] = Object.entries(times)
      .filter(([href]) => !known.has(href))
      .map(([href, ts]): Item | null => {
        const [, kind, id] = href.split('/');
        const name = names[href];
        if (!name || !id) return null;
        if (kind === 'album' ? !withAlbums : kind === 'playlist' ? !withPlaylists : true) {
          return null;
        }
        return { key: href, href, name, cover: coverArtUrl(id, COVER.thumb), ts };
      })
      .filter((it): it is Item => it !== null);
    return [...al, ...pl, ...played].sort((x, y) => y.ts - x.ts).slice(0, dynamicCount);
  }, [playlists, albums, times, names, withPlaylists, withAlbums, dynamicCount]);

  // Without active sources there's nothing to show (the master toggle still
  // decides if the block mounts; this covers "all off" from here).
  if (!withFavorites && tiles.length === 0) return null;

  return (
    <View style={styles.grid}>
      {withFavorites ? (
        <QuickTile href="/favorites" name={t('Favorites')} favorites width={tile} />
      ) : null}
      {tiles.map((it) => (
        <QuickTile key={it.key} href={it.href} name={it.name} cover={it.cover} width={tile} />
      ))}
    </View>
  );
}

/**
 * The heading of a shelf, with the way through to everything behind it.
 *
 * The whole row is the target, not just the words on the right: the title is
 * what you are reaching for, and a two word link beside it is a smaller thing
 * to hit than the thing it belongs to.
 */
function SectionHeader({ title, href }: { title: string; href: string }) {
  const t = useT();
  return (
    <Link href={href} asChild>
      <Pressable style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderTitle}>{title}</Text>
        <Text style={styles.showAll}>{t('Show all')}</Text>
      </Pressable>
    </Link>
  );
}

/**
 * A shelf of albums, and the way through to the rest of them.
 *
 * Where it goes is not a generic list: "Most played albums" opens the Albums
 * screen already under Most played, so what you tapped is what you get rather
 * than a list you then have to sort yourself.
 */
function AlbumSection({
  title,
  type,
}: {
  title: string;
  type: 'recent' | 'newest' | 'frequent' | 'random' | 'byYear';
}) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const card = useShelfCard();
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
      <SectionHeader title={title} href={`/browse/albums?sort=${type}`} />
      <FlatList
        {...listPerf}
        horizontal
        data={data}
        keyExtractor={(item: Album) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item }) => <AlbumCard album={item} width={card} />}
      />
    </View>
  );
}

/** How many songs the "Most played" shelf holds, and plays. */
const MOST_PLAYED_SONGS = 30;

/**
 * The songs played most, as songs.
 *
 * The shelf beside it answers the same question with records, which is the only
 * thing a Subsonic server can sort, and reads wrong for anyone who does not
 * listen to albums whole: a record turns up there because one of its songs is
 * on repeat, which is how a user put it. This is the other half of that answer,
 * and it is a queue rather than a place to go — tapping a song plays the shelf
 * from it, in the order it is drawn in, which is the order of how much each was
 * played.
 */
function MostPlayedSongsSection({ title }: { title: string }) {
  const openSongMenu = useSongMenu((s) => s.open);
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const card = useShelfCard();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const currentId = usePlayerStore((s) => s.queue[s.index]?.id);
  const { accent } = useTheme();
  // Through the same door the Songs screen uses for this order, and not
  // through `getMostPlayedSongs`: Navidrome and Jellyfin sort songs by plays
  // themselves, one request, and only a server that can do neither pays for
  // the fifteen albums the answer has to be built out of (#50). That is also
  // why this shelf is off until someone turns it on.
  const { data, isLoading } = useQuery({
    queryKey: ['browseSongs', 'frequent', MOST_PLAYED_SONGS],
    queryFn: () => getSongList('frequent', MOST_PLAYED_SONGS),
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
      <SectionHeader title={title} href="/browse/songs?sort=frequent" />
      <FlatList
        {...listPerf}
        horizontal
        data={data}
        keyExtractor={(item: Song) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item, index }) => (
          <SongCard
            song={item}
            width={card}
            accent={accent}
            isCurrent={item.id === currentId}
            // The whole shelf goes into the queue, not the song on its own:
            // what was asked for is a list of these to listen through.
            onPress={() => void playQueue(data, index, title)}
            // What holding an album on the shelf beside it does, for a song:
            // its own menu, the one the ⋯ of every row opens. Holding a card
            // in the Songs screen starts selecting instead, which is that
            // screen's answer and needs a selection to start; here there is
            // none, and the menu is what the gesture is for everywhere else.
            onLongPress={() => {
              haptic('light');
              openSongMenu(item);
            }}
          />
        )}
      />
    </View>
  );
}

/** Playlist row (quick access from Home). Also exists offline (local
 *  playlists), so it's not filtered like server-only ones. */
function PlaylistsSection({ title }: { title: string }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const card = useShelfCard();
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
        renderItem={({ item }) => <PlaylistCard playlist={item} width={card} />}
      />
    </View>
  );
}

/** Pick one (Fisher-Yates); for the "random" sections. */
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** And the round ones, which are their own shelf. */
const ARTIST_SIZE = 130;
const ARTIST_SIZE_WIDE = 165;

/**
 * How long this shelf waits before asking.
 *
 * Subsonic has no way to ask for a few artists, so showing ten means fetching
 * the index of every artist there is: half a megabyte and a second and a half
 * on a large library over a slow connection. Worth it for the shelf, not worth
 * it in the middle of a cold start, where it sits in the queue in front of the
 * screens someone is actually waiting for.
 */
const ARTISTS_DELAY_MS = 4000;

/** Row of random artists (rediscovery). */
function ArtistSection({ title, reshuffleKey }: { title: string; reshuffleKey: number }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const { wide } = useScreenSize();
  const artistSize = wide ? ARTIST_SIZE_WIDE : ARTIST_SIZE;
  // Offline the list comes off the device, so there is nothing to keep out of
  // the way of and no reason to wait.
  const [ready, setReady] = useState(() => useAuthStore.getState().offline);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setReady(true), ARTISTS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready]);
  const { data, isLoading } = useQuery({
    queryKey: ['artists'],
    queryFn: () => getArtists(),
    enabled: canFetch && ready,
  });
  // Reshuffles when the list changes or on pull-to-refresh (`reshuffleKey`).
  // Without that key, when the list doesn't change react-query keeps the same
  // reference (structural sharing) and the memo would always return the same
  // 10 artists.
  const artists = useMemo(
    () => (data ? shuffled(data).slice(0, 10) : []),
    [data, reshuffleKey],
  );

  // The skeleton covers the wait as well as the request, so the shelf holds
  // its place instead of appearing from nowhere four seconds in.
  if (isLoading || (canFetch && !ready)) {
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
      <SectionHeader title={title} href="/browse/artists?sort=random" />
      <FlatList
        {...listPerf}
        horizontal
        data={artists}
        keyExtractor={(item: Artist) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowContent}
        renderItem={({ item }) => <ArtistCard artist={item} width={artistSize} />}
      />
    </View>
  );
}

// Discover = rediscover: OpenSubsonic has no dedicated endpoint, so we take
// your albums by last play (`recent`), skip the most recent ones (offset) and
// shuffle the tail → "listened to but not lately".
const DISCOVER_OFFSET = 15;
const DISCOVER_POOL = 50;

function DiscoverSection({ title, reshuffleKey }: { title: string; reshuffleKey: number }) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const card = useShelfCard();
  const { data, isLoading } = useQuery({
    queryKey: ['albumList', 'discover'],
    queryFn: () => getAlbumList('recent', DISCOVER_POOL, DISCOVER_OFFSET),
    enabled: canFetch,
  });
  // Reshuffles when changing the list or on pull-to-refresh (`reshuffleKey`);
  // see the note in ArtistSection about react-query's structural sharing.
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
        renderItem={({ item }) => <AlbumCard album={item} width={card} />}
      />
    </View>
  );
}

/** Look and target of each chip; order and state are set by the user
 *  (Settings → Appearance → Explore chips). Without `href` = plays instead of
 *  navigating (only the shuffle one). */
const EXPLORE: Record<ExploreChipKey, { href?: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  shuffle: { icon: 'shuffle', label: 'Shuffle' },
  favorites: { href: '/favorites', icon: 'heart-outline', label: 'Favorites' },
  albums: { href: '/browse/albums', icon: 'disc-outline', label: 'Albums' },
  artists: { href: '/browse/artists', icon: 'people-outline', label: 'Artists' },
  songs: { href: '/browse/songs', icon: 'musical-notes-outline', label: 'Songs' },
  genres: { href: '/genres', icon: 'pricetags-outline', label: 'Genres' },
  radio: { href: '/radio', icon: 'radio-outline', label: 'Radio' },
  history: { href: '/history', icon: 'time-outline', label: 'Recently played' },
  audiobooks: { href: '/audiobooks', icon: 'book-outline', label: 'Audiobooks' },
};

// Locally there is shuffle, albums, artists and songs (radio and genres are
// server-side).
const OFFLINE_KEYS = new Set<ExploreChipKey>([
  'shuffle',
  'favorites',
  'albums',
  'artists',
  'songs',
  // The history is this phone's own: what was played on it, written down as it
  // played. It needs nobody, so hiding it offline hid a screen that worked.
  'history',
]);

function ExploreChips({ offline }: { offline: boolean }) {
  const t = useT();
  const chips = useSettings((s) => s.exploreChips).filter(
    (c) => c.enabled && (!offline || OFFLINE_KEYS.has(c.key)),
  );
  // Icons off leaves the name on its own (Settings › Explore chips): the row
  // reads as words rather than as buttons, and more of it fits on screen.
  const icons = useSettings((s) => s.exploreChipIcons);
  // The shuffle one takes whatever the server returns: without this, you tap
  // and nothing happens for half a second and it feels broken.
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

  // No chips means no row: this replaces the master toggle that was there.
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
        // The shuffle one is the only one that plays instead of taking you
        // somewhere: asking for it and getting a list is the opposite of what
        // you asked for.
        if (!cfg.href) {
          return (
            <Pressable
              key={key}
              style={styles.chip}
              accessibilityRole="button"
              onPress={onShuffle}
            >
              {/* The spinner stays even with the icons off: it is the only
                  thing saying the tap did something while the server picks the
                  songs, and it is the whole reason it is here. */}
              {shuffling ? (
                <ActivityIndicator size={16} color={colors.text} />
              ) : icons ? (
                <Ionicons name={cfg.icon} size={16} color={colors.text} />
              ) : null}
              <Text style={styles.chipText}>{t(cfg.label)}</Text>
            </Pressable>
          );
        }
        return (
          <Link key={key} href={cfg.href} asChild>
            <Pressable style={styles.chip}>
              {icons ? <Ionicons name={cfg.icon} size={16} color={colors.text} /> : null}
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
  const lang = useSettings((s) => s.language);
  const phase = useScanProgress((s) => s.phase);
  const count = useScanProgress((s) => s.count);
  const total = useScanProgress((s) => s.total);
  const fraction = total > 0 ? Math.min(count / total, 1) : 0;
  // The width comes directly from the fraction, without animating. Animating
  // made sense when progress arrived in 10% jumps, but now it comes in 1%
  // steps: that IS the animation. With ticks that close together, each 250 ms
  // `timing` would die halfway and another would start from where it left off,
  // so the bar never reached the truth — it would stay at half when done.
  // It didn't save renders either: this panel already repaints on every tick
  // for the text.
  // Each phase says its thing: the number goes up the same, but under a title
  // that promises what's really happening.
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
          <View
            style={[styles.scanBarFill, { width: `${fraction * 100}%`, backgroundColor: colors.accent }]}
          />
        </View>
      ) : (
        <ActivityIndicator color={colors.accent} />
      )}
      <Text style={styles.scanSub}>
        {total > 0
          ? `${count} / ${total} · ${Math.round(fraction * 100)}%`
          : songsLabel(count, lang)}
      </Text>
    </View>
  );
}

/** Title (i18n key) and list type for the sections that use AlbumSection.
 *  «discover» and «randomArtists» are drawn by components of their own. */
const HOME_ALBUM_CONFIG: Record<
  Exclude<HomeSectionKey, 'randomArtists' | 'discover' | 'playlists' | 'mostPlayedSongs'>,
  { title: string; type: 'newest' | 'recent' | 'frequent' | 'random' | 'byYear' }
> = {
  recentlyAdded: { title: 'Recently added', type: 'newest' },
  // When the record came out, not when the server got hold of it: a batch of
  // ten-year-old albums imported last night is what fills the shelf above.
  newReleases: { title: 'New releases', type: 'byYear' },
  recentlyPlayed: { title: 'Recently played', type: 'recent' },
  // Named for what it holds now that the songs have a shelf of their own next
  // to it, or the two would read as the same thing twice.
  mostPlayed: { title: 'Most played albums', type: 'frequent' },
  randomAlbums: { title: 'Random albums', type: 'random' },
};

export default function HomeScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  // Counted, to answer whether a tab you have visited keeps working
  // afterwards: they stay mounted once opened, and freezing them is
  // supposed to stop them rendering while they are not on screen. If this
  // climbs while you are somewhere else, it does not.
  bump('render · home');
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const bottomPad = useScreenBottomPadding();
  const scanning = useScanProgress((s) => s.phase !== 'idle');
  const queryClient = useQueryClient();
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  // Increments on each pull-to-refresh to force that the random rows (artists
  // and Discover) bring a new selection even if the library hasn't changed.
  const [reshuffleKey, setReshuffleKey] = useState(0);
  const showHistoryButton = useSettings((s) => s.showHistoryButton);
  const showProfileButton = useSettings((s) => s.showProfileButton);
  const showQuickGrid = useSettings((s) => s.showQuickGrid);
  const showGreeting = useSettings((s) => s.showGreeting);
  const customGreeting = useSettings((s) => s.customGreeting);
  const language = useSettings((s) => s.language);
  const homeSections = useSettings((s) => s.homeSections);
  // The avatar ring reads the store's accent (not the global constant), so it
  // always recolors when changed or after hydrating; Home is the initial screen
  // and renders before the saved accent is applied.
  const { accent: accentColor } = useTheme();
  useSettings((s) => s.appFont); // re-render when font changes
  // 'O' only in local profile (no account); a server account offline still
  // shows its initial.
  const initial = offline && !auth ? 'O' : (auth?.username ?? '?').charAt(0).toUpperCase();

  // Four slots, and when each one starts comes from the language rather than
  // from here: at 6pm English is in the evening and Spanish is still in the
  // afternoon, so a single set of hours was right in one language and wrong in
  // the others (it used to be the Spanish one for everybody). Spanish and
  // Catalan say the same thing for the last two ("Buenas noches" / "Bona nit"),
  // which is why splitting them costs those two nothing.
  const [morning, afternoon, evening] = greetingHours(language);
  const [slotTick, nextSlot] = useReducer((n: number) => n + 1, 0);
  const hour = new Date().getHours();
  const byHour =
    hour >= morning && hour < afternoon
      ? t('Good morning')
      : hour >= afternoon && hour < evening
        ? t('Good afternoon')
        : hour >= evening
          ? t('Good evening')
          : t('Good night');
  // Custom takes priority; leaving it blank falls back to the time-based one,
  // so clearing it is the way to undo (no need for a "reset" button).
  const greeting = customGreeting.trim() || byHour;

  // The hour is only read while rendering, so a Home left open kept saying good
  // morning into the afternoon. One timer, armed for the next slot and re-armed
  // on each tick (a timeout that fires a moment early lands on the same hour,
  // and this re-arms it rather than getting stuck there).
  useEffect(() => {
    if (!showGreeting || customGreeting.trim()) return;
    const now = new Date();
    const cuts = [0, morning, afternoon, evening].sort((a, b) => a - b);
    const next = cuts.find((h) => h > now.getHours());
    const at = new Date(now);
    at.setMinutes(0, 0, 0);
    if (next == null) {
      at.setDate(at.getDate() + 1);
      at.setHours(cuts[0]);
    } else {
      at.setHours(next);
    }
    const id = setTimeout(nextSlot, Math.max(1000, at.getTime() - now.getTime()));
    return () => clearTimeout(id);
  }, [slotTick, morning, afternoon, evening, showGreeting, customGreeting]);

  // Detects if the server is unreachable (shares cache with the "newest" section).
  // Online only: locally there is no server and the key is also used by QuickGrid.
  const { isError: serverUnreachable } = useQuery({
    queryKey: ['albumList', 'newest'],
    queryFn: () => getAlbumList('newest'),
    enabled: !!auth && !offline,
  });

  // Server unreachable with network up (not only when network drops):
  // triggers a probe. If it truly doesn't reach and there are downloads,
  // the engine falls to offline only (see store/autoUrl.ts).
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
          {/* `flexShrink` and `numberOfLines`: the greeting is customizable,
              and although the setting caps it at GREETING_MAX, those characters
              measure differently depending on the chosen font. Shrinking and
              trimming, no text can push the buttons off-screen. */}
          <View style={styles.headerLeft}>
            {/* Nothing beside the greeting in the local profile. There used to
                be a phone in the accent colour here, and it was the one thing
                on the screen saying which profile you were in. That is the
                trouble with it: the local profile is not a state you are
                waiting to come out of, it is where somebody has chosen to be,
                and a permanent badge for it is decoration. Offline is a
                different matter and still says so, on the right. */}
            {showGreeting ? (
              <Text style={styles.greeting} numberOfLines={1}>
                {greeting}
              </Text>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            {/* Before the buttons, and dimmer than them, so it reads as a state
                and not as something to press. */}
            <OfflineIndicator />
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

            {/* Toggleable and reorderable rows (Settings → Personalization →
                Home sections). «Recently played» doesn't exist offline. */}
            {homeSections.map((s) => {
              // «Discover» depends on server history (recent with offset):
              // not applicable offline. «Recently played» does: the local
              // history records just the same in that mode.
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
              if (s.key === 'mostPlayedSongs') {
                return <MostPlayedSongsSection key={s.key} title={t('Most played songs')} />;
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

const styles = themed((colors) => ({
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
  greeting: { color: colors.text, fontSize: 30, fontWeight: '600', flexShrink: 1 },
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
  // Same shape as the artist's shelves: title on the left, the way in on the
  // right, and the whole row pressable.
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
}));
