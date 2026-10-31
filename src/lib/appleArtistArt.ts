// SPDX-License-Identifier: GPL-3.0-only
// Artist header lookup adapted from BitChord; see THIRD_PARTY_NOTICES.md.
import { artistLogoFromPage } from './artistLogo';
import type { ArtistSignature } from './artistSignatures';

export type AppleArtistArt = {
  heroUrl: string;
  previewUrl?: string;
  videoUrl?: string;
  logo: ArtistSignature | null;
};

/** Apple's CDN only; metadata is untrusted even when read from a cached page. */
export function appleMediaUrl(value: unknown, video = false): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    const cdn = url.hostname.endsWith('.mzstatic.com');
    if (!(cdn || (video && url.hostname.endsWith('.itunes.apple.com')))) return;
    if (video && !url.pathname.endsWith('.m3u8')) return;
    return url.href;
  } catch { return; }
}

function image(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return;
  const row = value as Record<string, unknown>;
  const width = Number(row.width), height = Number(row.height);
  if (typeof row.url !== 'string' || width <= 0 || height <= 0 || !Number.isFinite(width / height)) return;
  return appleMediaUrl(row.url.replace('{w}', '1200').replace('{h}', String(Math.max(1, Math.round(1200 * height / width))))
    .replace('{c}', 'bb').replace('{f}', 'jpg'));
}

/** Same header dictionaries as BitChord, read as JSON without executing scripts. */
export function appleArtistArtFromPage(html: string): AppleArtistArt | null {
  if (html.length > 5_000_000) return null;
  const script = html.match(/<script[^>]*id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/);
  if (!script) return null;
  try {
    const pending: unknown[] = [JSON.parse(script[1])];
    for (let count = 0; pending.length && count < 50_000; count++) {
      const value = pending.pop();
      if (!value || typeof value !== 'object') continue;
      const row = value as {
        artistLogo?: unknown;
        artwork?: { dictionary?: unknown };
        colorBackdropArtwork?: { dictionary?: unknown };
        videoArtwork?: { dictionary?: { motionArtistSquare1x1?: { previewFrame?: unknown; video?: unknown } } };
      };
      // A null artistLogo still identifies the artist header; most artists have no logo.
      if ('artistLogo' in row) {
        const heroUrl = image(row.artwork?.dictionary) ?? image(row.colorBackdropArtwork?.dictionary);
        if (heroUrl) {
          const motion = row.videoArtwork?.dictionary?.motionArtistSquare1x1;
          return { heroUrl, logo: artistLogoFromPage(html),
            previewUrl: image(motion?.previewFrame), videoUrl: appleMediaUrl(motion?.video, true) };
        }
      }
      pending.push(...Object.values(value));
    }
  } catch { /* Missing or changed Apple metadata uses the server artwork. */ }
  return null;
}
