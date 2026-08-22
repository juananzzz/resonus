/**
 * Spotify-style playback queue, in sections:
 *   · Previous — what is behind the cursor (optional setting).
 *   · Now playing — the current song.
 *   · Next up — manually added items (`queuedCount` block).
 *   · Next from: {source} — the rest of what was playing.
 * Every row can be dragged and removed, the one playing included (#157).
 * Section headers are derived from the position, so they reposition themselves
 * on reorder.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COVER, songCoverUrl } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { ExplicitBadge, useExplicitBadge } from '@/components/ExplicitBadge';
import { SheetModal } from '@/components/SheetModal';
import { useListPadding } from '@/hooks/useScreenSize';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';
import { mixSeedOf, SOURCE_FAVORITES, SOURCE_HISTORY, usePlayerStore } from '@/store/player';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';

// ReorderableList doesn't support removeClippedSubviews (needs cells mounted
// to animate the drag); we use the rest of the performance props.
const queueListPerf = {
  initialNumToRender: listPerf.initialNumToRender,
  maxToRenderPerBatch: listPerf.maxToRenderPerBatch,
  windowSize: listPerf.windowSize,
};

function SectionHeader({ title, gap }: { title: string; gap?: boolean }) {
  return <Text style={[styles.sectionHeader, gap && styles.sectionGap]}>{title}</Text>;
}

/**
 * The line under the title, which the three kinds of row here all draw the
 * same: the artist, with the advisory badge ahead of it. Either half can be
 * missing, and a song with neither draws nothing at all.
 */
