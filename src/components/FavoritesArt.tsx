/**
 * Carátula del acceso a Favoritos: degradado índigo → celeste con un corazón,
 * como "Canciones que te gustan" de Spotify. La cabecera de la pantalla de
 * Favoritos usa el índigo oscurecido (ver HEADER_COLOR allí).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';

import { radius } from '@/theme';

export function FavoritesArt({ size }: { size: number }) {
  return (
    <LinearGradient
      colors={['#450af5', '#8e8ee5'] as const}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="heart" size={size * 0.45} color="#fff" />
    </LinearGradient>
  );
}
