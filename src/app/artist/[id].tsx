/** Artist detail, Spotify-style: large header, actions, sections. */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
// gesture-handler ScrollView: needed so the "Popular" row swipe-to-queue
// coexists with scrolling (see TrackRow).
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  getAlbum,
  getAppearsOn,
  getArtist,
  getArtistInfo,
  getTopSongs,
  COVER,
} from '@/api/data';
import { type Album, type Artist, type Song } from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { CoverViewer } from '@/components/CoverViewer';
import { Dialog } from '@/components/Dialog';
import { FavoriteButton } from '@/components/FavoriteButton';
import { TopBarBackground } from '@/components/BarBlur';
import { BackButton } from '@/components/BackButton';
import { Message } from '@/components/Message';
import { SheetModal } from '@/components/SheetModal';
import { StarRating } from '@/components/StarRating';
import { TrackRow } from '@/components/TrackRow';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useT } from '@/i18n';
import { splitArtistAlbums } from '@/lib/artistAlbums';
import { groupArtistAlbums, RELEASE_GROUP_TITLE } from '@/lib/releaseGroups';
import { canShareResonusLink, shareResonusLink } from '@/lib/shareLink';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { anyDownloads, groupDownloadState, useDownloads } from '@/store/downloads';
import { currentSong, usePlayerStore } from '@/store/player';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme, tracking } from '@/theme';
import { BackChevron } from '@/components/BackChevron';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useScreenSize } from '@/hooks/useScreenSize';

/**
 * How tall the picture across the top is.
 *
 * A square as wide as the screen, capped: the cap is what keeps it from being
 * the entire page on a tablet, and the share of the height is what keeps it
 * from being the entire page on a phone lying on its side, where 360 points is
 * everything there is (#131).
 */
function headerHeight(width: number, height: number): number {
  return Math.round(Math.min(width, height * 0.6, 360));
}
/**
 * The page, with its scroll wired straight to the animations it drives.
 *
 * The header moves and fades with the scroll, and until this existed every
 * frame of that went through JS: the list scrolled natively while the photo,
 * the name and the top bar waited their turn behind whatever else the thread
 * was doing. With music playing there is always something else, twice a second
 * at least, and what it looks like is a header that stutters against a list
 * that does not (#154). Handing the scroll to the native side takes the whole
 * thing off the thread: it cannot be late any more, whatever JS is up to.
 *
 * What it costs is that only opacity and transforms can be animated this way,
 * which is all four of the ones below.
 */
const AnimatedPage = Animated.createAnimatedComponent(ScrollView);

const CARD_W = 140;
/**
 * Cards per album row. The rows are for a look around, not for the whole
 * catalogue — that's what "Show all" is for — but ten was short enough that
 * regular discographies didn't fit (#69). The row is virtualized, so what this
 * really caps is how far you can swipe before being sent to the full list.
 */
const ROW_LIMIT = 50;