function ArtistLine({ song }: { song: Song }) {
  const explicit = useExplicitBadge(song.explicitStatus);
  if (!explicit && !song.artist) return null;
  return (
    <View style={styles.subRow}>
      <ExplicitBadge status={song.explicitStatus} />
      {song.artist ? (
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A row of the queue: the one playing, one behind the cursor or one ahead. All
 * three drag and remove the same way (#157); the state only decides how the row
 * reads and what a tap does.
 */
function QueueRow({
  item,
  absIndex,
  state,
}: {
  item: Song;
  absIndex: number;
  state: 'previous' | 'current' | 'upcoming';
}) {
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const removeAt = usePlayerStore((s) => s.removeAt);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const toast = useToast((s) => s.show);
  const t = useT();
  const drag = useReorderableDrag();
  const current = state === 'current';

  const remove = async () => {
    // Removing the one playing moves on to the next, which is loud enough on
    // its own and cannot be undone: `removeAt` returns nothing there.
    const undo = await removeAt(absIndex);
    if (undo) toast(t('Removed from queue'), { label: t('Undo'), run: undo });
  };

  return (
    <View style={[styles.row, state === 'previous' && styles.previous]}>
      <Pressable
        style={styles.main}
        onPress={current ? undefined : () => jumpTo(absIndex)}
        onLongPress={() => { haptic('medium'); drag(); }}
      >
        {showListArtwork ? (
          <View style={styles.artwork}>
            <Cover uri={songCoverUrl(item, COVER.thumb)} size={44} />
          </View>
        ) : null}
        <View style={styles.info}>
          <Text style={[styles.title, current && { color: colors.accent }]} numberOfLines={1}>
            {item.title}
          </Text>
          <ArtistLine song={item} />
        </View>
      </Pressable>

      <View style={styles.actions}>
        {current ? <Ionicons name="volume-medium" size={20} color={colors.accent} /> : null}
        <Pressable hitSlop={6} onPress={() => void remove()}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
        <Pressable hitSlop={6} onPressIn={() => { haptic('medium'); drag(); }}>
          <Ionicons name="reorder-two" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export default function QueueScreen() {
  useSettings((s) => s.appFont); // re-render when font changes
  // The queue is a list of songs like any other: centred on a wide screen
  // rather than one name per 1280 points (#131).
  const listPad = useListPadding(spacing.lg);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const router = useRouter();
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const queuedCount = usePlayerStore((s) => s.queuedCount);
  const source = usePlayerStore((s) => s.source);
  const mixSeed = usePlayerStore(mixSeedOf);
  const moveTrack = usePlayerStore((s) => s.moveTrack);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const radioMode = usePlayerStore((s) => s.radioMode);
  const stopRadio = usePlayerStore((s) => s.stopRadio);
  // Subscribed, not read straight off `colors`: a stack keeps this screen
  // mounted while you are elsewhere, so without this it would keep the accent
  // and the appearance it was last painted in.
  const { accent } = useTheme();
  const toast = useToast((s) => s.show);
  const [confirmClear, setConfirmClear] = useState(false);
  // ⋯ menu (imperative: opening/closing doesn't re-render the screen).
  const menuRef = useRef<() => void>(() => {});
  const insets = useSafeAreaInsets();
  const topPad = insets.top > 0 ? insets.top : 12;

  const showPrevious = useSettings((s) => s.showPlayedInQueue);
  const current = queue[index] ?? null;
  const upcoming = queue.slice(index + 1);
  /**
   * Where the list starts. With the played ones hidden it is the current song;
   * with them shown it is the whole queue, and then everything behind the
   * cursor is in the list like anything else, which is what lets it be dragged
   * and removed (#157). Its absolute index is its own position, so `start` is
   * all that stands between a list position and a queue one.
   *
   * Not necessarily heard, by the way — jumping forward leaves the skipped ones
   * behind the cursor too, which is why that section isn't called "played".
   */
  const start = showPrevious ? 0 : index;
  // Memoised: `data` changing identity on every render re-renders every row.
  const rows = useMemo(() => queue.slice(start), [queue, start]);
  /**
   * A stable key per queue entry: its id plus which occurrence of that id it is
   * within the WHOLE queue, so the same song twice still gets distinct keys.
   *
   * The position can't be part of it. Every row shifts up when a track ends, so
   * positional keys made React tear down and rebuild every row — and with it
   * every cover, which then faded in from blank. That was the flicker.
   */
  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return queue.map((s) => {
      const n = seen.get(s.id) ?? 0;
      seen.set(s.id, n + 1);
      return `${s.id}#${n}`;
    });
  }, [queue]);
  const totalSec = upcoming.reduce((acc, s) => acc + (s.duration ?? 0), 0);

  // Source label for the "Next from:" section; favorites/history sentinels
  // are translated (like in the player). Playing a mix that autoplay grew, it
  // is the mix that is announced: the album the queue started as is behind and
  // nothing coming is in it (#65).
  const sourceName = mixSeed
    ? t('Mix of “{name}”', { name: mixSeed.title })
    : source === SOURCE_FAVORITES
      ? t('Favorites')
      : source === SOURCE_HISTORY
        ? t('History')
        : source;
  const contextHeader = sourceName ? t('Next from {name}', { name: sourceName }) : null;
  // Where that mix begins, while it is still ahead: the source above holds
  // until there and the block gets a header of its own, named after the song
  // it was grown from (the one right before it). In a radio there is nothing
  // to separate, the whole queue is the mix.
  const mixStart = radioMode ? -1 : queue.findIndex((s) => s.fromMix);
  const mixHeader =
    mixStart > 0 && mixStart > index
      ? t('Next from {name}', {
          name: t('Mix of “{name}”', { name: queue[mixStart - 1].title }),
        })
      : null;

  /**
   * Section header for the row at queue position `abs` (or null).
   *
   * Headers live inside the rows, not as items of their own. That's why the
   * list has no `itemLayoutAnimation`: when a track ends every row shifts, the
   * one that carried the header loses it and another grows one, so animating
   * row layout animated rows changing height and read as the list rebuilding
   * itself. Making them real items would mean remapping the drag-to-reorder
   * indices around them.
   */
  const headerFor = (abs: number): string | null => {
    if (abs === start && start < index) return t('Previous::queue');
    if (abs === index) return t('Now playing');
    if (queuedCount > 0 && abs === index + 1) return t('Next in queue');
    // Before the source's: with the queue ending right where the mix starts,
    // both fall on the same row and the one that still applies below it is
    // this one.
    if (mixHeader && abs === mixStart) return mixHeader;
    if (abs === index + 1 + queuedCount && contextHeader) return contextHeader;
    return null;
  };

  return (
    <View style={[styles.safe, { paddingTop: topPad, paddingBottom: insets.bottom }]}>
    <View style={styles.header}>
      <Pressable hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="chevron-down" size={28} color={colors.text} />
      </Pressable>
        <View style={styles.headerCenter} pointerEvents="none">
          <Text style={styles.headerTitle}>{t('Queue')}</Text>
          {upcoming.length > 0 && totalSec > 0 ? (
            <Text style={styles.headerSub}>
              {songsLabel(upcoming.length, lang)} · {formatTotalDuration(totalSec)}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          {/* That this icon EXISTS is the warning that radio is still extending the
              queue; tapping it stops it. No icon without radio, so it's not in the
              way. It's a button, not a toggle: one that disappears on turning off
              couldn't be turned back on. To resume, you start another mix. */}
          {radioMode ? (
            <Pressable
              style={styles.headerAction}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Stop the mix')}
              onPress={() => {
                stopRadio();
                toast(t("The mix won't grow any further"));
              }}
            >
              <Ionicons name="sparkles" size={22} color={accent} />
            </Pressable>
          ) : null}
          {upcoming.length > 0 ? (
            <Pressable
              style={styles.headerAction}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Clear queue')}
              onPress={() => setConfirmClear(true)}
            >
              <Ionicons name="trash-outline" size={22} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          {queue.length > 0 ? (
            <Pressable
              style={styles.headerAction}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('More options')}
              onPress={() => menuRef.current()}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {current ? (
        <ReorderableList
          {...queueListPerf}
          data={rows}
          // The cursor is not in `data`: without this, advancing a track would
          // leave the accent and the speaker on the row that just ended.
          extraData={index}
          keyExtractor={(item, i) => rowKeys[start + i] ?? `${item.id}-${i}`}
          renderItem={({ item, index: rel }) => {
            const abs = start + rel;
            const header = headerFor(abs);
            return (
              <View style={styles.cell}>
                {/* No gap above the first one: it is already at the top. */}
                {header ? <SectionHeader title={header} gap={abs !== start} /> : null}
                <QueueRow
                  item={item}
                  absIndex={abs}
                  state={abs === index ? 'current' : abs < index ? 'previous' : 'upcoming'}
                />
              </View>
            );
          }}
          onReorder={({ from, to }: ReorderableListReorderEvent) => {
            moveTrack(start + from, start + to);
          }}
          contentContainerStyle={[styles.list, { paddingHorizontal: listPad }]}
        />
      ) : (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="list-outline"
            title={t('The queue is empty.')}
            subtitle={t('Play a song or album to start the queue.')}
          />
        </View>
      )}

      <Dialog
        visible={confirmClear}
        title={t('Clear queue')}
        message={t('The current song keeps playing.')}
        confirmLabel={t('Clear all')}
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          const undo = clearQueue();
          if (undo) toast(t('Queue cleared'), { label: t('Undo'), run: undo });
        }}
      />

      <SheetModal openRef={menuRef}>
        {(close) => (
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              close();
              const q = usePlayerStore.getState().queue;
              if (q.length > 0) usePlaylistPicker.getState().open(q);
            }}
          >
            <Ionicons name="add" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
          </Pressable>
        )}
      </SheetModal>
    </View>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  // ⋯ menu row (same look as the playlist / media menu).
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md },
  actionText: { color: colors.text, fontSize: fontSize.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // Absolute and centered over the bar: as a flex child it would shift off
  // center when right-side icons appear/disappear (`space-between` distributes
  // among all children). Uses pointerEvents="none" to not eat their touches.
  headerCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerAction: { width: 28, alignItems: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  headerSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  list: { flexGrow: 1, paddingBottom: spacing.sm },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  sectionGap: { marginTop: spacing.lg },
  cell: { backgroundColor: colors.background },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    // Opaque background so the dragged row covers the others while passing.
    backgroundColor: colors.background,
  },
  // Rows behind the cursor: dimmed to read as "past" without disappearing.
  previous: { opacity: 0.55 },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  artwork: { width: 44, height: 44 },
  info: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.md },
  // The line's own gap moved up to the row, so badge and name sit on the same
  // middle; `flexShrink` keeps a long name from pushing the badge off the row.
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
}));
