/**
 * Hands a Resonus link (#176) to the system share sheet, which is also where
 * copying it lives: Android and iOS both offer Copy on shared text.
 */
import { Share } from 'react-native';

import { tg } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { buildResonusLink, linkHost, type LinkKind } from './resonusLink';

/**
 * Only a signed-in server profile has a server to point at, and only online:
 * offline an artist can be one the downloads keyed by name, which no server
 * knows.
 */
export function canShareResonusLink(): boolean {
  const { auth, offline } = useAuthStore.getState();
  return !!auth && !offline;
}

export async function shareResonusLink(item: {
  kind: LinkKind;
  id: string;
  name: string;
  artist?: string;
}): Promise<boolean> {
  const auth = useAuthStore.getState().auth;
  const server = auth ? linkHost(auth) : null;
  if (!server) return false;
  const line = item.artist
    ? tg('Check out {name} by {artist} on {server}', {
        name: item.name,
        artist: item.artist,
        server,
      })
    : tg('Check out {name} on {server}', { name: item.name, server });
  try {
    await Share.share({ message: `${line}\n${buildResonusLink(item.kind, item.id, server)}` });
  } catch {
    // Dismissed, or the sheet failed to open: nothing to undo.
  }
  return true;
}
