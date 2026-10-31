/** Parse public identity records without trusting URLs supplied by a provider. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function validArtistMbid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function wikidataIdFromMusicBrainz(body: unknown, mbid: string): string | undefined {
  const root = object(body);
  if (!validArtistMbid(mbid) || root.id !== mbid || !Array.isArray(root.relations)) return;
  const ids = new Set<string>();
  for (const relation of root.relations) {
    const row = object(relation);
    if (row.type !== 'wikidata') continue;
    try {
      const url = new URL(String(object(row.url).resource));
      if (url.protocol !== 'https:' || url.hostname !== 'www.wikidata.org' || url.search || url.hash || url.username || url.password || url.port) continue;
      const match = /^\/wiki\/(Q[1-9]\d*)$/.exec(url.pathname);
      if (match) ids.add(match[1]);
    } catch { /* Ignore invalid relations. */ }
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}

export function wikidataSignatureFiles(body: unknown, id: string, mbid: string): string[] {
  if (!/^Q[1-9]\d*$/.test(id) || !validArtistMbid(mbid)) return [];
  const entity = object(object(object(body).entities)[id]);
  if (entity.id !== id) return [];
  const claims = object(entity.claims);
  const values = (property: string): string[] => Array.isArray(claims[property])
    ? (claims[property] as unknown[]).filter((row) => object(row).rank !== 'deprecated').map((row) => object(object(object(row).mainsnak).datavalue).value).filter((value): value is string => typeof value === 'string') : [];
  // Require a reciprocal match; the requested ID in a response is not proof.
  if (!values('P434').some((value) => value.toLowerCase() === mbid.toLowerCase())) return [];
  return values('P109').slice(0, 10);
}

export function commonsFileFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org' || url.port || url.username || url.password) return;
    const match = /^\/wikipedia\/commons\/[0-9a-f]\/([0-9a-f]{2})\/([^/]+)$/i.exec(url.pathname);
    if (!match) return;
    return decodeURIComponent(match[2]).replace(/_/g, ' ').normalize('NFC');
  } catch { return; }
}

/** Accept a Commons licence only for the exact file and an explicit PD-signature template. */
export function commonsHasPublicDomainSignature(body: unknown, file: string): boolean {
  const root = object(body);
  if (root.continue) return false;
  const pages = Object.values(object(object(root.query).pages));
  if (pages.length !== 1) return false;
  const page = object(pages[0]);
  const normalized = (value: string) => value.replace(/_/g, ' ').normalize('NFC');
  if (page.missing !== undefined || typeof page.title !== 'string'
    || normalized(page.title) !== `File:${normalized(file)}` || !Array.isArray(page.templates)) return false;
  return page.templates.some((template) => object(template).title === 'Template:PD-signature');
}
