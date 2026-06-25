/** Carátula del acceso a Favoritos: degradado verde-azulado con un corazón. */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { radius } from '@/theme';

export function FavoritesArt({ size }: { size: number }) {
  return (
    <LinearGradient
      colors={['#3be477', '#2a7de0'] as const}
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
