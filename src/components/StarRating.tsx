/** Barra de 5 estrellas para valorar una canción (setRating de Subsonic). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { setRating } from '@/api/data';
import { useT } from '@/i18n';
import { colors, spacing } from '@/theme';

interface Props {
  id: string;
  /** Valoración actual (1-5); 0 o ausente si no está puntuada. */
  rating?: number;
  size?: number;
  /** Se llama tras guardar (para persistir el valor donde haga falta). */
  onRated?: (rating: number) => void;
}

export function StarRating({ id, rating, size = 22, onRated }: Props) {
  const t = useT();
  const [value, setValue] = useState(rating ?? 0);
  const [busy, setBusy] = useState(false);

  // El mismo componente se reutiliza al cambiar de pista: sin esto las estrellas
  // se quedarían con la valoración de la canción anterior.
  useEffect(() => {
    setValue(rating ?? 0);
  }, [id, rating]);

  async function rate(n: number) {
    if (busy) return;
    // Tocar la estrella ya marcada quita la valoración (vuelve a 0).
    const next = n === value ? 0 : n;
    const prev = value;
    setValue(next); // actualización optimista
    setBusy(true);
    try {
      await setRating(id, next);
      onRated?.(next);
    } catch {
      setValue(prev); // revertir si falla
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          hitSlop={4}
          onPress={() => rate(n)}
          accessibilityRole="button"
          accessibilityLabel={t('Rate {n} stars', { n })}
        >
          <Ionicons
            name={n <= value ? 'star' : 'star-outline'}
            size={size}
            color={n <= value ? colors.accent : colors.textSecondary}
            style={styles.star}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  star: { marginRight: spacing.xs },
});
