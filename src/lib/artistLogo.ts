// SPDX-License-Identifier: GPL-3.0-only
// Artist header lookup adapted from BitChord; see THIRD_PARTY_NOTICES.md.
import type { ArtistSignature } from './artistSignatures';

export function normalizedArtistName(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

/** Same artist logo source used by BitChord; this is a title logo, not an autograph. */
export function parseArtistLogo(value: unknown): ArtistSignature | null {
  if (!value || typeof value !== 'object') return null;
  const logo = value as Record<string, unknown>;
  const width = Number(logo.width), height = Number(logo.height);
  if (typeof logo.url !== 'string' || logo.url.length > 2048 || !Number.isFinite(width / height) || width <= 0 || height <= 0) return null;
  try {
    const imageUrl = logo.url.replace('{w}', '1000').replace('{h}', String(Math.round(1000 * height / width)))
      .replace('{c}', 'bb').replace('{f}', 'png');
    const url = new URL(imageUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname.endsWith('.mzstatic.com')) return null;
    return { imageUrl: url.href, aspect: Math.min(12, Math.max(0.5, width / height)), attribution: 'Artist title logo · Apple Music' };
  } catch { return null; }
}

/** Traverse only Apple's serialized JSON, never evaluate page scripts. */
export function artistLogoFromPage(html: string): ArtistSignature | null {
  if (html.length > 5_000_000) return null;
  const script = html.match(/<script[^>]*id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/);
  if (!script) return null;
  try {
    const pending: unknown[] = [JSON.parse(script[1])];
    for (let visited = 0; pending.length && visited < 50_000; visited++) {
      const value = pending.pop();
      if (!value || typeof value !== 'object') continue;
      const row = value as Record<string, unknown>;
      const artistLogo = row.artistLogo as { dictionary?: unknown } | undefined;
      const parsed = parseArtistLogo(artistLogo?.dictionary);
      if (parsed) return parsed;
      pending.push(...Object.values(value));
    }
  } catch { /* No logo is the normal name fallback. */ }
  return null;
}

/** Exact artist-name match before visiting a page; never select the first search hit. */
export function artistPageFromSearch(value: unknown, name: string): string | undefined {
  const rows = (value as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(rows)) return;
  for (const item of rows.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.artistName !== 'string' || normalizedArtistName(row.artistName) !== normalizedArtistName(name)) continue;
    try {
      const url = new URL(String(row.artistLinkUrl));
      if (url.protocol === 'https:' && url.hostname === 'music.apple.com' && /^\/[a-z]{2}\/artist\//.test(url.pathname)) {
        url.search = ''; return url.href;
      }
    } catch { /* Ignore an unusable match. */ }
  }
}
