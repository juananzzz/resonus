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
 *  switch instead of an address: the tab is the catalogue, and the heart over
 *  a section says you want the half of it you starred. The heart is remembered
 *  per section, since which half you want in the albums is not which half you
 *  want in the songs, and it is remembered per profile like everything else
 *  here. Where a section has nothing to heart — genres, stations, folders —
 *  there is no heart to press, and playlists have stars only where the server
 *  can answer for them (see `usePlaylistStars`).
 *
 * What the tab does draw for a section is the buttons top right: the heart,
 *  the magnifier, the view menu on the lists or "add a station"/"add a
 *  podcast"/"new playlist" where that is what the section is for. Down in the
 *  section they would need a row of their own, and a row holding one icon reads
 *  as an empty band. The menu still lives with the state it belongs to and the
 *  button reaches it through a ref; whether the search box is there is the
 *  other way round, a flag going down (`BrowserProps`), because the magnifier
 *  that opens it is also the X that closes it.
 *
 * That box used to be open in every section: a band of chrome under the chips
 *  for something you do now and then. It is the one thing the tab has, in the
 *  same place and with the same two ways out of it, Back included.
 *
 * Two filters over the sections, then: the Downloaded pill among the chips,
 *  which keeps every list to what is on the phone (#310), and the heart above
 *  them, which keeps it to what carries a star. Neither is a section, so each
 *  list keeps its own orders, search and view; the heart has its own button
 *  because it belongs to the tab rather than to a chip, and it keeps whatever
 *  was typed in the box, since you are asking the same question of a smaller
 *  list.
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

/** What the downloads can answer for: the rest only the server knows (#310). */
const DOWNLOADABLE: Section[] = ['playlists', 'albums', 'artists', 'songs'];

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
   * anyway. A filter over the sections rather than a section of its own, so
   * each keeps its orders, its search and its view.
   */
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const pillOn = order.some((s) => s.key === 'downloaded' && s.enabled);
  const canFilter = !!auth && !offline && hasDownloads && pillOn;
  const filtering = downloadedOnly && canFilter;
  const toggleFilter = () => {
    setSearchFor(null);
    setDownloadedOnly(!filtering);
  };
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
  // The Downloaded pill sits among them, where the settings put it.
  const chips = order
    .filter((s) =>
      s.key === 'downloaded'
        ? canFilter
        : s.enabled && available(s.key) && (!filtering || DOWNLOADABLE.includes(s.key as Section)),
    )
    .map((s) => s.key);
  const sections = chips.filter((k): k is Section => k !== 'downloaded');
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
          {/* The heart of this section: the same switch the rows show, one
              level up. It is drawn only where a section has anything to heart,
              and it says so to the finger as well as to the eye. */}
          {heartable ? (
            <Pressable
              hitSlop={12}
              accessibilityRole="switch"
              accessibilityLabel={t('Only favorited')}
              accessibilityState={{ checked: favorited }}
              onPress={() => setFavoriteSection(current as FavoriteSectionKey, !favorited)}
            >
              <Icon
                name={favorited ? 'heart' : 'heart-outline'}
                size={24}
                color={favorited ? accent : colors.text}
              />
            </Pressable>
          ) : null}
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
          if (key === 'downloaded') {
            return (
              <Pressable
                key={key}
                style={[styles.filterPill, filtering && { borderColor: accent, backgroundColor: accent }]}
                accessibilityRole="switch"
                accessibilityLabel={t('Only downloaded')}
                accessibilityState={{ checked: filtering }}
                onPress={toggleFilter}
              >
                {filtering ? <Icon name="checkmark" size={14} color={colors.onAccent} /> : null}
                <Text style={[styles.segmentText, filtering && styles.segmentTextActive]}>
                  {t('Downloaded')}
                </Text>
              </Pressable>
            );
          }
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
          once, which on a big library is what the app spent #50 undoing. Only
          the Downloaded pill goes into each section's `key`, since FlatList
          otherwise reuses what it measured for the list that was on screen
          before — and only that one, because remounting is how a section loses
          what was typed in its box, and the heart asks the same question of a
          smaller list. Each section puts the heart into its own list's key
          instead, which is where the rows get measured again. */}
      <View style={styles.body}>
        {current === 'playlists' ? (
          <PlaylistsBrowser
            key={String(filtering)}
            embedded
            downloaded={filtering}
            favorited={favorited}
            actionRef={sectionAction}
            searchOpen={searchOpen}
          />
        ) : current === 'albums' ? (
          <AlbumsBrowser
            key={String(filtering)}
            embedded
            downloaded={filtering}
            favorited={favorited}
            actionRef={sectionAction}
            searchOpen={searchOpen}
          />
        ) : current === 'artists' ? (
          <ArtistsBrowser
            key={String(filtering)}
            embedded
            downloaded={filtering}
            favorited={favorited}
            actionRef={sectionAction}
            searchOpen={searchOpen}
          />
        ) : current === 'songs' ? (
          <SongsBrowser
            key={String(filtering)}
            embedded
            downloaded={filtering}
            favorited={favorited}
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
            favorited={favorited}
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
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs - 1,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  segmentTextActive: { color: colors.onAccent },
  body: { flex: 1 },
}));
