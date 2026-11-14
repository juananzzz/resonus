/**
 * Folder browsing (Subsonic server directories). Shows the contents of a
 * directory: subfolders (navigable) and songs. The root of a library uses
 * `getIndexes`; inner directories use `getMusicDirectory`. Reached from the
 * Library's "Folders" section (hidden by default).
 */
import Icon from '@/components/Icon';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COVER, coverArtUrl, getFolderIndexes, getMusicDirectory, type Song } from '@/api/data';
import { Cover } from '@/components/Cover';
import { Message } from '@/components/Message';
import { SortSheet } from '@/components/SortSheet';
import { TrackRow } from '@/components/TrackRow';
import { useBrowseSort } from '@/hooks/useBrowseSort';
import { useT } from '@/i18n';
import { byFileName, type FolderSort } from '@/lib/folderSort';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING, themed, useTheme, tracking } from '@/theme';
import { BackChevron } from '@/components/BackChevron';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';

type Row =
  | { kind: 'dir'; id: string; name: string; year?: number; coverArt?: string }
  | { kind: 'song'; song: Song; index: number };

/** The orders the sheet offers: the folder's own (tags / server), or the
 *  names of the files on disk (#348). */
const SORT_OPTIONS: { key: FolderSort; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'filename', label: 'File names' },
];

/** The same comparison the file names get, for a folder's own name. */
const byDirName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export default function FolderBrowseScreen() {
  const bottomPad = useScreenBottomPadding();
  // Rows stop growing at a reading measure and centre themselves (#131).
  const listPad = useListPadding(spacing.lg);
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  useSettings((s) => s.appFont); // re-render when font changes
  const router = useRouter();
  const t = useT();
  const { id, name, root } = useLocalSearchParams<{ id: string; name?: string; root?: string }>();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const isRoot = root === '1';
  // At the root, `id` is the library id ('root' = unfiltered).
  const musicFolderId = id === 'root' ? undefined : id;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['folder', id, root],
    queryFn: async () => {
      if (isRoot) {
        const dirs = await getFolderIndexes(musicFolderId);
        return { name: name ?? '', dirs, songs: [] as Song[] };
      }
      return getMusicDirectory(id);
    },
    enabled: canFetch && !!id,
  });

  const title = data?.name || name || t('Folders');
  // Remembered across visits, like the orders on the browse screens.
  const [folderSort, setFolderSort] = useBrowseSort<FolderSort>(
    'folder',
    SORT_OPTIONS.map((o) => o.key),
    'default',
  );
  const sortRef = useRef<() => void>(() => {});
  const songs = useMemo(() => data?.songs ?? [], [data]);
  // The queue follows the rows, so tapping a song starts the list at the row
  // the finger hit rather than at its old place in the tag order.
  const orderedSongs = useMemo(
    () => (folderSort === 'filename' ? [...songs].sort(byFileName) : songs),
    [songs, folderSort],
  );
  const rows: Row[] = useMemo(() => {
    const dirs = data?.dirs ?? [];
    const orderedDirs = folderSort === 'filename' ? [...dirs].sort(byDirName) : dirs;
    return [
      ...orderedDirs.map((d) => ({
        kind: 'dir' as const,
        id: d.id,
        name: d.name,
        year: d.year,
        coverArt: d.coverArt,
      })),
      ...orderedSongs.map((song, index) => ({ kind: 'song' as const, song, index })),
    ];
  }, [data, folderSort, orderedSongs]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <BackChevron />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('Sort')}
          onPress={() => sortRef.current()}
        >
          <Icon name="swap-vertical" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <SortSheet
        options={SORT_OPTIONS}
        field={folderSort}
        onPick={(key) => setFolderSort(key as FolderSort)}
        openRef={sortRef}
      />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : isError ? (
        <Message text={t("Couldn't load the folder.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
          {...listPerf}
          data={rows}
          keyExtractor={(item) => (item.kind === 'dir' ? `d:${item.id}` : `s:${item.song.id}`)}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad, paddingHorizontal: listPad },
          ]}
          renderItem={({ item }) =>
            item.kind === 'dir' ? (
              <Pressable
                style={({ pressed }) => [styles.dirRow, pressed && styles.pressed]}
                onPress={() =>
                  router.push({
                    pathname: '/browse/folder/[id]',
                    params: { id: item.id, name: item.name },
                  })
                }
              >
                <Cover
                  uri={showListArtwork ? coverArtUrl(item.coverArt, COVER.thumb) : undefined}
                  size={44}
                  placeholderIcon="folder"
                />
                <View style={styles.dirInfo}>
                  <Text style={styles.dirName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.year ? <Text style={styles.dirYear}>{item.year}</Text> : null}
                </View>
                <Icon name="chevron-forward" size={20} color={colors.textMuted} />
              </Pressable>
            ) : (
              <TrackRow
                song={item.song}
                isCurrent={playing?.id === item.song.id}
                showArtwork={showListArtwork}
                onPress={() => playQueue(orderedSongs, item.index, title, `/folder/${id}`)}
              />
            )
          }
          ListEmptyComponent={<Text style={styles.empty}>{t('This folder is empty.')}</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  title: { flex: 1, color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500', textAlign: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  // Same rhythm as TrackRow so folders and songs line up when a directory
  // holds both.
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  dirInfo: { flex: 1 },
  dirName: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  // The year of an album folder, under its name: the folder view sorts by it,
  // and until now there was no way to see it (#97).
  dirYear: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  empty: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
}));
