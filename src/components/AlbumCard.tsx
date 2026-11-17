/** Album card for home and search grids/carousels. */
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER, coverArtUrl, type Album } from '@/api/data';
import Icon from '@/components/Icon';
import { useMediaMenu } from '@/store/mediaMenu';
import { haptic } from '@/lib/haptics';
import { DIM_OPACITY, fontSize, lineHeight, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { Cover } from './Cover';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';

interface Props {
  album: Album;
  width?: number;
  /** Called when the card is tapped (in addition to navigating to the album). */
  onPress?: () => void;
  /**
   * The three marks the favorited list of the Library tab draws. They are
   *  optional because the pin, the ↓ and the fade belong to what you keep:
   *  Home and search show the server's catalogue, where nothing is pinned and
   *  everything plays.
   */
  pinned?: boolean;
  badge?: boolean;
  dimmed?: boolean;
}

// Memoised: a Home render redrew every card on every shelf (a report had 77
// card renders per Home render).
export const AlbumCard = memo(function AlbumCard({
  album,
  width = 150,
  onPress,
  pinned,
  badge,
  dimmed,
}: Props) {
  bump('render · AlbumCard');
  // Memoised, so it has to ask for a repaint on a theme change itself.
  const { accent } = useTheme();
  const cover = coverArtUrl(album.coverArt ?? album.id, COVER.card);
  const openMenu = useMediaMenu((s) => s.open);
  const explicit = useExplicitBadge(album.explicitStatus);

  return (
    <Link href={`/album/${album.id}`} asChild>
      {/* expo-router merges the Link style into this child; it must be a
          single object, not an array, so we flatten it. */}
      <Pressable
        style={StyleSheet.flatten([styles.container, { width }, dimmed && styles.dimmed])}
        onPress={onPress}
        onLongPress={() => {
          haptic('light');
          openMenu({ kind: 'album', album });
        }}
      >
        <Cover uri={cover} size={width} />
        <Text style={styles.title} numberOfLines={1}>
          {album.name}
        </Text>
        {explicit || badge || pinned || album.artist ? (
          <View style={styles.subRow}>
            {badge ? <Icon name="arrow-down-circle" size={12} color={accent} /> : null}
            {pinned ? <Icon name="pin" size={12} color={accent} /> : null}
            <ExplicitBadge status={album.explicitStatus} />
            {album.artist ? (
              <Text style={styles.artist} numberOfLines={1}>
                {album.artist}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
});

const styles = themed((colors) => ({
  container: {
    gap: spacing.xs,
  },
  // Offline with nothing to play: the same fade a row gets.
  dimmed: { opacity: DIM_OPACITY },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    // Gives way to the badge instead of pushing it off the card.
    flexShrink: 1,
  },
}));
