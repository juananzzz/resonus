/**
 * A queue that was listened to, as a card for Home's shelf (the «Saved queues»
 *  row).
 *
 * The twin of `PlaylistCard` rather than a design of its own: a saved queue is
 * a list of songs someone worked through, and what makes it worth bringing back
 * is that it was heard to somewhere. So the card shows what the queue was
 * started as, how many songs it holds, and the picture of the song that was
 * playing when the listening stopped.
 *
 * Tapping carries on there — the queue comes back paused at the moment it
 * stopped, so the next tap is the play button — and long-pressing opens the
 * context menu (see `MediaMenuSheet`), the way the other cards do.
 */
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { COVER, songCoverUrl } from '@/api/data';
import { usePlayerStore } from '@/store/player';
import { useMediaMenu } from '@/store/mediaMenu';
import { songsLabel, useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { bump } from '@/lib/perfLog';
import { heardAt, queueName, type SavedQueueEntry } from '@/lib/savedQueues';
import { useSettings } from '@/store/settings';
import { fontSize, lineHeight, spacing, themed, useTheme } from '@/theme';
import { Cover } from './Cover';

interface Props {
  entry: SavedQueueEntry;
  width?: number;
}

export const SavedQueueCard = memo(function SavedQueueCard({ entry, width = 150 }: Props) {
  bump('render · SavedQueueCard');
  // Memoised, so it has to ask for a repaint on a theme change itself.
  useTheme();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const openMenu = useMediaMenu((s) => s.open);
  // The listening stopped at one song: that is whose picture the card wears,
  // which is also what makes a queue one tap away from where it was left.
  const stopped = heardAt(entry);
  const cover = stopped ? songCoverUrl(stopped, COVER.card) : undefined;
  const name = queueName(entry);

  const carryOn = async () => {
    haptic('light');
    // Paused, at the second the queue stopped at, and in the player: the way
    // back in is one more tap rather than a song that starts under a thumb.
    if (await usePlayerStore.getState().resumeSavedQueue(entry, 'continue')) {
      router.push('/player');
    }
  };

  return (
    <Pressable
      style={StyleSheet.flatten([styles.container, { width }])}
      onPress={() => void carryOn()}
      accessibilityRole="button"
      accessibilityLabel={`${t('Saved queue')}: ${name}. ${t('Continue queue')}`}
      onLongPress={() => {
        haptic('light');
        openMenu({ kind: 'queue', entry });
      }}
    >
      <Cover uri={cover} size={width} />
      <Text style={styles.title} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.sub} numberOfLines={1}>
        {songsLabel(entry.queue.length, lang)}
      </Text>
    </Pressable>
  );
});

const styles = themed((colors) => ({
  container: { gap: spacing.xs },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
  },
}));
