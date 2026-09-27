/**
 * Links to an album, an artist or a playlist on a server, for another Resonus
 * user with an account on that same server (#176).
 *
 * Not the public links of `share.ts`: those are minted by the server for anyone
 * with a browser. These only carry an id and the server's host, and the app on
 * the other end looks for a profile of its own on that host. A custom scheme
 * and not an https link because an App Link needs control of the domain, and
 * the domain is each person's own server.
 */
import type { SubsonicAuth } from '@/api/subsonic';
import { isLanUrl, primaryUrl } from './serverUrls';

export type LinkKind = 'album' | 'artist' | 'playlist';

export interface ResonusLink {
  kind: LinkKind;
  id: string;
  /** Host of the server, lower case, without port. */
  server: string;
}

const KINDS: LinkKind[] = ['album', 'artist', 'playlist'];

export function hostOf(url: string): string | null {
  const m = url.trim().match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Every URL a profile answers on. */
function urlsOf(auth: Pick<SubsonicAuth, 'urls' | 'serverUrl'>): string[] {
  return auth.urls && auth.urls.length > 0 ? auth.urls : [auth.serverUrl];
}

/**
 * The host that goes in a link. A LAN address means nothing to somebody on
 * another network, so the first address that is not one wins; a profile with
 * only LAN addresses still gets one, which works for whoever shares that LAN.
 */
export function linkHost(auth: SubsonicAuth): string | null {
  const reachable = urlsOf(auth).find((u) => !isLanUrl(u));
  return hostOf(reachable ?? primaryUrl(auth));
}

export function buildResonusLink(kind: LinkKind, id: string, server: string): string {
  return `resonus://${kind}/${encodeURIComponent(id)}?server=${encodeURIComponent(server)}`;
}

/**
 * Reads a link out of whatever it arrived as: the path the system hands the
 * router, or text pasted from a message with more words around it.
 */
export function parseResonusLink(text: string): ResonusLink | null {
  const m = text.match(
    /(?:resonus:\/\/\/?|^\/?)(album|artist|playlist)\/([^?#\s/]+)\?([^#\s]*)/i,
  );
  if (!m) return null;
  const kind = m[1].toLowerCase() as LinkKind;
  if (!KINDS.includes(kind)) return null;
  let id: string;
  let server: string | null = null;
  try {
    id = decodeURIComponent(m[2]);
    for (const pair of m[3].split('&')) {
      const [key, value = ''] = pair.split('=');
      if (key === 'server') server = decodeURIComponent(value).trim().toLowerCase();
    }
  } catch {
    return null;
  }
  if (!id || !server) return null;
  return { kind, id, server };
}

/** Does this profile answer on that host, under any of its addresses? */
export function profileOnHost(
  auth: Pick<SubsonicAuth, 'urls' | 'serverUrl'>,
  server: string,
): boolean {
  return urlsOf(auth).some((u) => hostOf(u) === server);
}

/** The route inside the app for what a link points at. */
export function linkRoute(link: Pick<ResonusLink, 'kind' | 'id'>): string {
  return `/${link.kind}/${encodeURIComponent(link.id)}`;
}

/** The screen that finds the profile for a link before opening it. */
export function openRoute(link: ResonusLink): string {
  const q = [
    `kind=${link.kind}`,
    `id=${encodeURIComponent(link.id)}`,
    `server=${encodeURIComponent(link.server)}`,
  ];
  return `/open?${q.join('&')}`;
}
