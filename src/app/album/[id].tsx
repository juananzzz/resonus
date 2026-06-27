/** Detalle de un álbum con sus canciones. */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { coverArtUrl, getAlbum } from '@/api/data';
import { Message } from '@/components/Message';
import { TrackListView } from '@/components/TrackListView';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(id),
    enabled: canFetch && !!id,
  });

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <Message text={t("Couldn't load the album.")} onRetry={() => refetch()} />
      </View>
    );
  }

  const totalSec = data.songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const metaParts = [t('Album')];
  if (data.album.year) metaParts.push(String(data.album.year));
  metaParts.push(songsLabel(data.songs.length, lang));
  if (totalSec > 0) metaParts.push(formatTotalDuration(totalSec));

  return (
    <TrackListView
      title={data.album.name}
      subtitle={data.album.artist}
      artistId={data.album.artistId}
      meta={metaParts.join(' · ')}
      coverUri={coverArtUrl(data.album.coverArt ?? data.album.id, 500)}
      songs={data.songs}
      currentId={playing?.id}
      numbered
      favorite={{ id: data.album.id, type: 'album', starred: !!data.album.starred }}
      onPlay={(start) => playQueue(data.songs, start, data.album.name, `/album/${id}`)}
    />
  );
}
