/**
 * Explore: everything the server has, in one tab.
 *
 * The whole catalogue used to be reachable only through the Home chips on
 * Home — six pills that scroll off the edge, each opening a screen you then
 * had to come back out of. The lists themselves were fine; what was missing
 * was somewhere they all lived, so switching from all albums to all songs
 * meant going back to Home first.
 *
 * It is a shell and not a rewrite: each section is the screen that already
 * existed, rendered `embedded` (see `BrowseFrame`). They keep their own
 * search, their own orders and their own choice of rows or a grid, which is
 * also why there is no toolbar here — the one that applies is the section's,
 * and a second row above it would be the same controls twice.
 *
 * "Your library" next door is the other half of the split, and the line
 * between them is whose it is: your playlists, your favourites and your pins
 * there; what the server holds here. Folders moved across for that reason.
 *
 * What the tab does draw for a section is the two buttons top right: the
 * magnifier, and the view menu on the three lists or "add a station" on the
 * radio. Down in the section they would need a row of their own, and a row
 * holding one icon reads as an empty band. The menu still lives with the state
 * it belongs to and the button reaches it through a ref; whether the search box
 * is there is the other way round, a flag going down (`BrowserProps`), because
 * the magnifier that opens it is also the X that closes it.
 *
 * That box used to be open in every section: a band of chrome under the chips
 * for something you do now and then. It is the one "Your library" has, in the
 * same place and with the same two ways out of it, Back included.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumsBrowser } from '@/app/browse/albums';
import { ArtistsBrowser } from '@/app/browse/artists';
import { SongsBrowser } from '@/app/browse/songs';
import { GenresBrowser } from '@/app/genres';
import { RadioBrowser } from '@/app/radio';
import { FoldersBrowser } from '@/components/FoldersBrowser';
import { PlaylistsBrowser } from '@/components/PlaylistsBrowser';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { useAccent } from '@/hooks/useAccent';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useSettings, type ExploreSection, type ListLayout } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

type Section = ExploreSection;

/** The label each goes by. The order is the saved one (Settings › Explore
 *  sections), which starts as the order they are declared in. */
const LABEL: Record<Section, string> = {
  playlists: 'Playlists',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  genres: 'Genres',
  radio: 'Radio',
  folders: 'Folders',
};

export default function ExploreScreen() {
  // Repaints on a change of appearance or accent: a tab stays mounted while
  // you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const accent = useAccent();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const showFolderBrowser = useSettings((s) => s.showFolderBrowser);
  const order = useSettings((s) => s.exploreSections);
  const [section, setSection] = useState<Section>('albums');
  /** Filled in by whichever section is on screen (see `BrowserProps`). */
  const sectionAction = useRef<() => void>(() => {});
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
  // Jellyfin's radio is resolved here (its Live-TV channels), so it is the
  // same section on every account the one has, not one a server-only account gets.
  const available = (key: Section): boolean => {
    switch (key) {
      case 'genres':
        return !!auth && !offline;
      case 'radio':
        return !!auth && !offline;
      case 'folders':
        return !!auth && auth.serverType !== 'jellyfin' && !offline && showFolderBrowser;
      case 'playlists':
        // Jellyfin answers for them too, and offline the mirror does; it is
        // the one server-side section the local profile has nothing for.
        return !!auth || offline;
      default:
        return true;
    }
  };
  const sections = order.filter(available);
  // Going offline can take the section you were on with it.
  const current = available(section) ? section : 'albums';

  /** Folders is the one section with no box: it is a handful of server roots. */
  const searchable = current !== 'folders';
  const searchOpen = searchFor === current;

  const closeSearch = useCallback(() => setSearchFor(null), []);

  // Leaving the tab puts the bar away, and so does Back while it is open: the
  // same two exits "Your library" gives its own. With the keyboard up the
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
  // bar and jumped down right after (see "Your library").
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('Explore')}</Text>
        <View style={styles.headerActions}>
          <OfflineIndicator />
          {/* The magnifier of "Your library", to the letter: it becomes the X
              that closes the bar, so the bar itself needs no Cancel beside it. */}
          {searchable ? (
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? t('Close') : t('Search')}
              onPress={() => setSearchFor(searchOpen ? null : current)}
            >
              <Ionicons
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
              <Ionicons
                name={headerButton.icon}
                size={headerButton.size}
                color={headerButton.color}
              />
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
        {sections.map((key) => {
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
          once, which on a big library is what the app spent #50 undoing. */}
      <View style={styles.body}>
        {current === 'playlists' ? (
          <PlaylistsBrowser embedded actionRef={sectionAction} searchOpen={searchOpen} />
        ) : current === 'albums' ? (
          <AlbumsBrowser embedded actionRef={sectionAction} searchOpen={searchOpen} />
        ) : current === 'artists' ? (
          <ArtistsBrowser embedded actionRef={sectionAction} searchOpen={searchOpen} />
        ) : current === 'songs' ? (
          <SongsBrowser embedded actionRef={sectionAction} searchOpen={searchOpen} />
        ) : current === 'genres' ? (
          <GenresBrowser embedded searchOpen={searchOpen} />
        ) : current === 'radio' ? (
          <RadioBrowser embedded actionRef={sectionAction} searchOpen={searchOpen} />
        ) : (
          <FoldersBrowser />
        )}
      </View>
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
  // The same heading "Your library" has, since they are the two halves of one
  // idea and a different size would read as a different kind of screen.
  heading: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  segments: { flexGrow: 0, paddingBottom: spacing.md },
  segmentsContent: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  segment: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  segmentText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  segmentTextActive: { color: colors.onAccent },
  body: { flex: 1 },
}));
