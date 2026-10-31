import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { artistSignatureCandidates, parseArtistSignature } from '@/lib/artistSignatures';

const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/signature.svg';
const source = { url: 'https://commons.wikimedia.org/wiki/File:Signature.svg' };
const license = { status: 'known', name: 'PD-signature', url: 'https://commons.wikimedia.org/wiki/Template:PD-signature' };
const response = (item: object = {}) => ({ signatures: [{ asset: { url: imageUrl, width: 1000, height: 300 }, source, license, ...item }] });

describe('artist signature provider boundary', () => {
  it('accepts a documented public-domain asset and preserves source and licence', () => {
    const parsed = parseArtistSignature(response());
    assert.equal(parsed?.imageUrl, imageUrl);
    assert.equal(parsed?.aspect, 1000 / 300);
    assert.ok(parsed?.attribution.includes(source.url));
    assert.ok(parsed?.attribution.includes(license.url));
  });
  it('accepts known CC0 assets', () => {
    assert.ok(parseArtistSignature(response({ license: { status: 'known', name: 'CC0 1.0' } })));
  });
  it('rejects unknown rights and licences without an implemented credit policy', () => {
    for (const value of [null, {}, { status: 'unknown', name: 'PD-signature' }, { status: 'known', name: 'CC BY-SA 4.0' }]) {
      assert.equal(parseArtistSignature(response({ license: value })), null);
    }
  });
  it('requires a source record', () => {
    assert.equal(parseArtistSignature(response({ source: null })), null);
  });
  it('accepts the configured provider but rejects unrelated image hosts', () => {
    const payload = response({ asset: 'https://custom.example/signature.svg' });
    assert.equal(parseArtistSignature(payload), null);
    assert.ok(parseArtistSignature(payload, 'https://custom.example'));
  });
  it('rejects executable, insecure and credentialed asset URLs', () => {
    for (const asset of ['javascript:alert(1)', 'http://upload.wikimedia.org/a.svg', 'https://user:pass@upload.wikimedia.org/a.svg']) {
      assert.equal(parseArtistSignature(response({ asset })), null);
    }
  });
  it('does not guess missing or ambiguous artist responses', () => {
    for (const value of [null, {}, { matches: [{ name: 'Other artist' }] }, { signatures: [] }]) {
      assert.equal(parseArtistSignature(value), null);
    }
  });
  it('bounds extreme artwork proportions', () => {
    assert.equal(parseArtistSignature(response({ asset: { url: imageUrl, width: 1e30, height: 1 } }))?.aspect, 12);
  });
});

describe('ambiguous unverified provider matches', () => {
  const emilia = JSON.parse(readFileSync(new URL('./fixtures/signatures/emilia-provider.json', import.meta.url), 'utf8'));
  it('rejects the real Emilia response instead of ranking other people by licence and size', () => {
    assert.deepEqual(artistSignatureCandidates(emilia), []);
  });
  it('still accepts a verified eligible candidate from an otherwise ambiguous response', () => {
    const verified = { asset: imageUrl, source, license, verification: 'artist_verified' };
    assert.deepEqual(artistSignatureCandidates({ ...emilia, signatures: [...emilia.signatures, verified] }).map(s => s.imageUrl), [imageUrl]);
  });
  it('does not treat repeated versions of the same asset URL as different people', () => {
    assert.equal(artistSignatureCandidates({ signatures: [
      { asset: imageUrl + '?a=1', source, license, verification: 'unverified' },
      { asset: imageUrl + '?a=2', source, license, verification: 'unverified' },
    ] }).length, 2);
  });
  it('does not treat the requested artist IDs as verification of individual signatures', () => {
    for (const artist of [{ musicbrainz_id: '8d552dfc-648f-401f-90de-e925013ca537' }, { wikidata_id: 'Q123' }]) {
      assert.deepEqual(artistSignatureCandidates({ artist, signatures: emilia.signatures }), []);
    }
  });
  it('rejects unrelated Queen autographs with copied per-asset MusicBrainz IDs', () => {
    const queen = JSON.parse(readFileSync(new URL('./fixtures/signatures/queen-provider.json', import.meta.url), 'utf8'));
    // Use otherwise eligible rights so the identity guard itself must reject them.
    const signatures = queen.signatures.map((row: object) => ({ ...row, source, license }));
    assert.deepEqual(artistSignatureCandidates({ ...queen, signatures }), []);
  });
  it('treats missing/unknown verification as unverified but preserves a single eligible asset', () => {
    for (const verification of [undefined, 'unknown']) {
      const row = { asset: imageUrl, source, license, verification };
      assert.equal(artistSignatureCandidates({ signatures: [row] }).length, 1);
      assert.deepEqual(artistSignatureCandidates({ signatures: [row, { ...row, asset: imageUrl+'x.svg' }] }), []);
    }
  });
  it('does not let a provider-local ID or malformed external ID resolve ambiguity', () => {
    assert.deepEqual(artistSignatureCandidates({ ...emilia, artist: { id: 'local-id', musicbrainz_id: 'unknown', wikidata_id: '' } }), []);
  });
});

describe('signature image eligibility', () => {
  it('rejects every JPEG from the actual Leona Lewis provider response', () => {
    const response = JSON.parse(readFileSync(new URL('./fixtures/signatures/leona-provider.json', import.meta.url), 'utf8'));
    assert.equal(parseArtistSignature(response), null);
  });
  it('rejects a JPEG even if metadata calls it a verified SVG', () => {
    assert.equal(parseArtistSignature(response({ asset: { url: 'https://upload.wikimedia.org/a.JPG?download=1', format: 'svg' }, verification: 'artist_verified' })), null);
  });
  it('skips opaque formats and still considers the next transparent-capable candidate', () => {
    assert.equal(parseArtistSignature({ signatures: [
      { asset: { url: 'https://upload.wikimedia.org/scan.jpg', format: 'jpeg' }, license: { status: 'known' }, verification: 'verified' },
      { asset: imageUrl, source, license, verification: 'verified' },
    ] })?.imageUrl, imageUrl);
  });
});

describe('independent Commons identity and rights', () => {
  const michael = JSON.parse(readFileSync(new URL('./fixtures/signatures/michael-jackson-provider.json', import.meta.url), 'utf8'));
  const filename = 'Michael Jackson signature.svg';
  it('requires both identity and independently confirmed Commons rights', () => {
    assert.deepEqual(artistSignatureCandidates(michael), []);
    assert.deepEqual(artistSignatureCandidates(michael, '', [filename]), []);
    assert.deepEqual(artistSignatureCandidates(michael, '', [], [filename]), []);
    const candidates = artistSignatureCandidates(michael, '', [filename], [filename]);
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0].imageUrl.includes('Michael_Jackson_signature.svg'));
    assert.ok(candidates[0].attribution.includes('PD-signature'));
  });
});
