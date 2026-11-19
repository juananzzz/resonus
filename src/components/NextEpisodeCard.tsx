/**
 * One card of Home's "Next episode" strip: one episode of one hearted
 *  show — the show's art and the episode's title up top, what the feed says
 *  about the episode under it, and an action row: the episode's sheet on
 *  ⋯, its SQLite heart on the heart, and Play, which starts just this
 *  episode and carries on in the player, the way "Playing elsewhere" does.
 *  The strip places these sideways, one card to a view, the next peeking
 *  from the side like every other shelf.
 *
 * There is no picture of the episode itself to show: a feed carries one
 *  picture, the show's, and that is the one drawn here — the same rule
 *  `PodcastEpisodeCard` and `PodcastRow` work by.
 */
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { Cover } from './Cover';
import { FavoriteButton } from './FavoriteButton';
import { COVER, coverArtUrl } from '@/api/data';
import {
  episodeToSong,
  podcastCover,
  queueEpisode,
  type RecentEpisode,
} from '@/api/podcasts';
import { useT } from '@/i18n';
import { formatEpisodeDate, formatTotalDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useDominantColor } from '@/hooks/useDominantColor';
import { usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { useEpisodeUnavailable } from '@/hooks/useEpisodeUnavailable';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { useToast } from '@/store/toast';
import { DIM_OPACITY, colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

/** How big the show's picture is. Bigger than the shelf cards' 150/4 the
 *   card gets: this one shows one episode to the whole screen. */
const ART = 104;

interface Props {
  item: RecentEpisode;
  /** Given on the strip: the card then takes a fixed width and the list's
   *   gap spaces it; on its own it fills the row, margins and all. */
  width?: number;
}

export function NextEpisodeCard({ item, width }: Props) {
  const { accent } = useTheme();
  const t = useT();
  const router = useRouter();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);
  const openSongMenu = useSongMenu((s) => s.open);
  const { episode, channel } = item;
  // Offline and not on disk: dimmed, and a tap says so instead of pretending
  // it can stream the publisher's address — the same rule as the shelf's card.
  const unavailable = useEpisodeUnavailable(episode.id);
  // On disk: the ↓ badge, shown online too, as every other episode surface
  // wears it.
  const downloaded = useDownloads((s) => !!s.files[episode.id]);
  // The episode's own heart: hearting it here is the same SQLite heart an
  // episode row lights, so the two cannot disagree.
  const hearted = usePodcastFavoriteIds().has(episode.id);

  // The show's picture and the card's tints, read off it: the same two
  // bands "Playing elsewhere" paints with — the colour is clamped into a
  // band that keeps the ordinary text on it legible, brighter at the top
  // of the card, calmer at the bottom. While a never-read cover is out,
  // the hook answers the page's own tint, so the card never blinks.
  const cover = coverArtUrl(podcastCover(channel), COVER.card);
  const vivid = useDominantColor(cover, true);
  const calm = useDominantColor(cover);

  // The date and length line: "12 Jun 2026 · 42 min" — either half can be
  // missing (a feed that dates nothing, an item with no enclosure length),
  // and the line only shows what the feed actually said.
  const meta = [
    formatEpisodeDate(episode.publishedAt, lang),
    episode.duration !== undefined ? formatTotalDuration(episode.duration) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const start = () => {
    haptic('light');
    // Just this episode; the show's screen queues the rest. Started playing
    // if the queue was not rolling already, then the player opens to show
    // what is about to play, as the card at the top of Home does.
    queueEpisode(episode, channel);
    if (!usePlayerStore.getState().isPlaying) void usePlayerStore.getState().toggle();
    router.push('/player');
  };

  return (
    <Pressable
      style={StyleSheet.flatten([width ? { width } : styles.standalone, unavailable && styles.dimmed])}
      accessibilityRole="button"
      accessibilityLabel={`${episode.title} · ${channel.title}`}
      onPress={
        unavailable
          ? () => toast(t('Not available offline'))
          : () => {
              haptic('light');
              // A tap on the card queues this episode, like the shelf's card.
              queueEpisode(episode, channel);
            }
      }
      onLongPress={
        unavailable
          ? undefined
          : () => {
              haptic('light');
              openSongMenu(episodeToSong(episode, channel));
            }
      }
    >
      {/* The cover's colour under all of it, not the page's surface: the
          same two bands the card at the top of Home paints, so one big
          episode reads like one big now-playing. The tints are clamped
          readable, so the text on top keeps its ordinary colours. */}
      <LinearGradient
        colors={[vivid, calm] as const}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.top}>
          <Cover uri={cover} size={ART} style={styles.art} placeholderIcon="headset-outline" />
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {episode.title}
            </Text>
            <View style={styles.subLine}>
              {downloaded ? <Icon name="arrow-down-circle" size={13} color={accent} /> : null}
              <Text style={styles.sub} numberOfLines={1}>
                {channel.title}
              </Text>
            </View>
          </View>
        </View>
        {/* Date · length flow straight into the description: one paragraph,
            not a grey line above a grey paragraph. The date and the length
            carry the card's own white, the notes stay the muted colour — the
            nested Text is what lets one block hold two colours. `numberOfLines`
            on the outer Text counts the whole flow, children included, so the
            paragraph ends after four lines, with or without the lead. */}
        {meta || episode.description ? (
          <Text style={styles.flow} numberOfLines={4}>
            {meta ? `${meta} · ` : ''}
            {episode.description ? (
              <Text style={styles.description}>{episode.description}</Text>
            ) : null}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {/* The episode's own sheet: hearting or downloading THIS episode
              works from the card too, as it does from a row. */}
          <Pressable
            hitSlop={8}
            onPress={() => {
              haptic('light');
              openSongMenu(episodeToSong(episode, channel));
            }}
            accessibilityRole="button"
            accessibilityLabel={t('More')}
          >
            <Icon name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
          </Pressable>
          <FavoriteButton
            id={episode.id}
            starred={hearted}
            size={22}
            podcast={{ kind: 'episode', channelId: channel.id }}
          />
          <Pressable
            disabled={unavailable}
            style={styles.play}
            onPress={start}
            accessibilityRole="button"
            accessibilityLabel={t('Play')}
          >
            <Icon name="play" size={26} color={colors.onAccent} />
          </Pressable>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = themed((colors) => ({
  standalone: { marginHorizontal: spacing.lg, marginBottom: spacing.lg },
  // The gradient paints its own colours; this only gives it the card's
  // shape. `overflow` keeps the tint off the rounded corners' edges.
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  art: { borderRadius: radius.sm },
  info: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '500' },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sub: { color: colors.textSecondary, fontSize: fontSize.xs, flexShrink: 1 },
  // The date and the length lead the paragraph in the card's own white;
  // the nested Text takes the notes back down to the muted colour, at the
  // same size so it reads on instead of stepping out as a second voice.
  flow: { color: colors.text, fontSize: fontSize.sm },
  description: { color: colors.textSecondary, fontSize: fontSize.sm },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  play: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  // Offline and not downloaded: the same dim as the shelf's card.
  dimmed: { opacity: DIM_OPACITY },
}));
