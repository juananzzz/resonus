import { fetch } from 'expo/fetch';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { isManualOffline } from '@/api/netGate';
import { hashKey } from './localLibrary';
import { artistPageFromSearch, normalizedArtistName, parseArtistLogo } from './artistLogo';
import { appleArtistArtFromPage, appleMediaUrl, type AppleArtistArt } from './appleArtistArt';

// Included in the existing artist-signature storage accounting and cleanup.
const CACHE = `${FileSystem.documentDirectory}artist-signatures/apple/`;
const TTL = 60 * 60 * 1000; // Refresh expiring motion URLs, never cache video bytes.
const requests = new Map<string, Promise<AppleArtistArt | null>>();

function cachedArt(value: unknown): AppleArtistArt | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as AppleArtistArt;
  const heroUrl = appleMediaUrl(row.heroUrl);
  if (!heroUrl) return null;
  return { heroUrl, previewUrl: appleMediaUrl(row.previewUrl), videoUrl: appleMediaUrl(row.videoUrl, true),
    logo: parseArtistLogo(row.logo ? { url: row.logo.imageUrl, width: row.logo.aspect, height: 1 } : null) };
}

async function readSaved(name: string): Promise<{ at: number; art: AppleArtistArt | null } | undefined> {
  const key = normalizedArtistName(name);
  const file = `${CACHE}${hashKey(key)}.json`;
  try {
    const data = JSON.parse(await FileSystem.readAsStringAsync(file));
    if (data.version === 1 && data.key === key && Number.isFinite(data.at)) return { at: data.at, art: cachedArt(data.art) };
  } catch { /* First lookup or evicted cache. */ }
}

async function lookup(name: string): Promise<AppleArtistArt | null> {
  const key = normalizedArtistName(name);
  const file = `${CACHE}${hashKey(key)}.json`;
  const saved = await readSaved(name);
  if (isManualOffline()) {
    const art = saved?.art;
    if (!art) return null;
    const path = await Image.getCachePathAsync(art.heroUrl).catch(() => null);
    return path ? { ...art, heroUrl: `file://${path.replace(/^file:\/\//, '')}`, previewUrl: undefined, videoUrl: undefined } : null;
  }
  if (saved && Date.now() - saved.at < (saved.art ? TTL : 5 * 60 * 1000)) return saved.art;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const search = new URL('https://itunes.apple.com/search');
    search.searchParams.set('term', name);
    search.searchParams.set('entity', 'musicArtist');
    search.searchParams.set('limit', '5');
    const found = await fetch(search.href, { signal: controller.signal });
    if (!found.ok) throw new Error('Apple artist search unavailable');
    const text = await found.text();
    if (text.length > 512_000) throw new Error('Apple artist response too large');
    const page = artistPageFromSearch(JSON.parse(text), name);
    let art: AppleArtistArt | null = null;
    if (page) {
      const response = await fetch(page, { signal: controller.signal });
      if (!response.ok) throw new Error('Apple artist page unavailable');
      art = appleArtistArtFromPage(await response.text());
    }
    // Provider changes and outages must not discard previously usable still art.
    if (!art && saved?.art) return { ...saved.art, videoUrl: undefined };
    try {
      await FileSystem.makeDirectoryAsync(CACHE, { intermediates: true });
      await FileSystem.writeAsStringAsync(file, JSON.stringify({ version: 1, key, at: Date.now(), art }));
    } catch { /* Optional metadata cache. */ }
    return art;
  } catch {
    return saved?.art ? { ...saved.art, videoUrl: undefined } : null;
  } finally { clearTimeout(timer); }
}

/** Shared by signatures and artist pages: public name only, no library writes. */
export function getAppleArtistArt(name: string): Promise<AppleArtistArt | null> {
  if (!name.trim() || name.length > 300) return Promise.resolve(null);
  const key = `${isManualOffline()}:${normalizedArtistName(name)}`;
  let task = requests.get(key);
  if (!task) {
    task = lookup(name).finally(() => requests.delete(key));
    requests.set(key, task);
  }
  return task;
}

/** A cached logo does not require the separate artist hero image to be cached.
 * The signature loader checks the logo's own local image before offline use.
 */
export async function getAppleArtistLogo(name: string) {
  if (!name.trim() || name.length > 300) return null;
  const art = isManualOffline() ? (await readSaved(name))?.art : await getAppleArtistArt(name);
  return art?.logo ?? null;
}
