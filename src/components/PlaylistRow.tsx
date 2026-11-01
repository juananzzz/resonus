/**
 * Playlist row for lists: small cover, name, and one line under it, already
 * worded by the caller. The list-mode sibling of the Library's grid card.
 */
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import Icon from '@/components/Icon';
import { COVER, coverArtUrl, type Playlist } from '@/api/data';
import { usePressFeedback } from '@/hooks/usePressFeedback';
import { haptic } from '@/lib/haptics';
import { bump } from '@/lib/perfLog';
import { useMediaMenu } from '@/store/mediaMenu';
import { DIM_OPACITY, fontSize, spacing, themed, useTheme } from '@/theme';
import { Cover } from './Cover';

interface Props {
  playlist: Playlist;
  sub: string;
  pinned?: boolean;
  /** Offline with nothing to play. */
  dimmed?: boolean;
}

export function PlaylistRow({ playlist, sub, pinned, dimmed }: Props) {
  bump('render · PlaylistRow');
  const openMenu = useMediaMenu((s) => s.open);
  const { accent } = useTheme();
  const press = usePressFeedback();
  return (
    <Animated.View style={press.style}>
      <Link href={`/playlist/${playlist.id}`} asChild>
        <Pressable
          style={StyleSheet.flatten([styles.row, dimmed && styles.dimmed])}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onLongPress={() => {
            haptic('light');
            openMenu({ kind: 'playlist', playlist });
          }}
        >
          <Cover uri={coverArtUrl(playlist.coverArt ?? playlist.id, COVER.thumb)} size={56} />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {playlist.name}
            </Text>
            <View style={styles.subLine}>
              {pinned ? <Icon name="pin" size={13} color={accent} /> : null}
              <Text style={styles.sub} numberOfLines={1}>
                {sub}
              </Text>
            </View>
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
  dimmed: { opacity: DIM_OPACITY },
}));
