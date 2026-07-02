/** Detalle de un álbum con sus canciones. */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { coverArtUrl, getAlbum } from '@/api/data';
import { Dialog } from '@/components/Dialog';
import { Message } from '@/components/Message';
import { MoreFromArtist } from '@/components/MoreFromArtist';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackListView } from '@/components/TrackListView';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing } from '@/theme';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showArtistPhoto = useSettings((s) => s.showArtistPhoto);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(id),
    enabled: canFetch && !!id,
  });

  const songIds = data?.songs.map((s) => s.id) ?? [];
  const download = useDownloads(useShallow((s) => groupDownloadState(s, `album:${id}`, songIds)));
  const downloadAlbum = useDownloads((s) => s.downloadAlbum);
  const deleteSongs = useDownloads((s) => s.deleteSongs);

  if (isLoading) {
    return <TrackListSkeleton />;
  }

  if (isError || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <Message text={t("Couldn't load the album.")} onRetry={() => refetch()} />
      </View>
    );
  }

  const labels = (data.album.recordLabels ?? []).map((l) => l.name).filter(Boolean);
  const labelText = labels.length
    ? `℗ ${data.album.year ? `${data.album.year} ` : ''}${labels.join(' · ')}`
    : null;

  const totalSec = data.songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const metaParts = [t('Album')];
  if (data.album.year) metaParts.push(String(data.album.year));
  metaParts.push(songsLabel(data.songs.length, lang));
  if (totalSec > 0) metaParts.push(formatTotalDuration(totalSec));

  return (
    <>
      <TrackListView
        title={data.album.name}
        subtitle={data.album.artist}
        artistId={data.album.artistId}
        artistImageUri={
          showArtistPhoto && data.album.artistId
            ? coverArtUrl(data.album.artistId, 100)
            : undefined
        }
        meta={metaParts.join(' · ')}
        coverUri={coverArtUrl(data.album.coverArt ?? data.album.id, 500)}
        songs={data.songs}
        currentId={playing?.id}
        numbered
        favorite={{ id: data.album.id, type: 'album', starred: !!data.album.starred }}
        download={
          !offline
            ? {
                ...download,
                onPress: () => {
                  if (download.status === 'none') setConfirmDownload(true);
                  else if (download.status === 'done') setConfirmDelete(true);
                },
              }
            : undefined
        }
        footer={
          data.album.artistId || labelText ? (
            <>
              {data.album.artistId ? (
                <MoreFromArtist
                  artistId={data.album.artistId}
                  artistName={data.album.artist ?? ''}
                  currentAlbumId={data.album.id}
                />
              ) : null}
              {labelText ? (
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: fontSize.xs,
                    marginTop: spacing.lg,
                  }}
                >
                  {labelText}
                </Text>
              ) : null}
            </>
          ) : undefined
        }
        onPlay={(start) => playQueue(data.songs, start, data.album.name, `/album/${id}`)}
      />
      <Dialog
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: data.album.name })}
        message={t('{songs} will be saved to this device.', {
          songs: songsLabel(data.songs.length, lang),
        })}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void downloadAlbum(data.album, data.songs);
        }}
      />
      <Dialog
        visible={confirmDelete}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: data.album.name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteSongs(songIds);
        }}
      />
    </>
  );
}
