/** Corazón para marcar/desmarcar favoritos (star/unstar de Subsonic). */
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';

import { star, unstar, type StarType } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/i18n';
import { colors } from '@/theme';

interface Props {
  id: string;
  type?: StarType;
  starred?: boolean;
  size?: number;
}

export function FavoriteButton({ id, type = 'song', starred, size = 22 }: Props) {
  const auth = useAuthStore((s) => s.auth);
  const queryClient = useQueryClient();
  const t = useT();
  const [fav, setFav] = useState(!!starred);
  const [busy, setBusy] = useState(false);

  async function toggle(e?: GestureResponderEvent) {
    e?.stopPropagation();
    if (!auth || busy) return;
    const nextFav = !fav;
    setFav(nextFav); // actualización optimista
    setBusy(true);
    try {
      if (nextFav) await star(auth, id, type);
      else await unstar(auth, id, type);
      // Refresca la lista de favoritos si está abierta.
      queryClient.invalidateQueries({ queryKey: ['starred'] });
    } catch {
      setFav(!nextFav); // revertir si falla
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      hitSlop={10}
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={fav ? t('Quitar de favoritos') : t('Añadir a favoritos')}
    >
      <Ionicons
        name={fav ? 'heart' : 'heart-outline'}
        size={size}
        color={fav ? colors.accent : colors.textSecondary}
      />
    </Pressable>
  );
}
