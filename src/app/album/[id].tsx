/** Detalle de un álbum con sus canciones. */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { coverArtUrl, getAlbum } from '@/api/subsonic';
import { TrackListView } from '@/components/TrackListView';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors } from '@/theme';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuthStore((s) => s.auth);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const { data, isLoading } = useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(auth!, id),
    enabled: !!auth && !!id,
  });

  if (isLoading || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <TrackListView
      title={data.album.name}
      subtitle={data.album.artist}
      artistId={data.album.artistId}
      coverUri={coverArtUrl(auth!, data.album.coverArt ?? data.album.id, 500)}
      songs={data.songs}
      currentId={playing?.id}
      numbered
      onPlay={(start) => playQueue(data.songs, start)}
    />
  );
}
