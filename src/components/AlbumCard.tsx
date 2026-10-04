/** Album card for home and search grids/carousels. */
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER, type Album } from '@/api/data';
import { useMediaMenu } from '@/store/mediaMenu';
import { haptic } from '@/lib/haptics';
import { fontSize, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { Cover } from './Cover';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';

interface Props {
  album: Album;
  width?: number;
  /** Called when the card is tapped (in addition to navigating to the album). */
  onPress?: () => void;
}

// Memoised: a Home render redrew every card on every shelf (a report had 77
// card renders per Home render).
export const AlbumCard = memo(function AlbumCard({ album, width = 150, onPress }: Props) {
  const { coverArtUrl } = useCoverUrls();
  bump('render · AlbumCard');
  // Memoised, so it has to ask for a repaint on a theme change itself.
  useTheme();
  const cover = coverArtUrl(album.coverArt ?? album.id, COVER.card);
  const openMenu = useMediaMenu((s) => s.open);
  const explicit = useExplicitBadge(album.explicitStatus);

  return (
    <Link href={`/album/${album.id}`} asChild>
      {/* expo-router merges the Link style into this child; it must be a
          single object, not an array, so we flatten it. */}
      <Pressable
        style={StyleSheet.flatten([styles.container, { width }])}
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
        {explicit || album.artist ? (
          <View style={styles.subRow}>
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
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    // Gives way to the badge instead of pushing it off the card.
    flexShrink: 1,
  },
}));
