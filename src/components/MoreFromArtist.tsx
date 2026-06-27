/**
 * Sección "Más de <artista>" al pie del detalle de álbum: un carrusel con
 * los demás álbumes del artista y un enlace ("Show all") a la discografía
 * completa en lista vertical.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getArtist } from '@/api/data';
import { AlbumCard } from '@/components/AlbumCard';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

interface Props {
  artistId: string;
  artistName: string;
  currentAlbumId: string;
}

export function MoreFromArtist({ artistId, artistName, currentAlbumId }: Props) {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();

  const { data } = useQuery({
    queryKey: ['artist', artistId],
    queryFn: () => getArtist(artistId),
    enabled: canFetch && !!artistId,
  });

  const albums = [...(data?.albums ?? [])]
    .filter((a) => a.id !== currentAlbumId)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  if (albums.length === 0) return null;

  return (
    <View style={styles.section}>
      <Link href={`/artist/discography/${artistId}`} asChild>
        <Pressable style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {t('More from {artist}', { artist: artistName })}
          </Text>
          {albums.length > 1 ? <Text style={styles.showAll}>{t('Show all')}</Text> : null}
        </Pressable>
      </Link>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {albums.slice(0, 10).map((album) => (
          <AlbumCard key={album.id} album={album} width={140} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Anula el padding horizontal del contenedor de la lista para que el
  // carrusel ocupe todo el ancho.
  section: { marginTop: spacing.xl, marginHorizontal: -spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    flex: 1,
    marginRight: spacing.md,
  },
  showAll: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  row: { gap: spacing.md, paddingHorizontal: spacing.lg },
});
