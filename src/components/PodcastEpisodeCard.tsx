/** Episode card for the «Recent episodes» shelf on Home. */
import { Pressable, StyleSheet, Text } from 'react-native';

import { COVER, coverArtUrl } from '@/api/data';
import { episodeToSong, type RecentEpisode } from '@/api/podcasts';
import { haptic } from '@/lib/haptics';
import { usePlayerStore } from '@/store/player';
import { fontSize, spacing, themed } from '@/theme';
import { Cover } from './Cover';

interface Props {
  item: RecentEpisode;
  width?: number;
}

export function PodcastEpisodeCard({ item, width = 150 }: Props) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const { episode, channel } = item;
  // The show's artwork, not the episode's: a feed's episode art is often a
  // square of the same image, sometimes missing, and a shelf of twenty shows
  // that each keep their own picture is the one that reads as twenty shows.
  const cover = coverArtUrl(channel.imageUrl, COVER.card);

  return (
    <Pressable
      style={StyleSheet.flatten([styles.container, { width }])}
      accessibilityRole="button"
      onPress={() => {
        haptic('light');
        // Just this one, on its own: a shelf is "play this", not "play the
        // podcast" — the show's own screen is where the run of episodes is.
        // The queue is left as the episode alone rather than the rest of the
        // shelf behind it, so nothing you did not ask for follows.
        void playQueue(
          [episodeToSong(episode, channel)],
          0,
          channel.title,
          `/podcast/${channel.id}`,
        );
      }}
    >
      <Cover uri={cover} size={width} placeholderIcon="headset-outline" />
      {/* Two lines: an episode title is a sentence where an album name is a
          noun, and one line cut "…and everything else we discussed" off it. */}
      <Text style={styles.title} numberOfLines={2}>
        {episode.title}
      </Text>
      <Text style={styles.sub} numberOfLines={1}>
        {channel.title}
      </Text>
    </Pressable>
  );
}

const styles = themed((colors) => ({
  container: { gap: spacing.xs },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
}));
