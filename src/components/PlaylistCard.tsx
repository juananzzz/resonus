/** Playlist card for the carousels on Home (the «Playlists» row) and for the
 *  Library's playlists in a grid. */
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { COVER, coverArtUrl, type Playlist } from '@/api/data';
import { songsLabel } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useMediaMenu } from '@/store/mediaMenu';
import { useSettings } from '@/store/settings';
import { fontSize, lineHeight, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { Cover } from './Cover';

interface Props {
  playlist: Playlist;
  width?: number;
  /**
   * The two marks the Library draws: a ↓ on a playlist every song of which is
   *  on the phone, and the pin it was kept under. They are optional because
   *  keeping and pinning are yours, and Home and search show the server's
   *  catalogue, where neither is said.
   */
  downloaded?: boolean;
  pinned?: boolean;
}

export const PlaylistCard = memo(function PlaylistCard({
  playlist,
  width = 150,
  downloaded,
  pinned,
}: Props) {
  bump('render · PlaylistCard');
  // Subscribed, and the accent read off it: the marks are the accent's, and
  //  the card is memoised, so it has to ask for a repaint on a change of
  //  appearance or accent itself.
  const { accent } = useTheme();
  const lang = useSettings((s) => s.language);
  const openMenu = useMediaMenu((s) => s.open);
  const cover = coverArtUrl(playlist.coverArt ?? playlist.id, COVER.card);

  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      {/* expo-router merges the Link style into this child; it must be a
          single object, not an array, so we flatten it. */}
      <Pressable
        style={StyleSheet.flatten([styles.container, { width }])}
        onLongPress={() => {
          haptic('light');
          openMenu({ kind: 'playlist', playlist });
        }}
      >
        <Cover uri={cover} size={width} />
        <Text style={styles.title} numberOfLines={1}>
          {playlist.name}
        </Text>
        {playlist.songCount !== undefined || downloaded || pinned ? (
          <View style={styles.subRow}>
            {downloaded ? <Icon name="arrow-down-circle" size={12} color={accent} /> : null}
            {pinned ? <Icon name="pin" size={12} color={accent} /> : null}
            {playlist.songCount !== undefined ? (
              <Text style={styles.sub} numberOfLines={1}>
                {songsLabel(playlist.songCount, lang)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
});

const styles = themed((colors) => ({
  container: { gap: spacing.xs },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  // The marks and the count share this line, the way an album card's do, so a
  //  card with only the count still reads the same as it did on Home.
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    // Gives way to the marks rather than pushing them off the card's edge.
    flexShrink: 1,
  },
}));
