/** Tarjeta de álbum para las cuadrículas/carruseles del inicio y la búsqueda. */
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { coverArtUrl, type Album } from '@/api/data';
import { colors, fontSize, spacing } from '@/theme';
import { Cover } from './Cover';

interface Props {
  album: Album;
  width?: number;
  /** Se llama al tocar la tarjeta (además de navegar al álbum). */
  onPress?: () => void;
}

export function AlbumCard({ album, width = 150, onPress }: Props) {
  const cover = coverArtUrl(album.coverArt ?? album.id, 300);

  return (
    <Link href={`/album/${album.id}`} asChild>
      {/* expo-router fusiona el estilo del Link en este hijo; debe ser un
          único objeto, no un array, así que lo aplanamos. */}
      <Pressable style={StyleSheet.flatten([styles.container, { width }])} onPress={onPress}>
        <Cover uri={cover} size={width} />
        <Text style={styles.title} numberOfLines={1}>
          {album.name}
        </Text>
        {album.artist ? (
          <Text style={styles.artist} numberOfLines={1}>
            {album.artist}
          </Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
});
