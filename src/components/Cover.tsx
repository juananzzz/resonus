/** Carátula cuadrada con marcador de posición cuando no hay imagen. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { colors, radius } from '@/theme';

interface Props {
  uri?: string;
  size: number;
  rounded?: boolean;
}

export function Cover({ uri, size, rounded }: Props) {
  const borderRadius = rounded ? size / 2 : radius.md;
  if (!uri) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius,
          backgroundColor: colors.surfaceHighlight,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="musical-notes" size={size * 0.4} color={colors.textMuted} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius }}
      contentFit="cover"
      transition={200}
    />
  );
}
