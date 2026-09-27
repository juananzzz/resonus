/**
 * Rewrites the system's deep links before expo-router gets to resolve them.
 *
 * react-native-track-player opens the app, on notification tap, with the link
 * `trackplayer://notification.click` (and `trackplayer://service-bound` when
 * binding the service). Those routes don't exist and would show "Unmatched
 * Route", so the notification tap is routed to the player.
 *
 * A Resonus link (`resonus://album/<id>?server=<host>`, #176) goes through
 * `/open` first, which finds the profile on that server before opening it, and
 * a launcher shortcut (`resonus://shortcut/<action>`) through `/shortcut`.
 */
import { openRoute, parseResonusLink } from '@/lib/resonusLink';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('notification.click')) return '/player';
    // Other internal RNTP intents: to the main screen instead of failing.
    if (path.includes('trackplayer://')) return '/';
    // A launcher shortcut (see `lib/homeWidget`).
    const shortcut = path.match(/shortcut\/([a-z-]+)/);
    if (shortcut) return `/shortcut?action=${shortcut[1]}`;
    const link = parseResonusLink(path);
    if (link) return openRoute(link);
    return path;
  } catch {
    return '/';
  }
}
