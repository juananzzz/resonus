/** Pantalla de Favoritos: canciones marcadas con estrella, estilo Spotify. */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { getStarred } from '@/api/data';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { TrackListView } from '@/components/TrackListView';
import { useSongSort } from '@/hooks/useSongSort';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { currentSong, SOURCE_FAVORITES, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

// Cabecera índigo → negro (estilo "Canciones que te gustan" de Spotify): el
// índigo del arte de Favoritos (#450af5, ver FavoritesArt) oscurecido para que
// el texto blanco se lea y el degradado funda limpio con el fondo, igual que
// los tonos oscuros que useDominantColor elige en álbumes y playlists.
const HEADER_COLOR = '#290693';

export default function FavoritesScreen() {
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmRemoveDl, setConfirmRemoveDl] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['starred'],
    queryFn: () => getStarred(),
    enabled: canFetch,
  });

  const songIds = (data?.songs ?? []).map((s) => s.id);
  const download = useDownloads(useShallow((s) => groupDownloadState(s, 'favorites', songIds)));
  const downloadFavorites = useDownloads((s) => s.downloadFavorites);
  const deleteSongs = useDownloads((s) => s.deleteSongs);

  const { songs: displaySongs, openSort, sortSheet } = useSongSort(data?.songs ?? [], 'favorites');

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
        <EmptyState
          icon="heart-outline"
          title={t('No favorites yet')}
          subtitle={t('Tap the heart on songs to see them here.')}
        />
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
        hideCover
        accentColor={HEADER_COLOR}
        songs={displaySongs}
        currentId={playing?.id}
        showArtwork={showListArtwork}
        onSort={displaySongs.length > 1 ? openSort : undefined}
        download={
          !offline && displaySongs.length > 0
            ? {
                ...download,
                onPress: () => {
                  if (download.status === 'none') setConfirmDownload(true);
                  else if (download.status === 'done') setConfirmRemoveDl(true);
                },
              }
            : undefined
        }
        onPlay={(start) => playQueue(displaySongs, start, SOURCE_FAVORITES, '/favorites')}
      />
      {sortSheet}

      <Dialog
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: t('Favorites') })}
        message={t('{songs} will be saved to this device.', {
          songs: songsLabel(displaySongs.length, lang),
        })}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void downloadFavorites(displaySongs);
        }}
      />

      <Dialog
        visible={confirmRemoveDl}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: t('Favorites') })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmRemoveDl(false)}
        onConfirm={() => {
          setConfirmRemoveDl(false);
          void deleteSongs(songIds);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
});
