import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commonsFileFromUrl, wikidataIdFromMusicBrainz, wikidataSignatureFiles } from '@/lib/signatureIdentity';

const mbid = 'f27ec8db-af05-4f36-916e-3d57f91ecf5e';
const relation = { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q2831' } };
const claim = (value: string) => ({ mainsnak: { datavalue: { value } } });
const entity = { entities: { Q2831: { id: 'Q2831', claims: { P434: [claim(mbid)], P109: [claim('Michael Jackson signature.svg')] } } } };
describe('signature identity verification', () => {
  it('requires one trusted Wikidata relation for the requested MusicBrainz ID', () => {
    assert.equal(wikidataIdFromMusicBrainz({ id: mbid, relations: [relation] }, mbid), 'Q2831');
    assert.equal(wikidataIdFromMusicBrainz({ id: 'other', relations: [relation] }, mbid), undefined);
    assert.equal(wikidataIdFromMusicBrainz({ id: mbid, relations: [relation, { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q42' } }] }, mbid), undefined);
    assert.equal(wikidataIdFromMusicBrainz({ id: mbid, relations: [{ type: 'wikidata', url: { resource: 'https://evil.example/wiki/Q2831' } }] }, mbid), undefined);
  });
  it('requires the reciprocal MusicBrainz ID before accepting a signature', () => {
    assert.deepEqual(wikidataSignatureFiles(entity, 'Q2831', mbid), ['Michael Jackson signature.svg']);
    assert.deepEqual(wikidataSignatureFiles(entity, 'Q2831', '00000000-0000-0000-0000-000000000000'), []);
    assert.deepEqual(wikidataSignatureFiles(entity, 'Q42', mbid), []);
  });
  it('matches only canonical Commons originals', () => {
    assert.equal(commonsFileFromUrl('https://upload.wikimedia.org/wikipedia/commons/0/04/Michael_Jackson_signature.svg?x=1'), 'Michael Jackson signature.svg');
    assert.equal(commonsFileFromUrl('https://evil.example/wikipedia/commons/0/04/Michael_Jackson_signature.svg'), undefined);
  });
});

describe('Commons signature licence evidence', () => {
  const filename = 'Michael Jackson signature.svg';
  const page = { title: `File:${filename}`, templates: [{ title: 'Template:PD-signature' }] };
  it('requires the exact file and explicit signature template', async () => {
    const { commonsHasPublicDomainSignature } = await import('@/lib/signatureIdentity');
    const response = (p: object) => ({ query: { pages: { 1: p } } });
    assert.equal(commonsHasPublicDomainSignature(response(page), filename), true);
    assert.equal(commonsHasPublicDomainSignature(response({ ...page, title: 'File:Other.svg' }), filename), false);
    assert.equal(commonsHasPublicDomainSignature(response({ ...page, templates: [{ title: 'Template:PD-old' }] }), filename), false);
    assert.equal(commonsHasPublicDomainSignature({ ...response(page), continue: { tlcontinue: 'next' } }, filename), false);
    assert.equal(commonsHasPublicDomainSignature(response({ ...page, missing: '' }), filename), false);
  });
});