export default function ArtistScreen() {
  const bottomPad = useScreenBottomPadding();
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const sourceHref = usePlayerStore((s) => s.sourceHref);
  const togglePlay = usePlayerStore((s) => s.toggle);
  const playerShuffle = usePlayerStore((s) => s.shuffle);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [songsExpanded, setSongsExpanded] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  // ⋯ menu (imperative: opening/closing doesn't re-render the screen).
  const menuRef = useRef<() => void>(() => {});
  // The stars take over the sheet rather than sitting among the actions, the
  // same way the song menu does it: five targets in a row need the width, and
  // a rating is a thing you set, not an action you fire and dismiss.
  const [menuMode, setMenuMode] = useState<'actions' | 'rating'>('actions');
  // Rating is Subsonic's `setRating`, which Jellyfin has no answer for. Offline
  // it is recorded and sent on reconnect, so it stays; a local profile has no
  // account and never gets here.
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const canRate = useAuthStore((s) => !!s.auth) && serverType !== 'jellyfin';

  // ── Download the discography ────────────────────────────────────────────
  // With `songIds` intentionally empty: `groupDownloadState` can only say
  // "downloaded" by comparing ids against disk, and this screen doesn't have
  // the songs — only the albums. So here the state is two-valued ('none' /
  // 'active'), and songs are fetched on press.
  const offline = useAuthStore((s) => s.offline);
  const download = useDownloads(useShallow((s) => groupDownloadState(s, `artist:${id}`, [])));
  const downloadArtist = useDownloads((s) => s.downloadArtist);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  // The boolean, not the map: it is replaced with every song that finishes
  // downloading, so subscribing to it re-rendered the screen on each one (#50).
  const hasDownloads = useDownloads(anyDownloads);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDeleteDl, setConfirmDeleteDl] = useState(false);
  /** While fetching each album's songs, before downloading anything. */
  const [gathering, setGathering] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  /** Gathering the discography for a play button that has no popular tracks. */
  const [starting, setStarting] = useState(false);
  /** Songs already gathered, awaiting dialog confirmation. */
  const [pending, setPending] = useState<Song[] | null>(null);
  const downloadMsg = useDownloadMessage(pending ?? []);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);

  // Read while rendering, so a turn re-measures the header instead of keeping
  // the one the app started with.
  const { width: screenW, height: screenH } = useScreenSize();
  const headerH = headerHeight(screenW, screenH);

  const scrollY = useRef(new Animated.Value(0)).current;
  const barContentOpacity = scrollY.interpolate({
    inputRange: [headerH * 0.45, headerH * 0.75],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const barBgOpacity = scrollY.interpolate({
    inputRange: [0, headerH * 0.75],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const nameOpacity = scrollY.interpolate({
    inputRange: [0, headerH * 0.55],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const imgTranslate = scrollY.interpolate({
    inputRange: [-headerH, 0, headerH],
    outputRange: [headerH / 2, 0, -headerH / 3],
    extrapolate: 'clamp',
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id),
    enabled: canFetch && !!id,
  });
  const name = data?.artist.name;

  // The artist's own `coverArt`, not their id, and it is worth the wait for
  // `data`. Navidrome 0.64 stopped treating the two as interchangeable: an
  // artwork id carries a hash of the picture, and only a request that asks for
  // the current hash is answered `immutable`. A bare id gets `no-cache` and is
  // revalidated on every single load. Worse, while the server is still
  // resolving the artwork in the background it answers with a placeholder, and
  // `expo-image` on Android caches by URL without consulting the headers that
  // say not to. Asking by bare id means that grey square is what this screen's
  // colour is taken from, and the URL never changes to shake it off. Until
  // `data` arrives there is nothing to ask for, which is a frame or two of no
  // tint rather than a wrong one.
  const dominant = useDominantColor(
    canFetch && data ? coverArtUrl(data.artist.coverArt ?? id, COVER.thumb) : undefined
  );

  // Keyed by id as well as name, and both are load-bearing. The id is what
  // tells two artists who share a name apart, which is the whole reason it is
  // sent (see `getTopSongs`); keeping only the name in the key would hand the
  // second one the first one's songs out of the cache, whatever the server
  // answered. The name stays because it is what older servers answer by, so a
  // rename has to miss.
  const { data: topSongs } = useQuery({
    queryKey: ['topSongs', id, name],
    queryFn: () => getTopSongs(name!, 20, id),
    enabled: canFetch && !!name,
  });

  const { data: info } = useQuery({
    queryKey: ['artistInfo', id],
    queryFn: () => getArtistInfo(id),
    enabled: canFetch && !!id,
  });

  const { data: appearsOn } = useQuery({
    queryKey: ['appearsOn', id],
    queryFn: () => getAppearsOn(id, name!),
    enabled: canFetch && !!id && !!name,
  });

  // Like in the album: the heart reads from the central favorites list, which
  // does refresh on starring (getArtist's `starred` becomes stale).
  const favArtistIds = useFavoriteIds(canFetch, 'artist');

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
        <BackButton />
        <Message text={t("Couldn't load the artist.")} onRetry={() => refetch()} />
      </View>
    );
  }

  const top = topSongs ?? [];
  // The header play button doubles as play/pause when the queue currently
  // playing is this artist's (Spotify-style); otherwise it starts the popular
  // tracks. `sourceHref` identifies the context regardless of how it started
  // (the play button and shuffle both set it).
  const isCurrentArtistQueue = sourceHref === `/artist/${id}`;
  const showPause = isCurrentArtistQueue && isPlaying;
  // Shuffle icon lights up (accent) while this artist's queue is the one playing
  // and it's shuffled — same "reflects the live state" idea as the play button.
  const shuffleActive = isCurrentArtistQueue && playerShuffle;
  const { own: albums, guest: guestAlbums } = splitArtistAlbums(data.albums, appearsOn ?? []);
  const releaseGroups = groupArtistAlbums(albums);
  const headerUri =
    info?.imageUrl ?? coverArtUrl( data.artist.coverArt ?? data.artist.id, COVER.full);

  async function shufflePlay() {
    if (shuffling) return;
    // Shuffle the artist's whole discography (own albums only; "Appears on" is
    // excluded so unrelated tracks don't land in the queue). Falls back to the
    // top tracks when there are no albums to gather.
    // The queue goes in dealt and the shuffle mode is left alone: it used to be
    // turned on here, and the mode is remembered, so it came back on for the
    // next album played from anywhere else.
    if (albums.length === 0) {
      if (top.length === 0) return;
      await playQueue(top, 0, name, `/artist/${id}`, { shuffled: true });
      return;
    }
    setShuffling(true);
    try {
      const songs = await fetchAlbumSongs();
      if (!songs || songs.length === 0) return;
      await playQueue(songs, 0, name, `/artist/${id}`, { shuffled: true });
    } finally {
      setShuffling(false);
    }
  }

  /**
   * Fetches the songs of every album in the discography. Not the "Appears on"
   * ones: those albums belong to another artist, and pulling another artist's
   * full album because this one sings on a track is not what was asked. Shared
   * by download, add-to-playlist and shuffle-all.
   */
  async function fetchAlbumSongs(list: typeof albums = albums): Promise<Song[] | null> {
    try {
      const parts = await Promise.all(
        list.map((a) =>
          // Same cache key as the album screen: if you've already entered one,
          // it comes from cache instead of refetching.
          queryClient.fetchQuery({ queryKey: ['album', a.id], queryFn: () => getAlbum(a.id) }),
        ),
      );
      return parts.flatMap((p) => p.songs);
    } catch {
      toast(t("Couldn't load albums."));
      return null;
    }
  }

  /**
   * `gatherSongs` wraps the fetch in the download button's `gathering` spinner.
   * It covers ONLY this phase: if it stretched to cover the download, the button
   * would be deaf while downloading and couldn't be stopped.
   */
  async function gatherSongs(list: typeof albums = albums) {
    setGathering(true);
    try {
      return await fetchAlbumSongs(list);
    } finally {
      setGathering(false);
    }
  }

  async function addToPlaylist() {
    const songs = await gatherSongs();
    if (songs && songs.length > 0) usePlaylistPicker.getState().open(songs);
  }

  /**
   * ⋯ menu action: play the whole discography in chronological order (earliest
   * album first, undated ones last; track order preserved within each album).
   * The header Play button stays Spotify-like (popular tracks); this is the
   * tucked-away way to hear the catalogue in order (#36). Only reachable when
   * there are albums (the ⋯ button itself is gated on that).
   */
  /** Removes every downloaded song of the discography. The songs come from the
   *  same fetch the download uses, which offline reads the local catalog. */
  async function deleteDiscography() {
    const songs = await gatherSongs();
    if (!songs) return;
    const files = useDownloads.getState().files;
    const ids = songs.filter((s) => files[s.id]).map((s) => s.id);
    if (ids.length === 0) {
      toast(t('Nothing here is downloaded'));
      return;
    }
    await deleteSongs(ids);
    toast(t('{n} songs deleted', { n: ids.length }));
  }

  async function playDiscography() {
    const chrono = [...albums].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    const songs = await gatherSongs(chrono);
    if (songs && songs.length > 0) await playQueue(songs, 0, name, `/artist/${id}`);
  }

  async function startDownload() {
    if (!pending) return;
    await downloadArtist(id, pending, albums);
    // Without this notice the download ends silently: the button goes back to
    // its normal icon (here there's no "downloaded" state to show it) and, if
    // everything was already downloaded, `downloadGroup` exits without doing
    // absolutely nothing. If songs remain it means it was stopped, and the
    // store already notifies about that.
    const files = useDownloads.getState().files;
    const left = pending.filter((s) => !files[s.id] && !s.url && !s.localUri);
    if (left.length === 0) toast(t('Downloaded'));
  }

  // Songs are gathered BEFORE asking, not after: so the dialog counts real
  // songs and can estimate the size, like the album and list screens. Counting
  // by `songCount` would have left this screen —the one with the heaviest
  // downloads— as the only one asking blindly.
  async function onDownloadPress() {
    if (gathering) return;
    if (download.status === 'active') {
      setConfirmStop(true);
      return;
    }
    const songs = await gatherSongs();
    if (!songs || songs.length === 0) return;
    setPending(songs);
    setConfirmDownload(true);
  }

  return (
    <View style={styles.root}>
      <View style={{ flex: 1 }}>
      <AnimatedPage
        contentContainerStyle={{ paddingBottom: bottomPad }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        <View style={[styles.headerWrap, { width: screenW, height: headerH }]}>
          {/* The header fills its space, so a photo that isn't the shape of
              the header loses its edges. Rather than trying to hold every
              shape up there, tapping it opens the whole thing, like a cover. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('View image')}
            onPress={() => setPhotoOpen(true)}
          >
            <Animated.Image
              source={{ uri: headerUri }}
              style={[
                styles.headerImg,
                { width: screenW, height: headerH, transform: [{ translateY: imgTranslate }] },
              ]}
              resizeMode="cover"
            />
          </Pressable>
          {/* Both sit on top of the photo and neither is there to be touched:
              without this they take the tap and it never reaches the image. */}
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', 'transparent', colors.background] as const}
            style={StyleSheet.absoluteFill}
          />
          <Animated.Text
            pointerEvents="none"
            style={[styles.name, { opacity: nameOpacity }]}
            numberOfLines={2}
          >
            {data.artist.name}
          </Animated.Text>
        </View>

        <View style={styles.actions}>
          <FavoriteButton
            id={data.artist.id}
            type="artist"
            starred={favArtistIds ? favArtistIds.has(data.artist.id) : !!data.artist.starred}
            size={30}
          />
          {/* Locally no: what's here is already on the device. Same criteria
              (and same look) as the album and playlist header. */}
          {!offline && albums.length > 0 ? (
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Download')}
              onPress={onDownloadPress}
              style={styles.downloadWrap}
            >
              {gathering || download.status === 'active' ? (
                <>
                  <ActivityIndicator size="small" color={colors.accent} />
                  {/* Gathering the songs there's no percentage to give yet: progress
                      only exists when the group is already downloading. */}
                  {download.status === 'active' ? (
                    <Text style={[styles.downloadProgress, { color: colors.accent }]}>
                      {Math.round(download.progress * 100)}%
                    </Text>
                  ) : null}
                </>
              ) : (
                <Icon name="arrow-down-circle-outline" size={26} color={colors.textSecondary} />
              )}
            </Pressable>
          ) : null}
          {albums.length > 0 ? (
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('More options')}
              onPress={() => {
                // Always on the actions: a sheet reopening on the stars because
                // that is where it was left reads as the wrong menu.
                setMenuMode('actions');
                menuRef.current();
              }}
            >
              <Icon name="ellipsis-horizontal" size={26} color={colors.text} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }} />
          {/* Shuffle sits right next to Play, both on the right (Spotify-style). */}
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Shuffle')}
            onPress={shufflePlay}
          >
            {shuffling ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Icon name="shuffle" size={26} color={shuffleActive ? colors.accent : colors.text} />
            )}
          </Pressable>
          <Pressable
            style={[styles.playButton, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel={showPause ? t('Pause') : t('Play')}
            onPress={() => {
              if (isCurrentArtistQueue) togglePlay();
              else if (top.length > 0) playQueue(top, 0, data.artist.name, `/artist/${id}`);
              // Nothing popular to play: rather than the button doing nothing at
              // all (#79), it falls back to what the ⋯ menu offers, the
              // discography from the earliest album on. A server that tracks no
              // plays has no popular tracks for anybody, so on those this is the
              // button's normal behaviour and not a corner case.
              else if (albums.length > 0 && !starting) {
                setStarting(true);
                void playDiscography().finally(() => setStarting(false));
              }
            }}
          >
            {starting ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Icon
                name={showPause ? 'pause' : 'play'}
                size={28}
                color={colors.onAccent}
                // Optical centring only for the play triangle; pause is symmetric.
                style={showPause ? undefined : { marginLeft: 2 }}
              />
            )}
          </Pressable>
        </View>

        {top.length > 0 ? (
          <View style={styles.section}>
            {/* "All songs" and not "Show all": what is above is the twenty the
                server thinks are worth hearing first, and what the link opens
                is every song there is. "Show all" beside "Popular" would read
                as all the popular ones. */}
            <Link href={`/artist/songs/${id}`} asChild>
              <Pressable style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderTitle}>{t('Popular')}</Text>
                <Text style={styles.showAll}>{t('All songs')}</Text>
              </Pressable>
            </Link>
            {/* Same horizontal margin as the lists (album/playlist) so the
                rows —and the three-dot button— don't stick to the edge. */}
            <View style={styles.popularRows}>
              {top.slice(0, songsExpanded ? 10 : 5).map((song, i) => (
                <TrackRow
                  key={song.id}
                  song={song}
                  position={i + 1}
                  isCurrent={playing?.id === song.id}
                  showArtwork={showListArtwork}
                  onPress={() => playQueue(top, i, data.artist.name, `/artist/${id}`)}
                />
              ))}
            </View>
            {top.length > 5 ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                onPress={() => setSongsExpanded((v) => !v)}
              >
                <Text style={styles.bioToggle}>
                  {songsExpanded ? t('Show less') : t('Show more')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* One shelf per kind of record where the library says what they are,
            one named shelf where it says they are all the same kind, and the
            single undivided discography where it says nothing. See
            `groupArtistAlbums`: it answers with nothing rather than with a
            heading it cannot stand behind. */}
        {releaseGroups.length > 0 ? (
          releaseGroups.map((g) => (
            <AlbumRow
              key={g.key}
              title={t(RELEASE_GROUP_TITLE[g.key])}
              albums={g.albums}
              href={`/artist/discography/${id}?group=${g.key}`}
            />
          ))
        ) : albums.length > 0 ? (
          <AlbumRow title={t('Discography')} albums={albums} href={`/artist/discography/${id}`} />
        ) : null}

        {guestAlbums.length > 0 ? (
          <AlbumRow
            title={t('Appears on')}
            albums={guestAlbums}
            href={`/artist/discography/${id}?section=appears-on`}
          />
        ) : null}

        {info?.biography ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('About::artist')}</Text>
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
                  {bioExpanded ? t('Show less') : t('Show more')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {info && info.similarArtists.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Similar artists')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {info.similarArtists.map((a) => (
                <Link key={a.id} href={`/artist/${a.id}`} asChild>
                  <Pressable style={styles.similar}>
                    <Cover uri={coverArtUrl( a.coverArt ?? a.id, COVER.thumb)} size={110} rounded />
                    <Text style={styles.similarName} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </AnimatedPage>
      </View>

      {/* Fixed bar: the back button always; background + title + play on collapse. */}
      <View style={[styles.bar, { height: insets.top + 48, paddingTop: insets.top }]}>
        <TopBarBackground color={dominant} opacity={barBgOpacity} />
        {/* The same chevron, at the same size, as the album and playlist bars.
            What it keeps of its own is the disc behind it: those screens open
            on a cover of the app's own making, and this one on a photo from
            the server that may be pale, or missing entirely, leaving the way
            out to be guessed at. */}
        {/* White on its own dark disc, in both appearances: the disc is what
            makes it visible over a photo, and it stays there once the bar has
            gone solid. */}
        <BackChevron size={28} color={colors.onArtwork} style={styles.back} label={t('Close')} />
        <Animated.Text style={[styles.barTitle, { opacity: barContentOpacity }]} numberOfLines={1}>
          {data.artist.name}
        </Animated.Text>
      </View>

      {/* The same URL as the header, not a larger one: it is already on the
          device, so it opens at once instead of downloading the photo twice. */}
      <CoverViewer
        visible={photoOpen}
        uri={headerUri}
        square={false}
        onClose={() => setPhotoOpen(false)}
      />
      <Dialog
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: data.artist.name })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void startDownload();
        }}
      />
      <Dialog
        visible={confirmDeleteDl}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: data.artist.name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmDeleteDl(false)}
        onConfirm={() => {
          setConfirmDeleteDl(false);
          void deleteDiscography();
        }}
      />
      <Dialog
        visible={confirmStop}
        title={t('Stop download?')}
        message={t('Songs already downloaded will be kept.')}
        confirmLabel={t('Stop')}
        destructive
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          cancelDownload(`artist:${id}`);
        }}
      />

      <SheetModal openRef={menuRef}>
        {(close) =>
          menuMode === 'rating' ? (
            <View>
              <Pressable style={styles.action} onPress={() => setMenuMode('actions')}>
                <Icon name="chevron-back" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Rate')}</Text>
              </Pressable>
              <View style={styles.ratingRow}>
                <StarRating
                  id={data.artist.id}
                  rating={data.artist.userRating}
                  size={34}
                  // Written back where the screen reads it from, so the stars
                  // keep what was just set instead of springing back to what
                  // the server said when the page was opened.
                  onRated={(r) =>
                    queryClient.setQueryData<{ artist: Artist; albums: Album[] }>(
                      ['artist', id],
                      (old) =>
                        old ? { ...old, artist: { ...old.artist, userRating: r } } : old,
                    )
                  }
                />
              </View>
            </View>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  void playDiscography();
                }}
              >
                <Icon name="play" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Play discography')}</Text>
              </Pressable>
              {/* The way back to the one undivided list the discography was
                  before it was split into shelves (#138): the same screen the
                  shelves open, with no kind asked for.

                  It used to appear only where there were shelves to undo,
                  which meant the menu held a different set of things depending
                  on how the artist happened to be tagged. A menu is somewhere
                  you go looking, so it says the same everywhere, and on an
                  artist with one shelf it still opens the whole list rather
                  than the handful of covers the row has room for. Only an
                  artist with no records of their own has nothing to open. */}
              {albums.length > 0 ? (
                <Pressable
                  style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    close();
                    router.push(`/artist/discography/${id}`);
                  }}
                >
                  <Icon name="albums-outline" size={24} color={colors.text} />
                  <Text style={styles.actionText}>{t('All releases')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  void addToPlaylist();
                }}
              >
                <Icon name="add" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
              </Pressable>
              {canShareResonusLink() ? (
                <Pressable
                  style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    close();
                    void shareResonusLink({ kind: 'artist', id, name: data.artist.name });
                  }}
                >
                  <Icon name="link-outline" size={24} color={colors.text} />
                  <Text style={styles.actionText}>{t('Share Resonus link')}</Text>
                </Pressable>
              ) : null}
              {canRate ? (
                <Pressable
                  style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                  onPress={() => setMenuMode('rating')}
                >
                  <Icon name="star-outline" size={24} color={colors.text} />
                  <Text style={styles.actionText}>{t('Rate')}</Text>
                </Pressable>
              ) : null}
              {/* Last, because it is the only thing here that takes something
                  away, but not in red: a download comes back with one tap, and
                  red is kept for what does not come back, like deleting a
                  playlist or a station.

                  Clearing a whole discography had no path at all offline, where
                  the download button isn't there — nor online for a partially
                  downloaded artist, since that button only offers to delete once
                  everything is in (#47). */}
              {hasDownloads ? (
                <Pressable
                  style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    close();
                    setConfirmDeleteDl(true);
                  }}
                >
                  <Icon name="trash-outline" size={24} color={colors.text} />
                  <Text style={styles.actionText}>{t('Delete downloads')}</Text>
                </Pressable>
              ) : null}
            </>
          )
        }
      </SheetModal>
    </View>
  );
}

