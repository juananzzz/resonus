/**
 * Library: everything the server has, and everything you keep, in one tab.
 *
 * The whole catalogue used to be reachable only through the Home chips on
 *  Home — six pills that scroll off the edge, each opening a screen you then
 *  had to come back out of. The lists themselves were fine; what was missing
 *  was somewhere they all lived, so switching from all albums to all songs
 *  meant going back to Home first.
 *
 * It is a shell and not a rewrite: each section is the screen that already
 *  existed, rendered `embedded` (see `BrowseFrame`). They keep their own
 *  search, their own orders and their own choice of rows or a grid, which is
 *  also why there is no toolbar here — the one that applies is the section's,
 *  and a second row above it would be the same controls twice.
 *
 * The tab used to be two, and the line between them was whose the rows are:
 *  your playlists, your favourites and your pins in one, what the server holds
 *  in the other. That line is what the heart is for now, so it stayed as a
 *  switch instead of an address: the tab is the catalogue, and the heart drawn
 *  in a section's sort row says you want the half of it you starred. The heart
 *  is remembered per section, since which half you want in the albums is not
 *  which half you want in the songs, and it is remembered per profile like
 *  everything else here. Where a section has nothing to heart — genres,
 *  stations, folders — there is no heart to press, and playlists have stars
 *  only where the server can answer for them (see `usePlaylistStars`).
 *
 * What the tab does draw for a section is the buttons top right: the magnifier,
 *  the view menu on the lists or "add a station"/"add a podcast"/"new playlist"
 *  where that is what the section is for. The two filters a section answers to
 *  are not among them: they are switches over the list, so they sit where that
 *  list is already read — the right end of the sort row each section wears,
 *  beside the order it spells out. That row is the one place on the section's
 *  body that already holds a group of controls, and the two of them are drawn
 *  as one group whatever the section offers, so a section that answers only
 *  one of the two questions still reads as the same pair of switches and the
 *  other never floats off on its own. Where a section draws neither — a screen
 *  of its own, searching — the row goes without its padding at all, so opening
 *  the box does not move the list under it. The menu still lives with the state
 *  it belongs to and the button reaches it through a ref; whether the search
 *  box is there is the other way round, a flag going down (`BrowserProps`),
 *  because the magnifier that opens it is also the X that closes it.
 *
 * That box used to be open in every section: a band of chrome under the chips
 *  for something you do now and then. It is the one thing the tab has, in the
 *  same place and with the same two ways out of it, Back included.
 *
 * Two filters, then, both drawn in a section's own sort row: the Downloaded
 *  one, which keeps every list to what is on the phone (#310), and the heart,
 *  which keeps it to what carries a star. They are the row's right-hand corner:
 *  the order is spelled out at its left, the two icons are pushed to the far
 *  right end beside it, so the row reads as a list's two questions rather than
 *  controls that do not know about each other. Pressing one holds the list the
 *  other is reading, so both together ask both questions at once, and neither
 *  closes the box: same question, smaller list. The Downloaded one is the tab's,
 *  one filter over every section at a time; the heart belongs to the section it
 *  is drawn in and remembers its own state there. A section with nothing of one
 *  kind draws no icon for it — no heart over genres, stations or folders, no ↓
 *  where the phone holds nothing to hold the list to.
 */
import Icon from '@/components/Icon';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumsBrowser } from '@/app/browse/albums';
import { ArtistsBrowser } from '@/app/browse/artists';
import { SongsBrowser } from '@/app/browse/songs';
import { GenresBrowser } from '@/app/genres';
import { RadioBrowser } from '@/app/radio';
import { PodcastsBrowser } from '@/app/podcasts';
import { FoldersBrowser } from '@/components/FoldersBrowser';
import { PlaylistsBrowser } from '@/components/PlaylistsBrowser';
import { Dialog } from '@/components/Dialog';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { usePlaylistStars } from '@/hooks/usePlaylistStars';
import { useAccent } from '@/hooks/useAccent';
import { createPlaylist } from '@/api/data';
import { useT } from '@/i18n';
import { invalidateDownloadedLists } from '@/lib/query';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { anyDownloads, useDownloads } from '@/store/downloads';
import { useSettings, type FavoriteSectionKey, type LibrarySectionKey, type ListLayout } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme, tracking } from '@/theme';

