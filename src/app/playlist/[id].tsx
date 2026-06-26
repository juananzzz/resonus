/** Detalle de una lista de reproducción con sus canciones. */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { coverArtUrl, getPlaylist } from '@/api/subsonic';
import { Message } from '@/components/Message';
import { TrackListView } from '@/components/TrackListView';
import { songsLabel, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => getPlaylist(auth!, id),
    enabled: !!auth && !!id,
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
        <Message text={t('No se pudo cargar la lista.')} onRetry={() => refetch()} />
      </View>
    );
  }

  return (
    <TrackListView
      title={data.playlist.name}
      subtitle={songsLabel(data.songs.length, lang)}
      coverUri={coverArtUrl(auth!, data.playlist.coverArt ?? data.playlist.id, 500)}
      songs={data.songs}
      currentId={playing?.id}
      onPlay={(start) => playQueue(data.songs, start)}
    />
  );
}
