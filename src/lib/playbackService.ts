/**
 * Servicio de reproducción de react-native-track-player. Conecta los botones
 * de la notificación / pantalla de bloqueo (mandos remotos) con el reproductor.
 */
import TrackPlayer, { Event } from 'react-native-track-player';

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () =>
    TrackPlayer.skipToPrevious(),
  );
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) =>
    TrackPlayer.seekTo(e.position),
  );
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.reset());
}
