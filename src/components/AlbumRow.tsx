/**
 * Album row for lists: small cover art, name, and artist. The list-mode
 * sibling of `AlbumCard`; until now it only existed loose inside the Library.
 *
 * The pin is optional because pinning belongs to the Library: when browsing
 * there are no pinned items to show.
 */
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import Icon from '@/components/Icon';
import { COVER, type Album } from '@/api/data';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { usePressFeedback } from '@/hooks/usePressFeedback';
import { haptic } from '@/lib/haptics';
import { useMediaMenu } from '@/store/mediaMenu';
import { fontSize, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { Cover } from './Cover';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';

interface Props {
  album: Album;
  /** Marks the album as pinned, with a pin next to the artist. */
  pinned?: boolean;
}

export function AlbumRow({ album, pinned }: Props) {
  const { coverArtUrl } = useCoverUrls();
  bump('render · AlbumRow');
  const openMenu = useMediaMenu((s) => s.open);
  // Subscribed, not read straight off `colors`: without it the pin would keep
  // the previous accent while the screen stays mounted.
  const { accent } = useTheme();
  const explicit = useExplicitBadge(album.explicitStatus);
  const press = usePressFeedback();

  // The fade sits outside the Link: its child is handed to a `Slot`, which
  // refuses an array of styles, and an animated one cannot be flattened into
  // the single object it wants.
  return (
    <Animated.View style={press.style}>
      <Link href={`/album/${album.id}`} asChild>
        <Pressable
          style={styles.row}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onLongPress={() => {
            haptic('light');
            openMenu({ kind: 'album', album });
          }}
        >
          <Cover uri={coverArtUrl(album.coverArt ?? album.id, COVER.thumb)} size={56} />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {album.name}
            </Text>
            {album.artist || pinned || explicit ? (
              <View style={styles.subLine}>
                {pinned ? (
                  <Icon name="pin" size={13} color={accent} />
                ) : null}
                <ExplicitBadge status={album.explicitStatus} />
                {album.artist ? (
                  <Text style={styles.sub} numberOfLines={1}>
                    {album.artist}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </Pressable>
      </Link>
    </Animated.View>
  );
}

const styles = themed((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sub: { color: colors.textSecondary, fontSize: fontSize.xs, flexShrink: 1 },
  // The MCI pin icon is vertical; rotated 45° it looks like Spotify's.
}));