type Section = Exclude<LibrarySectionKey, 'downloaded'>;

/** The label each goes by. The order is the saved one (Settings › Library
 *  sections), which starts as the order they are declared in. */
const LABEL: Record<Section, string> = {
  playlists: 'Playlists',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  genres: 'Genres',
  radio: 'Radio',
  podcasts: 'Podcasts',
  folders: 'Folders',
};

/**
 * What the downloads can answer for: the rest only the server knows (#310).
 *  Podcasts answer for themselves too — a show is in when at least one of its
 *  episodes is kept, read off the show's own database — which is what keeps
 *  its chip on the bar while the ↓ is on, under the same rule as the music
 *  sections.
 */
const DOWNLOADABLE: Section[] = ['playlists', 'albums', 'artists', 'songs', 'podcasts'];

/**
 * The sections the ↓ never takes off the bar: genres and stations are the
 *  server's own lists with nothing on the phone to hold them to, so a ↓ drawn
 *  over them would be an icon that does nothing. They keep their place on the
 *  bar and answer their whole list while the filter is on somewhere else — a
 *  chip that went away every time the filter came on would read as the section
 *  being switched off, which is the other thing the bar already says with an
 *  absent chip (see Settings › Library sections).
 */
const KEEP_ON_BAR: Section[] = ['genres', 'radio'];

/**
 * What the heart can be drawn over: the sections with a favorite state of
 *  their own. Songs, albums and artists are the server's stars, a show or a
 *  single episode carries the phone's own heart, and playlists carry a star
 *  only on a server that says so (see `usePlaylistStars`, and the tab asks
 *  that once). Genres, stations and folders have nothing to heart, which is
 *  why no icon that would do nothing is drawn over them.
 */
const FAVORITABLE: Section[] = ['playlists', 'albums', 'artists', 'songs', 'podcasts'];

