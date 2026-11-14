/**
 * The row that sits between a browse list and its search box, shaped like the
 * one a genre has: what you do to the list on the left, what starts it on the
 * right.
 *
 * It replaced a scrolling row of order pills, and the reason is what the pills
 * left behind. Play and shuffle on their own had nothing on that side of the
 * screen to sit beside, so they read as a green circle alone in an empty band;
 * a genre's pair looks settled because a group of controls holds the other end
 * of the row. The order was already the obvious candidate: as pills it was a
 * second scrolling row of the same shape as the sections above it, which made
 * the two hard to tell apart at a glance.
 *
 * The order is spelled out next to the icon rather than hidden behind it, the
 * way the Library tab writes it, so nothing is lost by the menu: what the list
 * is sorted by is still readable without opening anything.
 */
import Icon from '@/components/Icon';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { getSongList, type Song } from '@/api/data';
import { type SongListSort } from '@/api/subsonic';
import { SortSheet } from '@/components/SortSheet';
import { useAccent } from '@/hooks/useAccent';
import { useT } from '@/i18n';
import { playShuffle } from '@/lib/playShuffle';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed } from '@/theme';

/**
 * Songs fetched when Play is pressed. The list on screen is a window on a
 * paginated one, so playing it would mean "the first thirty, and whatever you
 * happened to scroll past"; this asks for a queue's worth in the order the
 * list is set to, which is what a genre does with the same button.
 */
const PLAY_SIZE = 200;

/** What the pair on the right starts, for the lists that have something to
 *  start. Left out by the ones that do not (all artists, say). */
interface PlayTarget {
  /** The song order to ask the server for. */
  sort?: SongListSort;
  /** What the player says it is playing from, and where that name leads. */
  source: string;
  href: string;
}

export function BrowseToolbar<T extends string>({
  options,
  value,
  onChange,
  play,
}: {
  /** In the order they should be shown; the label is a translation key. One of
   *  them, or none, is not a choice, and then no control is drawn. */
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  play?: PlayTarget;
}) {
  const t = useT();
  const accent = useAccent();
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const sortRef = useRef<() => void>(() => {});
  /** A queue's worth is a request, and the play button says so meanwhile. */
  const [starting, setStarting] = useState(false);

  const current = options.find((o) => o.key === value);

  async function onPlay() {
    if (!play || starting) return;
    setStarting(true);
    try {
      const queue = await getSongList(play.sort ?? 'server', PLAY_SIZE, 0);
      if (queue.length === 0) {
        toast(t('Nothing to shuffle yet'));
        return;
      }
      await playQueue(queue as Song[], 0, play.source, play.href);
    } catch {
      toast(t("Couldn't load songs."));
    } finally {
      setStarting(false);
    }
  }

  async function onShuffle() {
    if (starting) return;
    setStarting(true);
    try {
      await playShuffle();
    } finally {
      setStarting(false);
    }
  }

  return (
    <View style={styles.row}>
      {options.length < 2 || !current ? (
        <View />
      ) : (
        <Pressable
          style={styles.sort}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('Sort')}
          onPress={() => sortRef.current()}
        >
          <Icon name="swap-vertical" size={18} color={colors.textSecondary} />
          <Text style={styles.sortText} numberOfLines={1}>
            {t(current.label)}
          </Text>
        </Pressable>
      )}

      {play ? (
        <View style={styles.playRow}>
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Shuffle')}
            onPress={() => void onShuffle()}
          >
            <Icon name="shuffle" size={26} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            style={[styles.playButton, { backgroundColor: accent }]}
            accessibilityRole="button"
            accessibilityLabel={t('Play')}
            onPress={() => void onPlay()}
          >
            {starting ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Icon name="play" size={28} color={colors.onAccent} />
            )}
          </Pressable>
        </View>
      ) : null}

      <SortSheet
        options={options}
        field={value}
        onPick={(key) => onChange(key as T)}
        openRef={sortRef}
      />
    </View>
  );
}

const styles = themed((colors) => ({
  // The same row an album, a playlist and a genre have, to the same margins.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  // Room to shrink: a long order name gives way to the buttons rather than
  // pushing them off the edge.
  sort: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  sortText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  // Same measurements as `TrackListView`, which is what an album and a playlist
  // put in this corner.
  playButton: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