/**
 * One of the album rows ("Discography", "Appears on"), capped at ROW_LIMIT
 * cards with its "Show all" header for the rest.
 */
function AlbumRow({ title, albums, href }: { title: string; albums: Album[]; href: string }) {
  const t = useT();
  const shown = albums.slice(0, ROW_LIMIT);
  return (
    <View style={styles.section}>
      <Link href={href} asChild>
        <Pressable style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderTitle}>{title}</Text>
          {/* Only when there is something to show that is not already here. The
              row holds up to ROW_LIMIT cards, so a couple of records are all on
              screen and the link led to a page with the same two on it. */}
          {albums.length > 2 ? <Text style={styles.showAll}>{t('Show all')}</Text> : null}
        </Pressable>
      </Link>
      <FlatList
        {...listPerf}
        horizontal
        data={shown}
        keyExtractor={(a: Album) => a.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => <AlbumCard album={item} width={CARD_W} />}
      />
    </View>
  );
}

const styles = themed((colors) => ({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  // ⋯ menu row (same look as the playlist / media menu).
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md },
  actionText: { color: colors.text, fontSize: fontSize.md },
  // Same as the song menu's, so the stars sit where they do there.
  ratingRow: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  headerWrap: { justifyContent: 'flex-end' },
  headerImg: { ...StyleSheet.absoluteFill },
  name: {
    color: colors.text,
    fontSize: fontSize.xxl,
    letterSpacing: tracking.display,
    fontWeight: '500',
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
  // Same as the album/playlist header, so the button is the same.
  downloadWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  downloadProgress: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  playButton: {
    backgroundColor: colors.accent,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginBottom: spacing.xl },
  popularRows: { paddingHorizontal: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionHeaderTitle: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  showAll: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
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
    fontWeight: '500',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
  similar: { width: 110, alignItems: 'center', gap: spacing.xs },
  similarName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    textAlign: 'center',
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
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
    fontWeight: '500',
  },
}));
