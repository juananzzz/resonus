/**
 * Reescribe los deep links del sistema antes de que expo-router los resuelva.
 *
 * react-native-track-player abre la app, al pulsar la notificación, con el
 * enlace `trackplayer://notification.click` (y `trackplayer://service-bound`
 * al enlazar el servicio). Esas rutas no existen y mostrarían "Unmatched
 * Route", así que la pulsación de la notificación la mandamos al reproductor.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('notification.click')) return '/player';
    // Otros intents internos de RNTP: a la pantalla principal en vez de fallar.
    if (path.includes('trackplayer://')) return '/';
    return path;
  } catch {
    return '/';
  }
}
