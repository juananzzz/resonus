/** Pantalla de Favoritos: canciones marcadas con estrella, estilo Spotify. */
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { getStarred } from '@/api/data';
import { FavoritesArt } from '@/components/FavoritesArt';
import { Message } from '@/components/Message';
import { TrackListView } from '@/components/TrackListView';
import { useSongSort } from '@/hooks/useSongSort';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { currentSong, SOURCE_FAVORITES, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

export default function FavoritesScreen() {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });

  const { songs: displaySongs, openSort, sortSheet } = useSongSort(data?.songs ?? []);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.center}>
        <Message text={t("Couldn't load favorites.")} onRetry={() => refetch()} />
      </View>
    );
  }

  if (displaySongs.length === 0 && offline) {
    return (
      <View style={styles.center}>
        <Message text={t('Tap the heart on songs to see them here.')} />
      </View>
    );
  }

  const totalSec = displaySongs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const metaParts = [songsLabel(displaySongs.length, lang)];
  if (totalSec > 0) metaParts.push(formatTotalDuration(totalSec));

  return (
    <>
      <TrackListView
        title={t('Favorites')}
        meta={metaParts.join(' · ')}
        renderCover={(size) => <FavoritesArt size={size} />}
        accentColor={colors.accent}
        songs={displaySongs}
        currentId={playing?.id}
        showArtwork={showListArtwork}
        onSort={displaySongs.length > 1 ? openSort : undefined}
        onPlay={(start) => playQueue(displaySongs, start, SOURCE_FAVORITES, '/favorites')}
      />
      {sortSheet}
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
});
