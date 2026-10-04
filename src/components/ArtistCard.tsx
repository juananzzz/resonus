/**
 * Artist card for grids and carousels: round photo with the name below,
 * centered. The twin of `AlbumCard`, which already existed; artists were
 * previously drawn by hand on each screen.
 */
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { COVER, type Artist } from '@/api/data';
import { fontSize, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { Cover } from './Cover';

interface Props {
  artist: Artist;
  width?: number;
}

export const ArtistCard = memo(function ArtistCard({ artist, width = 150 }: Props) {
  const { coverArtUrl } = useCoverUrls();
  bump('render · ArtistCard');
  // Memoised, so it has to ask for a repaint on a theme change itself.
  useTheme();
  const cover = coverArtUrl(artist.coverArt ?? artist.id, COVER.card);

  return (
    <Link href={`/artist/${artist.id}`} asChild>
      {/* expo-router merges the Link style into this child; it must be a
          single object, not an array, so we flatten it. */}
      <Pressable style={StyleSheet.flatten([styles.container, { width }])}>
        <Cover uri={cover} size={width} rounded />
        <Text style={styles.name} numberOfLines={1}>
          {artist.name}
        </Text>
      </Pressable>
    </Link>
  );
});

const styles = themed((colors) => ({
  container: { gap: spacing.xs, alignItems: 'center' },
  name: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
}));
