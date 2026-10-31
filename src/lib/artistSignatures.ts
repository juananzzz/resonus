import { commonsFileFromUrl } from './signatureIdentity';

/** Public artist-signature v1 contract; no music-server metadata is written. */
export const SIGNATURE_API = ''; // The listener supplies a provider; no public instance is opted in.

export interface ArtistSignature {
  imageUrl: string;
  aspect: number;
  attribution: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** The provider currently serves its own assets and Wikimedia originals. */
function assetUrl(value: unknown, api: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    if (!['https://upload.wikimedia.org', ...(api ? [new URL(api).origin] : [])].includes(url.origin)) return;
    return url.href;
  } catch { return; }
}

function signatureAssetUrl(signature: Record<string, unknown>, api: string): string | undefined {
  return [record(signature.asset).url, signature.asset, signature.url, signature.original_url, record(signature.source).original_url]
    .map((value) => assetUrl(value, api)).find(Boolean);
}

export function artistSignatureCandidates(value: unknown, api = SIGNATURE_API, identityFiles: string[] = [], licensedFiles: string[] = []): ArtistSignature[] {
  const root = record(value);
  // Ambiguous matches must never substitute somebody else's autograph.
  if (!Array.isArray(root.signatures)) return [];
  const entries = root.signatures.slice(0, 100).map(record);
  const verified = (entry: Record<string, unknown>) => ['verified', 'artist_verified'].includes(String(entry.verification));
  // Even a correct requested MusicBrainz ID can accompany unrelated assets
  // (Queen returned royal autographs). It does not verify those signatures.
  // Missing/unknown verification is unverified too; rank only after identity.
  const unverifiedAssets = new Set(entries.filter((entry) => !verified(entry))
    .map((entry) => signatureAssetUrl(entry, api))
    .filter((url): url is string => !!url).map((url) => new URL(url).origin + new URL(url).pathname));
  const verifiedOnly = unverifiedAssets.size > 1 || entries.some(verified);
  const candidates: { signature: ArtistSignature; score: number; area: number }[] = [];
  for (const signature of entries) {
    const url = signatureAssetUrl(signature, api);
    const file = url && commonsFileFromUrl(url);
    const normalized = (name: string) => name.replace(/_/g, ' ').normalize('NFC');
    const identityVerified = !!file && identityFiles.some((name) => normalized(name) === file);
    if (verifiedOnly && !verified(signature) && !identityVerified) continue;
    const asset = record(signature.asset);
    const imageUrl = signatureAssetUrl(signature, api);
    if (!imageUrl) continue;
    // A license does not establish identity. Full-page JPEG scans cannot be
    // transparent title masks, even when the provider labels them signatures.
    const extension = new URL(imageUrl).pathname.split('.').pop()?.toLowerCase();
    const format = typeof asset.format === 'string' ? asset.format.toLowerCase() : undefined;
    if (['jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension ?? '')
      || (format && !['png', 'svg'].includes(format))
      || (!['png', 'svg'].includes(extension ?? '') && !['png', 'svg'].includes(format ?? ''))) continue;
    const license = record(signature.license);
    const source = record(signature.source);
    // Extend only with an explicit attribution policy for each additional licence.
    const providerLicense = license.status === 'known' && typeof license.name === 'string'
      && /^(PD-signature|CC0(?: 1\.0)?)$/i.test(license.name);
    const commonsLicense = identityVerified && !!file && licensedFiles.some((name) => normalized(name) === file);
    if (!providerLicense && !commonsLicense) continue;
    if (typeof source.url !== 'string' || !source.url.startsWith('https://')) continue;
    const width = Number(asset.width ?? signature.width);
    const height = Number(asset.height ?? signature.height);
    const aspect = width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 2.5;
    const svg = asset.format === 'svg' || new URL(imageUrl).pathname.endsWith('.svg');
    const score = (license.status === 'known' ? 100 : 0) + (svg ? 10 : 0)
      + (signature.verification === 'artist_verified' ? 3 : signature.verification === 'verified' ? 2 : 0)
      + (aspect >= 1.4 ? 1 : 0);
    const area = Number.isFinite(width * height) && width > 0 && height > 0 ? width * height : 0;
    const attribution = [source.url, commonsLicense ? 'PD-signature (Wikimedia Commons)' : license.name, license.url]
      .filter((part): part is string => typeof part === 'string').join('\n').slice(0, 4096);
    candidates.push({ signature: { imageUrl, aspect: Math.min(12, Math.max(0.5, aspect)), attribution }, score, area });
  }
  return candidates.sort((a, b) => b.score - a.score || b.area - a.area).map((row) => row.signature);
}

export function parseArtistSignature(value: unknown, api = SIGNATURE_API): ArtistSignature | null {
  return artistSignatureCandidates(value, api)[0] ?? null;
}
