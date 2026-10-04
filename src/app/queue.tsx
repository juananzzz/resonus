/**
 * Playback queue, in sections:
 *   · Previous — what is behind the cursor (optional setting).
 *   · Now playing — the current song.
 *   · Next in queue — what "Play next" put straight after it.
 *   · Next from: {source} — the rest of what was playing.
 *   · At the end of the queue — what "Add to queue" put after everything.
 * Every row can be dragged and removed, the one playing included (#157).
 *
 * The sections come from the marks the songs carry, not from where they sit.
 * `queuedCount` used to draw the line, and it is dissolved the moment you tap
 * a song instead of letting the queue reach it: after that the songs somebody
 * had added were sitting under "Next from <album>", which named a record none
 * of them came from (#184). A mark travels with the song, so it survives the
 * jump — and it survives a reorder too, which is what keeps the headers where
 * they belong when a row is dragged.
 */
import Icon from '@/components/Icon';
import { useRouter } from 'expo-router';
import { memo, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COVER } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { PlayingBars } from '@/components/PlayingBars';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { ExplicitBadge, useExplicitBadge } from '@/components/ExplicitBadge';
import { SheetModal } from '@/components/SheetModal';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useListPadding } from '@/hooks/useScreenSize';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { mixSeedOf, SOURCE_FAVORITES, SOURCE_HISTORY, usePlayerStore } from '@/store/player';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed, useTheme, tracking } from '@/theme';

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
// Memoised: the cursor moving re-renders the list, and with a long queue
// that was every mounted row rather than the two whose state changed.
const QueueRow = memo(function QueueRow({
  item,
  absIndex,
  state,
}: {
  item: Song;
  absIndex: number;
  state: 'previous' | 'current' | 'upcoming';
}) {
  const { songCoverUrl } = useCoverUrls();
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const removeAt = usePlayerStore((s) => s.removeAt);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const toast = useToast((s) => s.show);
  const t = useT();
  const drag = useReorderableDrag();
  // Memoised, so it has to ask for a repaint on a theme change itself.
  useTheme();
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
        {current ? <PlayingBars size={18} /> : null}
        <Pressable hitSlop={6} onPress={() => void remove()}>
          <Icon name="close" size={22} color={colors.textSecondary} />
        </Pressable>
        <Pressable hitSlop={6} onPressIn={() => { haptic('medium'); drag(); }}>
          <Icon name="reorder-two" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
});

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
  const source = usePlayerStore((s) => s.source);
  const mixSeed = usePlayerStore(mixSeedOf);
  const moveTrack = usePlayerStore((s) => s.moveTrack);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const radioMode = usePlayerStore((s) => s.radioMode);
  const stopRadio = usePlayerStore((s) => s.stopRadio);
  const restoreFromServer = usePlayerStore((s) => s.restoreFromServer);
  // The server's copy is only there for an account with a connection: a local
  // profile has no server, and offline there is nobody to ask.
  const hasServerQueue = useAuthStore((s) => !!s.auth && !s.offline);
  // Subscribed, not read straight off `colors`: a stack keeps this screen
  // mounted while you are elsewhere, so without this it would keep the accent
  // and the appearance it was last painted in.
  const { accent } = useTheme();
  const toast = useToast((s) => s.show);
  const [confirmClear, setConfirmClear] = useState(false);
  // ⋯ menu (imperative: opening/closing doesn't re-render the screen).
  const menuRef = useRef<() => void>(() => {});
  const insets = useSafeAreaInsets();
  // Inside a full-screen modal iOS reports no top inset, and the close
  // button would sit against the edge.
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
  /**
   * Where a song ahead of the cursor came from, which is what decides its
   * section. In a radio the whole queue is the mix and there is nothing to
   * separate, so nothing carries the mark there either.
   */
  type Kind = 'queued' | 'mix' | 'source';
  const kindOf = (i: number): Kind =>
    queue[i]?.queued ? 'queued' : queue[i]?.fromMix ? 'mix' : 'source';

  /**
   * Section header for the row at queue position `abs` (or null).
   *
   * Only the first row of each run gets one, so a header appears exactly where
   * the queue changes hands. Headers live inside the rows, not as items of
   * their own. That's why the list has no `itemLayoutAnimation`: when a track
   * ends every row shifts, the one that carried the header loses it and
   * another grows one, so animating row layout animated rows changing height
   * and read as the list rebuilding itself. Making them real items would mean
   * remapping the drag-to-reorder indices around them.
   */
  const headerFor = (abs: number): string | null => {
    if (abs === start && start < index) return t('Previous::queue');
    if (abs === index) return t('Now playing');
    if (abs < index) return null;
    const kind = kindOf(abs);
    if (abs > index + 1 && kindOf(abs - 1) === kind) return null;
    if (kind === 'queued') {
      // Straight after the current song it is what "Play next" leaves; anywhere
      // further along, what "Add to queue" left at the end (#184).
      return abs === index + 1 ? t('Next in queue') : t('At the end of the queue');
    }
    if (kind === 'mix') {
      // Named after the song it was grown from, which is the one before it.
      return t('Next from {name}', {
        name: t('Mix of “{name}”', { name: queue[abs - 1]?.title ?? '' }),
      });
    }
    return contextHeader;
  };

  // The title is centred over the whole bar, so it has to stay clear of the
  // icons on both sides: as much room on the left as the right side takes,
  // or a long word slides under them (#232).
  const rightIcons = (radioMode ? 1 : 0) + (upcoming.length > 0 ? 1 : 0) + (queue.length > 0 ? 1 : 0);
  const titleInset =
    spacing.lg + Math.max(1, rightIcons) * HEADER_ACTION_W + Math.max(0, rightIcons - 1) * spacing.sm;

  return (
    <View style={[styles.safe, { paddingTop: topPad, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Icon name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <View
          style={[styles.headerCenter, { left: titleInset, right: titleInset }]}
          pointerEvents="none"
        >
          <Text
            style={styles.headerTitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {t('Queue')}
          </Text>
          {upcoming.length > 0 && totalSec > 0 ? (
            <Text style={styles.headerSub} numberOfLines={1}>
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
              <Icon name="sparkles" size={22} color={accent} />
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
              <Icon name="trash-outline" size={22} color={colors.textSecondary} />
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
              <Icon name="ellipsis-horizontal" size={22} color={colors.text} />
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
            // Empty is exactly when the queue left on another player is worth
            // bringing over, and the ⋯ menu that offers it only shows with a
            // queue (#248 made this screen reachable without one).
            action={
              hasServerQueue
                ? {
                    label: t("Get the server's queue"),
                    onPress: () =>
                      void restoreFromServer(true).then((found) => {
                        if (!found) toast(t('The server has no saved queue'));
                      }),
                  }
                : undefined
            }
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
          <>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                const q = usePlayerStore.getState().queue;
                if (q.length > 0) usePlaylistPicker.getState().open(q);
              }}
            >
              <Icon name="add" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
            </Pressable>
            {/* The queue is pushed to the server as it changes, but what comes
                back is only read when this device has none of its own: the copy
                here is the faithful one and replacing it behind somebody's back
                is not a thing to do on its own. This is that decision, taken by
                hand — the queue left on another player, brought over. */}
            {hasServerQueue ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  void restoreFromServer(true).then((found) => {
                    toast(found ? t('Queue brought over') : t('The server has no saved queue'));
                  });
                }}
              >
                <Icon name="cloud-download-outline" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t("Get the server's queue")}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </SheetModal>
    </View>
  );
}

/** Width of each icon button in the bar, which the centred title keeps clear of. */
const HEADER_ACTION_W = 28;

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
  headerAction: { width: HEADER_ACTION_W, alignItems: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  headerSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  list: { flexGrow: 1, paddingBottom: spacing.sm },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
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
