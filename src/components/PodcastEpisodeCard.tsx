/** Episode card for the «Recent episodes» shelf on Home. */
import { Pressable, StyleSheet, Text } from 'react-native';

import { COVER } from '@/api/data';
import { episodeToSong, type RecentEpisode } from '@/api/podcasts';
import { haptic } from '@/lib/haptics';
import { usePlayerStore } from '@/store/player';
import { fontSize, spacing, themed } from '@/theme';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { Cover } from './Cover';

interface Props {
  item: RecentEpisode;
  width?: number;
}

export function PodcastEpisodeCard({ item, width = 150 }: Props) {
  const { coverArtUrl } = useCoverUrls();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const { episode, channel } = item;
  // The show's artwork: episode art is often missing or the same image.
  const cover = coverArtUrl(channel.imageUrl, COVER.card);

  return (
    <Pressable
      style={StyleSheet.flatten([styles.container, { width }])}
      accessibilityRole="button"
      onPress={() => {
        haptic('light');
        // Just this episode; the show's screen queues the rest.
        void playQueue(
          [episodeToSong(episode, channel)],
          0,
          channel.title,
          `/podcast/${channel.id}`,
        );
      }}
    >
      <Cover uri={cover} size={width} placeholderIcon="headset-outline" />
      {/* Two lines: episode titles are sentences. */}
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
