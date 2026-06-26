/** Cuadrícula reutilizable de álbumes (N columnas que se reparten el ancho). */
import { Dimensions, StyleSheet, View } from 'react-native';

import { type Album } from '@/api/subsonic';
import { spacing } from '@/theme';
import { AlbumCard } from './AlbumCard';

interface Props {
  albums: Album[];
  columns?: number;
}

export function AlbumGrid({ albums, columns = 2 }: Props) {
  const gap = spacing.sm;
  const width =
    (Dimensions.get('window').width - spacing.lg * 2 - gap * (columns - 1)) /
    columns;

  return (
    <View style={[styles.grid, { gap }]}>
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} width={width} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
  },
});
