/**
 * Artist tags that credit more than one artist (#332).
 *
 * Some files carry a collaboration as one string, "Artist1, Artist2", because
 * that is what the encoder wrote into the single artist frame. Treating the
 * whole string as one name makes an artist whose name has a comma in it and
 * hides the song from both artist screens. The local scan splits it once, when
 * the tag is read, and the rest of the app gets the same `artists` list a
 * server already sends through OpenSubsonic.
 */

/** The names in an artist tag, trimmed, in order, without duplicates. */
export function splitArtistNames(value?: string): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of value.split(',')) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** The same names as navigable references, with the caller's own id rule. */
export function artistRefs(
  value: string | undefined,
  idOf: (name: string) => string,
): { id: string; name: string }[] {
  return splitArtistNames(value).map((name) => ({ id: idOf(name), name }));
}
