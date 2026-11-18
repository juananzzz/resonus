/**
 * How a memory cache is kept from growing.
 *
 * A cache that only ever gains holds every key the app ever showed: the cover
 *   memo holds each address again together with the `file://` path it answered
 *   with, and the colour cache holds one entry per address × appearance × band.
 *   A browsed library hands a new address to every row, so both end up sized
 *   like the library, and an entry nobody reaches again is not worth what it
 *   costs.
 *
 * This is the policy the app already owns inline at
 *   `hooks/useArtworkEdgeColor.ts:57`, where its own samples were capped at 64
 *   — one screen's worth, which is all that cache can want at a time. A cache
 *   keyed by cover address cannot be sized like that: past a ceiling the entry
 *   that came first leaves, so the map holds what a browse touches and stops,
 *   and an address that left is asked again — one call into the image loader,
 *   which answers from its own cache. The map's insertion order is what decides,
 *   never the entry a reader is looking at, and a key written again stays where
 *   it was, so re-reading an address does not keep it alive.
 */
export function cacheWrite<V>(
  cache: Map<string, V>,
  key: string,
  value: V,
  ceiling: number,
): void {
  cache.set(key, value);
  // One write at a time, so at most one entry can be over the ceiling.
  if (cache.size > ceiling) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
}