export default function LibraryScreen() {
  // Repaints on a change of appearance or accent: a tab stays mounted while
  // you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const accent = useAccent();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const showFolderBrowser = useSettings((s) => s.showFolderBrowser);
  const hasDownloads = useDownloads(anyDownloads);
  const order = useSettings((s) => s.librarySections);
  /**
   * Which sections the heart is on in. Saved per section rather than as one
   *  switch of the tab: the half of the albums you want is not the half of the
   *  songs you want, and coming back to a section finds it as you left it.
   */
  const favoriteSections = useSettings((s) => s.favoriteSections);
  const setFavoriteSection = useSettings((s) => s.setFavoriteSection);
  // Whether this server can say at all which playlists are favourites. `und`
  //  means it cannot, which is what keeps a heart that would forget from
  //  being drawn over the playlists section.
  const playlistStars = usePlaylistStars();
  const [section, setSection] = useState<Section>('albums');
  /**
   * Only what is on the phone, while online: offline that is all there is
   *  anyway. A filter over the sections rather than a section of its own, so
   *  each keeps its orders, its search and its view. The settings row for it
   *  says whether it exists at all — see `downloadOn` below, which is what
   *  makes a profile with nothing downloaded offer no ↓ anywhere.
   */
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const downloadOn = order.some((s) => s.key === 'downloaded' && s.enabled);
  const canFilter = !!auth && !offline && hasDownloads && downloadOn;
  const downloadedFilterOn = downloadedOnly && canFilter;
  /**
   * The two presses the sections draw at the right end of their sort row
   *  (see `BrowseToolbar`). The Downloaded one is the tab's — one filter over
   *  every section — and the heart's belongs to the section it is drawn in, so
   *  a press writes that section's own saved state. Neither closes the search
   *  box: both ask a narrower question of the list you are reading.
   */
  const toggleDownloaded = () => {
    setDownloadedOnly(!downloadedFilterOn);
    // The narrower answer is not a longer window on the same list, and a
    //  download finishing does not invalidate these reads on its own, so the
    //  press asks for them again rather than serving what the previous press
    //  kept in the cache (see `invalidateDownloadedLists`).
    invalidateDownloadedLists();
  };
  const toggleFavorite = () => setFavoriteSection(current as FavoriteSectionKey, !favorited);
  /** Filled in by whichever section is on screen (see `BrowserProps`). */
  const sectionAction = useRef<() => void>(() => {});
  /**
   * The tab's third way in for a playlist: what used to sit over the playlists
   *  segment of the tab that is gone, on the section's own header button now.
   */
  const [creating, setCreating] = useState(false);

  async function onCreate(name: string) {
    setCreating(false);
    if (!auth && !offline) return;
    try {
      const id = await createPlaylist(name);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      router.push(`/playlist/${id}`);
    } catch {
      toast(t("Couldn't create the playlist"));
    }
  }
  /**
   * Which section has its search box open, rather than a plain boolean: the
   * chips change what is on screen, and "open" means nothing without saying
   * open on what. Changing chip puts the box away by saying so.
   */
  const [searchFor, setSearchFor] = useState<Section | null>(null);
  // Read for all four rather than for the one showing, because hooks cannot
  // be conditional; it is a selector each, which is what a chip press costs
  // anyway. Only the icon needs them — what the menu writes is its own.
  const layouts: Record<'playlists' | 'albums' | 'artists' | 'songs', ListLayout> = {
    playlists: useSettings((s) => s.browsePlaylistsLayout),
    albums: useSettings((s) => s.browseAlbumsLayout),
    artists: useSettings((s) => s.browseArtistsLayout),
    songs: useSettings((s) => s.browseSongsLayout),
  };

  /**
   * Which sections this profile actually has.
   *
   * Albums, artists and songs are answered by the local catalogue too, so they
   * are always there. The other three need the server, each for its own
   * reason: genres and stations are things only it knows about, and browsing
   * directories is a Subsonic call that Jellyfin has no equivalent for. A
   * section that is not here is not greyed out — with no server coming back
   * there is nothing to grey out for (see `useLocalProfile`).
   */
  const subsonic = !!auth && auth.serverType !== 'jellyfin';
  const available = (key: Section): boolean => {
    switch (key) {
      case 'genres':
        return !!auth && !offline;
      case 'radio':
        // Jellyfin's are its Live TV radio channels (see `getRadioStations`).
        return !!auth && !offline;
      case 'folders':
        // The local profile's music does live in folders, so it is there
        // without the switch, which is the server's.
        return !auth && offline ? true : subsonic && !offline && showFolderBrowser;
      case 'playlists':
        // Jellyfin answers for them too, and offline the mirror does; it is
        // the one server-side section the local profile has nothing for.
        return !!auth || offline;
      default:
        return true;
    }
  };
  // What the chips are: turned on, and something this profile can answer for.
  // The Downloaded filter is not one of them any more — it is a toggle in every
  //  section's sort row — but it still takes the sections it cannot answer for
  //  off the bar, which is what `DOWNLOADABLE` says (see #310), except the ones
  //  that have nothing to answer either way and keep their place (`KEEP_ON_BAR`).
  const chips = order
    .filter(
      (s) =>
        s.key !== 'downloaded' &&
        s.enabled &&
        available(s.key as Section) &&
        (!downloadedFilterOn ||
          DOWNLOADABLE.includes(s.key as Section) ||
          KEEP_ON_BAR.includes(s.key as Section)),
    )
    .map((s) => s.key as Section);
  const sections = chips;
  /**
   * Going offline can take the section you were on with it, and so can turning
   * it off in the settings.
   *
   * The last resort is albums whatever the switches say, which is the one place
   * they are not obeyed. It is reachable only by turning off everything the
   * local catalogue answers for and then losing the server, and a tab with
   * nothing in it at all is worse than a tab showing a section somebody hid.
   */
  const current = sections.includes(section) ? section : (sections[0] ?? 'albums');

  /**
   * Whether this section has a favorite state to switch at all, and whether the
   *  heart is on for it. The state belongs to the section rather than to the
   *  tab, which is why pressing another chip does not put it away the way it
   *  closes the other section's search box. `current` is a section, so it says
   *  `genres` or `radio` as well; the cast below only runs where `heartable`
   *  already said it is one of the five that can be hearted.
   */
  const heartable =
    FAVORITABLE.includes(current) && (current !== 'playlists' || playlistStars !== undefined);
  const favorited = heartable && favoriteSections[current as FavoriteSectionKey] === true;
  /**
   * Whether the ↓ sits in this section's sort row: the filter is the tab's, but
   *  it only means something for the lists the phone can hold music for (see
   *  `DOWNLOADABLE`), and only while there is something on the phone at all.
   *  Turning it on takes the sections it cannot answer for off the bar, except
   *  the ones that have nothing to answer either way and keep their place there
   *  (`KEEP_ON_BAR`) — a ↓ drawn over those would be an icon that does nothing,
   *  so they draw neither icon and answer their whole list.
   */
  const downloadable = canFilter && DOWNLOADABLE.includes(current);

  /** Folders is the one section with no box: it is a handful of server roots. */
  const searchable = current !== 'folders';
  const searchOpen = searchFor === current;

  const closeSearch = useCallback(() => setSearchFor(null), []);

  // Leaving the tab puts the bar away, and so does Back while it is open: the
  // same two exits every screen that has a bar gives. With the keyboard up the
  // system eats the first press to lower it and this never sees it; that press
  // is the keyboard's, not ours to take.
  useFocusEffect(useCallback(() => closeSearch, [closeSearch]));
  useEffect(() => {
    if (!searchOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSearch();
      return true;
    });
    return () => sub.remove();
  }, [searchOpen, closeSearch]);

  /**
   * The section's own button, drawn here and acting down there.
   *
   * Genres and folders have none: one is a grid with nothing to choose about
   * it and the other is a handful of server roots.
   */
  const headerButton =
    current === 'radio'
      ? { icon: 'add' as const, label: t('Add station'), size: 28, color: colors.text }
      : current === 'podcasts'
        ? { icon: 'add' as const, label: t('Add podcast'), size: 28, color: colors.text }
        : current === 'playlists' ||
            current === 'albums' ||
            current === 'artists' ||
            current === 'songs'
          ? {
              icon: layouts[current] === 'grid' ? ('grid-outline' as const) : ('list' as const),
              label: t('View'),
              size: 22,
              color: colors.textSecondary,
            }
          : null;

  // The inset is read here rather than left to a `SafeAreaView`: that one pads
  // itself once its native view has been measured, and a tab is only mounted
  // the first time it is opened, so its first frame was drawn under the status
  // bar and jumped down right after.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('Library')}</Text>
        <View style={styles.headerActions}>
          <OfflineIndicator />
          {/* The magnifier, to the letter: it becomes the X that closes the
              bar, so the bar itself needs no Cancel beside it. */}
          {searchable ? (
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? t('Close') : t('Search')}
              onPress={() => setSearchFor(searchOpen ? null : current)}
            >
              <Icon
                name={searchOpen ? 'close' : 'search'}
                size={24}
                color={searchOpen ? accent : colors.text}
              />
            </Pressable>
          ) : null}
          {headerButton ? (
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={headerButton.label}
              onPress={() => sectionAction.current()}
            >
              <Icon
                name={headerButton.icon}
                size={headerButton.size}
                color={headerButton.color}
              />
            </Pressable>
          ) : null}
          {/* A playlist to start: only the playlists section has one, and the
              row that holds it belongs to the section, so this reaches it
              rather than duplicating it. */}
          {current === 'playlists' ? (
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('New playlist')}
              onPress={() => setCreating(true)}
            >
              <Icon name="add" size={28} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.segments}
        contentContainerStyle={styles.segmentsContent}
      >
        {chips.map((key) => {
          const active = key === current;
          return (
            <Pressable
              key={key}
              style={[styles.segment, active && { backgroundColor: accent }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                // The box belongs to the section you were in, and so does what
                // was typed in it: a chip is a different list, not the same one
                // filtered.
                setSearchFor(null);
                setSection(key);
              }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {t(LABEL[key])}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Only the section on screen is mounted, so nothing else is asking the
          server while you are not looking at it. The cost is that coming back
          to one starts it at the top; the alternative is every list live at
          once, which on a big library is what the app spent #50 undoing. Both
          filters belong to each section's own list key now, and neither to the
          section component's: a key there remounts the whole section, which is
          how the rows get measured again for a list that is no longer the one
          they were measured for — and it is also how what you typed in the
          section's box went away, which a filter has no reason to do. The rows
          are measured again in the list key; the box is left alone. */}
      <View style={styles.body}>
        {current === 'playlists' ? (
          <PlaylistsBrowser
            embedded
            downloaded={downloadedFilterOn}
            favorited={favorited}
            onToggleDownloaded={downloadable ? toggleDownloaded : undefined}
            onToggleFavorite={heartable ? toggleFavorite : undefined}
            actionRef={sectionAction}
            searchOpen={searchOpen}
          />
        ) : current === 'albums' ? (
          <AlbumsBrowser
            embedded
            downloaded={downloadedFilterOn}
            favorited={favorited}
            onToggleDownloaded={downloadable ? toggleDownloaded : undefined}
            onToggleFavorite={heartable ? toggleFavorite : undefined}
            actionRef={sectionAction}
            searchOpen={searchOpen}
          />
        ) : current === 'artists' ? (
          <ArtistsBrowser
            embedded
            downloaded={downloadedFilterOn}
            favorited={favorited}
            onToggleDownloaded={downloadable ? toggleDownloaded : undefined}
            onToggleFavorite={heartable ? toggleFavorite : undefined}
            actionRef={sectionAction}
            searchOpen={searchOpen}
          />
        ) : current === 'songs' ? (
          <SongsBrowser
            embedded
            downloaded={downloadedFilterOn}
            favorited={favorited}
            onToggleDownloaded={downloadable ? toggleDownloaded : undefined}
            onToggleFavorite={heartable ? toggleFavorite : undefined}
            actionRef={sectionAction}
            searchOpen={searchOpen}
          />
        ) : current === 'genres' ? (
          <GenresBrowser embedded searchOpen={searchOpen} />
        ) : current === 'radio' ? (
          <RadioBrowser embedded actionRef={sectionAction} searchOpen={searchOpen} />
        ) : current === 'podcasts' ? (
          <PodcastsBrowser
            embedded
            downloaded={downloadedFilterOn}
            favorited={favorited}
            onToggleDownloaded={downloadable ? toggleDownloaded : undefined}
            onToggleFavorite={heartable ? toggleFavorite : undefined}
            actionRef={sectionAction}
            searchOpen={searchOpen}
          />
        ) : (
          <FoldersBrowser />
        )}
      </View>

      {/* The sheet behind the section's "New playlist": the name, then the one
          request that writes the list. */}
      <Dialog
        visible={creating}
        title={t('New playlist')}
        input={{ placeholder: t('Playlist name') }}
        confirmLabel={t('Create')}
        onCancel={() => setCreating(false)}
        onConfirm={onCreate}
      />
    </View>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  // As big as a screen's title: a tab is where a whole section lives, and the
  //  other tabs write their heading at this size.
  heading: { color: colors.text, fontSize: fontSize.xxl, letterSpacing: tracking.display, fontWeight: '400' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  segments: { flexGrow: 0, paddingBottom: spacing.md },
  segmentsContent: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  segment: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  segmentTextActive: { color: colors.onAccent },
  body: { flex: 1 },
}));
