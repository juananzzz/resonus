// Punto de entrada: registra el servicio de reproducción de
// react-native-track-player ANTES de arrancar la app (expo-router).
import TrackPlayer from 'react-native-track-player';

import { PlaybackService } from './src/lib/playbackService';

TrackPlayer.registerPlaybackService(() => PlaybackService);

// require (no import) para que la app arranque tras registrar el servicio.
require('expo-router/entry');
