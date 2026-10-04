/** 5-star bar to rate a song (Subsonic setRating). */
import Icon from '@/components/Icon';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { setRating } from '@/api/data';
import { useT } from '@/i18n';
import { colors, spacing } from '@/theme';

interface Props {
  id: string;
  /** Current rating (1-5); 0 or absent if not rated. */
  rating?: number;
  size?: number;
  /** Called after saving (to persist the value where needed). */
  onRated?: (rating: number) => void;
}

export function StarRating({ id, rating, size = 22, onRated }: Props) {
  const t = useT();
  const [value, setValue] = useState(rating ?? 0);
  const [busy, setBusy] = useState(false);

  // The same component is reused when switching tracks: without this the stars
  // would stick to the previous song's rating.
  useEffect(() => {
    setValue(rating ?? 0);
  }, [id, rating]);

  async function rate(n: number) {
    if (busy) return;
    // Tapping the already-selected star clears the rating (goes back to 0).
    const next = n === value ? 0 : n;
    const prev = value;
    setValue(next); // optimistic update
    setBusy(true);
    try {
      await setRating(id, next);
      if (onRated) onRated(next);
    } catch {
      setValue(prev); // revert on failure
    }
    setBusy(false);
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
          <Icon
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
