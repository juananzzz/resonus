/** Corazón para marcar/desmarcar favoritos (star/unstar de Subsonic). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';

import { star, unstar, type StarType } from '@/api/data';
import { tapHaptic } from '@/lib/haptics';
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
  const offline = useAuthStore((s) => s.offline);
  const queryClient = useQueryClient();
  const t = useT();
  const [fav, setFav] = useState(!!starred);
  const [busy, setBusy] = useState(false);

  // Re-sincroniza con la canción actual: el mismo componente se reutiliza al
  // cambiar de pista (mini-player/reproductor), así que sin esto el corazón
  // se quedaba "pegado" al estado de la canción anterior.
  useEffect(() => {
    setFav(!!starred);
  }, [id, starred]);

  async function toggle(e?: GestureResponderEvent) {
    e?.stopPropagation();
    if ((!auth && !offline) || busy) return;
    tapHaptic();
    const nextFav = !fav;
    setFav(nextFav); // actualización optimista
    setBusy(true);
    try {
      if (nextFav) await star(id, type);
      else await unstar(id, type);
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
      accessibilityLabel={fav ? t('Remove from favorites') : t('Add to favorites')}
    >
      <Ionicons
        name={fav ? 'heart' : 'heart-outline'}
        size={size}
        color={fav ? colors.accent : colors.textSecondary}
      />
    </Pressable>
  );
}
