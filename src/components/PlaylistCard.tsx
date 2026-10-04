/** Playlist card for the carousels on Home (the «Playlists» row). */
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { COVER, type Playlist } from '@/api/data';
import { songsLabel } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useMediaMenu } from '@/store/mediaMenu';
import { useSettings } from '@/store/settings';
import { fontSize, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { Cover } from './Cover';

interface Props {
  playlist: Playlist;
  width?: number;
}

export const PlaylistCard = memo(function PlaylistCard({ playlist, width = 150 }: Props) {
  const { coverArtUrl } = useCoverUrls();
  bump('render · PlaylistCard');
  // Memoised, so it has to ask for a repaint on a theme change itself.
  useTheme();
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
        {playlist.songCount !== undefined ? (
          <Text style={styles.sub} numberOfLines={1}>
            {songsLabel(playlist.songCount, lang)}
          </Text>
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
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
}));
