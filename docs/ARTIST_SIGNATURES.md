# Artist signature validation

Signature providers are opt-in and user-configured. An asset must pass the
existing source, origin and public-domain-signature/CC0 checks, then be a PNG
or SVG candidate. A licence claim does not establish whose autograph it is.

Several distinct unverified assets (including missing/unknown verification) are
ambiguous even when the response or individual assets repeat the requested
MusicBrainz/Wikidata ID. Queen returned royal autographs carrying the band's
requested ID. Keep verified candidates when supplied; otherwise retain the
normal name. A single unverified candidate remains eligible for compatibility,
subject to the existing rights, source and format rules. URL query variants do
not count as different assets. This rule also reparses old offline metadata.
Provider identity/verification claims are not independent proof of authorship.

Before hiding the normal name, Expo Image decodes the candidate at a bounded
size. The local SignatureInk module inspects actual alpha pixels on that same
ImageRef. Opaque, empty, uniform translucent and animated images are rejected;
remaining candidates are tried, up to five unique URLs. No second fetch or
persistent bitmap cache is introduced. Failed references are released.

A real Daddy Yankee PNG and Queen title logo decoded successfully but their
ThumbHash alpha-variation coefficient rounded to zero. The lossy placeholder
hash is no longer an acceptance predicate. Native tests cover transparent dark
ink, fine strokes, uniform rectangles and the allocation bound. Missing native
support (Expo Go/web) retains the normal name; native errors do not persist a
negative result. This change requires rebuilding the native app.

Tint is applied during Image.loadAsync because view tint does not recolor an
already decoded ImageRef. The theme text colour preserves alpha, and the query
key includes that colour so differently tinted references are not reused.

This is a coarse display-suitability check, not semantic identity recognition.
In the reported Leona Lewis case the provider returned opaque JPEG scans of
19th-century sheet music. The public PR's stricter rights policy already
rejects that response; format and decoded-mask validation additionally protect
against opaque PNG/SVG records that otherwise satisfy that policy.

Cache schema 5 revalidates schema 3–4 entries, including offline recovery.
Positive metadata lasts seven days, misses five minutes. Network/decode errors
do not replace a previously usable result with a miss. Offline mode only
loads existing local image files. Names remain visible on rejection or error;
plain-name headers do not expose a source action. No Apple request or default
provider is introduced by this feature.

Regression tests exercise actual response parsing and the production cache
path with device/network I/O stubbed. Android native tests read real alpha
pixels, including a PD-signature fixture and generated masks. Equivalent local
code was built and visually verified on the Oppo with Queen and Daddy Yankee.
The extracted public branch has separate compile/test checks; this is not a
claim of full physical-device QA of that branch. iOS has an implementation but
has not been compiled or tested on a device.

## Optional Apple title logos

The separate Apple feature remains opt-in and off by default. When enabled,
its checked title logo takes priority before querying the signature provider,
avoiding a flash of an unrelated autograph. A missing/rejected/failed Apple logo
falls back to the configured eligible signature, then the normal artist name.
Disabling Apple logos performs no Apple logo lookup, even when signatures are
on. Provider-only code does not import or invoke the Apple lookup.

The header query includes both source switches, provider URL, artist, offline
state and tint. Offline logo metadata does not require the separate hero image
to be cached: only the logo's own bytes are checked. Every returned logo passes
the shared pixel validator. No Apple image is bundled, and the existing Apple
terms/maintainer submission hold remains in force.
