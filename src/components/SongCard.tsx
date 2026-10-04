/**
 * Song as a card, for the grid in browsing songs. The row (`TrackRow`) is what
 * every other list uses; this is the same song drawn for a grid, so the screen
 * can offer both views like browsing albums and artists do.
 *
 * Tapping plays, holding starts selecting: what the rows do, so switching view
 * doesn't change what your fingers already know.
 */
import Icon from '@/components/Icon';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { COVER, type Song } from '@/api/data';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { Cover, useCoverRadius } from './Cover';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';

interface Props {
  song: Song;
  width: number;
  /** Playing right now: the title takes the accent, as in the rows. */
  isCurrent?: boolean;
  accent: string;
  selecting?: boolean;
  selected?: boolean;
  onPress?: () => void;
  onPressIn?: () => void;
  onLongPress?: () => void;
}

export const SongCard = memo(function SongCard({
  song,
  width,
  isCurrent,
  accent,
  selecting,
  selected,
  onPress,
  onPressIn,
  onLongPress,
}: Props) {
  const { songCoverUrl } = useCoverUrls();
  bump('render · SongCard');
  // Worked out here rather than read off the song: see the same note in
  // `TrackRow`. A list the server answered before the connection went away
  // carries no mark, and would show as if it were on the phone.
  const downloaded = useDownloads((s) => !!s.files[song.id]);
  const offline = useAuthStore((s) => s.offline);
  // Memoized, so the screen repainting is not enough to bring this one along.
  useTheme();
  const unavailable = offline
    ? !song.url && !song.localUri && !downloaded
    : !!song.unavailable;
  const explicit = useExplicitBadge(song.explicitStatus);
  const corner = useCoverRadius(width);
  return (
    <Pressable
      style={[styles.container, { width }]}
      onPress={onPress}
      onPressIn={onPressIn}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected: !!selected } : undefined}
    >
      <View>
        <Cover uri={songCoverUrl(song, COVER.card)} size={width} />
        {/* Only while selecting: a tick on every cover the rest of the time
            would be noise on top of the artwork. */}
        {selecting ? (
          <View style={[styles.check, selected && { backgroundColor: accent }]}>
            {selected ? <Icon name="checkmark" size={16} color={colors.onAccent} /> : null}
          </View>
        ) : null}
        {/* Dimmed rather than hidden: it is in the library, it just isn't on
            this device, same as the rows show it. */}
        {unavailable ? (
          <View style={[styles.veil, { width, height: width, borderRadius: corner }]} />
        ) : null}
      </View>
      <Text style={[styles.title, isCurrent && { color: accent }]} numberOfLines={1}>
        {song.title}
      </Text>
      {explicit || song.artist ? (
        <View style={styles.subRow}>
          <ExplicitBadge status={song.explicitStatus} />
          {song.artist ? (
            <Text style={styles.artist} numberOfLines={1}>
              {song.artist}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = themed((colors) => ({
  container: { gap: spacing.xs },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // `flexShrink` so a long name gives way to the badge instead of pushing it
  // off the card.
  artist: { color: colors.textSecondary, fontSize: fontSize.xs, flexShrink: 1 },
  check: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    // Over the cover, not over the page: white in both appearances.
    borderColor: colors.onArtwork,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  veil: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: colors.veil,
  },
}));
