/**
 * The audiobooks in the library, as a shelf of their own (Home chip).
 *
 * A place for them was the point. The album screen already knew a book when
 * it had one in its hands, but knowing it one album at a time is not somewhere
 * you can go, and the alternative was audiobook behaviour leaking into a Home
 * screen that is otherwise all music.
 *
 * What fills it comes from `getAudiobookAlbums`, which asks the server by
 * genre because that is the only question it can answer. The consequence is
 * written down there: a record tagged `RELEASETYPE=audiobook` whose genre says
 * Fiction is an audiobook on its own screen and is not on this one.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Dimensions, Pressable, Text, View } from 'react-native';
import { FlatList as GHFlatList } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAudiobookAlbums } from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { AlbumRow } from '@/components/AlbumRow';
import { AlbumRowsSkeleton } from '@/components/AlbumRowsSkeleton';
import { BackChevron } from '@/components/BackChevron';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { useGridColumns } from '@/hooks/useGridColumns';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';

const GAP = spacing.sm;

function cardWidth(columns: number): number {
  return (Dimensions.get('window').width - spacing.lg * 2 - GAP * (columns - 1)) / columns;
}

export default function AudiobooksScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const bottomPad = useScreenBottomPadding();
  const offline = useAuthStore((s) => s.offline);
  const canFetch = useAuthStore((s) => !!s.auth && !s.offline);
  const layout = useSettings((s) => s.audiobooksLayout);
  const setLayout = useSettings((s) => s.setAudiobooksLayout);
  const grid = layout === 'grid';
  // Rows or cards, and how many across, are the same question about the same
  // screen, so one menu asks it (#109).
  const { columns, openGridMenu, gridSheet } = useGridColumns('audiobooks', {
    value: layout,
    set: setLayout,
  });
  const card = cardWidth(columns);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['audiobooks'],
    queryFn: getAudiobookAlbums,
    enabled: canFetch,
  });

  const albums = data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.bar}>
        <BackChevron size={28} label={t('Close')} />
        <Text style={styles.barTitle}>{t('Audiobooks')}</Text>
        {albums.length > 0 ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('View')}
            onPress={openGridMenu}
          >
            {/* The icon says what you are looking at, not what one more tap
                would give you: it opens a menu, and a menu is opened from a
                thing that says where you are. */}
            <Ionicons
              name={grid ? 'grid-outline' : 'list'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : (
          <View style={styles.barSpacer} />
        )}
      </View>

      {/* The genre list and the albums both come from the server, so there is
          nothing to show without one. Said rather than left blank: an empty
          shelf and an unreachable one look the same otherwise. */}
      {offline ? (
        <View style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title={t('Not available offline')}
            subtitle={t('Your downloaded music is in Library.')}
          />
        </View>
      ) : isLoading ? (
        grid ? (
          <AlbumCardsSkeleton width={card} count={8} />
        ) : (
          <AlbumRowsSkeleton />
        )
      ) : isError ? (
        <Message text={t("Couldn't load albums.")} onRetry={() => void refetch()} />
      ) : albums.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="book-outline"
            title={t('No audiobooks yet')}
            subtitle={t(
              'Records whose genre says audiobook, spoken word or audio drama show up here.',
            )}
          />
        </View>
      ) : (
        <GHFlatList
          {...listPerf}
          data={albums}
          // Remount on layout change: FlatList reuses rows and gets stuck with
          // stale ones, and `numColumns` can't be hot-swapped either.
          key={`${layout}-${columns}`}
          keyExtractor={(a) => a.id}
          {...(grid
            ? {
                numColumns: columns,
                columnWrapperStyle: { gap: GAP },
                contentContainerStyle: [styles.list, { paddingBottom: bottomPad }],
              }
            : { contentContainerStyle: [styles.rowList, { paddingBottom: bottomPad }] })}
          renderItem={({ item }) =>
            grid ? <AlbumCard album={item} width={card} /> : <AlbumRow album={item} />
          }
        />
      )}
      {gridSheet}
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 48,
  },
  barTitle: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  barSpacer: { width: 22 },
  center: { flex: 1, justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: GAP },
  rowList: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.lg },
}));
