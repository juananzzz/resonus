/** Tarjeta de color para un género (estilo Spotify). Lleva a /genre/[name]. */
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/theme';

/** Color estable a partir del nombre del género (oscuro y legible). */
export function genreColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 50%, 32%)`;
}

export function GenreCard({ name, width }: { name: string; width?: number }) {
  return (
    <Link href={`/genre/${encodeURIComponent(name)}`} asChild>
      <Pressable
        style={StyleSheet.flatten([
          styles.card,
          { backgroundColor: genreColor(name) },
          width != null ? { width } : { flex: 1 },
        ])}
      >
        <Text style={styles.text} numberOfLines={2}>
          {name}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 88,
    borderRadius: radius.md,
    padding: spacing.md,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  text: { color: colors.text, fontSize: fontSize.md, fontWeight: '800' },
});
