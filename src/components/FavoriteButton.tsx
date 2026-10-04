/** Heart to mark/unmark favorites (Subsonic star/unstar). */
import Icon from '@/components/Icon';
import { useEffect, useState } from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';

import { star, unstar, type StarType } from '@/api/data';
import { applyStarChange, resyncFavorites, unstarWithUndo } from '@/lib/favoritesCache';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { usePins } from '@/store/pins';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors } from '@/theme';

interface Props {
  id: string;
  type?: StarType;
  starred?: boolean;
  size?: number;
  /** Song lists only: take the favourite off behind an «Undo» toast (#98). */
  undo?: boolean;
}

export function FavoriteButton({ id, type = 'song', starred, size = 22, undo }: Props) {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const toast = useToast((s) => s.show);
  const [fav, setFav] = useState(!!starred);
  const [busy, setBusy] = useState(false);

  // Resync with the current song: the same component is reused when switching
  // tracks (mini-player/player), so without this the heart would stay "stuck"
  // to the previous song's state.
  useEffect(() => {
    setFav(!!starred);
  }, [id, starred]);

  async function toggle(e?: GestureResponderEvent) {
    e?.stopPropagation();
    if ((!auth && !offline) || busy) return;
    haptic('medium');
    // In a song list the heart is small and sits where a finger scrolls, so
    // taking a favourite off waits behind «Undo» and nothing is asked of the
    // server until the toast goes. On the player, an artist or an album it is
    // a deliberate tap on a screen about that one thing: it goes out at once.
    if (fav && undo) {
      setFav(false);
      unstarWithUndo(type, id, () => setFav(true));
      return;
    }
    const nextFav = !fav;
    setFav(nextFav); // optimistic update
    const done = nextFav ? t('Added to favorites') : t('Removed from favorites');
    const unpinAlbum = !nextFav && type === 'album';
    setBusy(true);
    try {
      if (nextFav) await star(id, type);
      else await unstar(id, type);
      // Only the id is known here, so removing is exact and adding leaves the
      // list to refresh when something needs it (see `favoritesCache`).
      applyStarChange(type, id, nextFav);
      // Albums are only listed as favourites, so the pin would outlive the row.
      if (unpinAlbum) usePins.getState().unpin(`album:${id}`);
      toast(done);
    } catch {
      setFav(!nextFav); // revert on failure
      resyncFavorites();
      toast(t("Couldn't complete the action"));
    }
    setBusy(false);
  }

  return (
    <Pressable
      hitSlop={10}
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={fav ? t('Remove from favorites') : t('Add to favorites')}
    >
      <Icon
        name={fav ? 'heart' : 'heart-outline'}
        size={size}
        color={fav ? colors.accent : colors.textSecondary}
      />
    </Pressable>
  );
}
