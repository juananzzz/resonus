import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { beforeEach, describe, it } from 'node:test';

const api = 'https://signatures.example';
const key = `${api}/\nLeona Lewis`;
const png = 'https://upload.wikimedia.org/signature.png';
const svg = 'https://upload.wikimedia.org/second.svg';
const leona = JSON.parse(readFileSync(new URL('./fixtures/signatures/leona-provider.json', import.meta.url), 'utf8'));
const emilia = JSON.parse(readFileSync(new URL('./fixtures/signatures/emilia-provider.json', import.meta.url), 'utf8'));
const response = (...urls: string[]) => ({ signatures: urls.map(asset => ({ asset, verification: 'verified',
  source: { url: 'https://commons.wikimedia.org/wiki/File:Signature.svg' },
  license: { status: 'known', name: 'PD-signature' } })) });
const state = {
  offline: false, saved: undefined as Record<string, unknown> | undefined,
  response: leona as unknown, status: 200, failFetch: false, failValidation: false, animated: false,
  masks: new Map<string, boolean>(), files: new Map<string, string>(), loaded: [] as string[],
  refs: [] as { uri: string; options: { tintColor: string }; released: boolean }[], written: undefined as Record<string, unknown> | undefined, fetches: 0, network: new Map<string, unknown>(),
};
Object.assign(globalThis, { __signatureCacheTest: state });
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  const prelude = 'const s = globalThis.__signatureCacheTest;';
  if (specifier === 'expo/fetch') return { shortCircuit: true, url: stub(prelude + `
    export async function fetch(url) {
      s.fetches++; if(s.network.has(url)) return {ok:true,status:200,text:async()=>JSON.stringify(s.network.get(url))};
      if(s.failFetch) throw Error('offline');
      return {ok:s.status===200,status:s.status,text:async()=>JSON.stringify(s.response)};
    }`) };
  if (specifier === 'expo-file-system/legacy') return { shortCircuit: true, url: stub(prelude + `
    export const documentDirectory='file:///app/';
    export async function readAsStringAsync(){if(!s.saved) throw Error('missing');return JSON.stringify(s.saved)}
    export async function writeAsStringAsync(_,v){s.written=JSON.parse(v)}
    export async function makeDirectoryAsync(){}
  `) };
  if (specifier === 'expo-image') return { shortCircuit: true, url: stub(prelude + `
    export const Image={
      getCachePathAsync:async uri=>s.files.get(uri)??null,
      loadAsync:async (uri,options)=>{
        s.loaded.push(uri); if(!s.masks.has(uri)) throw Error('image decode failed');
        const ref={uri,options,isAnimated:s.animated,released:false,release(){this.released=true}};
        s.refs.push(ref);return ref;
      },

    };
  `) };
  if (specifier === './signatureInk' && context.parentURL?.endsWith('/signatureImage.ts')) return { shortCircuit: true, url: stub(prelude+`export async function hasVisibleSignatureInk(ref){if(s.failValidation)throw Error('pixel validation failed');return s.masks.get(ref.uri)===true}`) };
  if (specifier === '@/api/netGate') return { shortCircuit: true, url: stub(prelude+'export const isManualOffline=()=>s.offline;') };
  if (specifier === './localLibrary' && context.parentURL?.endsWith('/signatureCache.ts')) return { shortCircuit: true, url: stub('export const hashKey=()=>"hash";') };
  return next(specifier, context);
} });
const { getArtistSignature } = await import('@/lib/signatureCache');
hooks.deregister();
const lookup = () => getArtistSignature('Leona Lewis', api);

beforeEach(() => {
  Object.assign(state, { offline: false, saved: undefined, response: leona, status: 200,
    failFetch: false, failValidation: false, animated: false, masks: new Map(), files: new Map(),
    loaded: [], refs: [], written: undefined, fetches: 0, network: new Map() });
});

describe('signature pixel validation and cache', () => {
  it('tints the decoded image itself because view tint does not recolor ImageRef sources', async () => {
    state.response = response(png); state.masks.set(png, true);
    await lookup();
    assert.equal(state.refs[0].options.tintColor, '#ffffff');
  });
  it('uses the requested theme ink for separately decoded references', async () => {
    state.response = response(png); state.masks.set(png, true);
    await getArtistSignature('Leona Lewis', api, '#171717');
    await getArtistSignature('Leona Lewis', api, '#ffffff');
    assert.deepEqual(state.refs.map(ref => ref.options.tintColor), ['#171717', '#ffffff']);
  });
  it('rejects cached ambiguous Emilia signatures offline without decoding or fetching', async () => {
    state.offline = true;
    state.saved = { version: 4, key: key.replace('Leona Lewis', 'Emilia'), at: Date.now(), found: true, response: emilia };
    for (const row of emilia.signatures) state.files.set(row.asset.url, '/cache/emilia');
    state.masks.set('file:///cache/emilia', true);
    assert.equal(await getArtistSignature('Emilia', api), null);
    assert.deepEqual(state.loaded, []);
    assert.equal(state.fetches, 0);
  });
  it('keeps the normal name and a short-lived miss for ambiguous matches', async () => {
    state.response = emilia;
    assert.equal(await getArtistSignature('Emilia', api), null);
    assert.deepEqual(state.loaded, []);
    assert.equal(state.written?.found, false);
  });
  it('does not contact any source without a configured provider', async () => {
    assert.equal(await getArtistSignature('Leona Lewis'), null);
    assert.equal(state.fetches, 0);
  });
  it('revalidates v3 Leona metadata and stores a short-lived v7 miss', async () => {
    state.saved = { version: 3, key, at: Date.now(), response: leona };
    assert.equal(await lookup(), null);
    assert.equal(state.fetches, 1);
    assert.deepEqual(state.loaded, []);
    assert.equal(state.written?.version, 7);
    assert.equal(state.written?.found, false);
  });
  it('rejects opaque pixels and returns the exact checked next image', async () => {
    state.response = response(svg, png);
    state.masks.set(svg, false); state.masks.set(png, true);
    const result = await lookup();
    assert.equal(result?.imageUrl, png);
    assert.equal(result?.image, state.refs[1]);
    assert.equal(state.refs[0].released, true);
    assert.equal(state.refs[1].released, false);
  });
  it('keeps the name if every candidate is opaque', async () => {
    state.response = response(png); state.masks.set(png, false);
    assert.equal(await lookup(), null);
    assert.equal(state.written?.found, false);
  });
  it('rejects animated masks and releases their native reference', async () => {
    state.response = response(png); state.masks.set(png, true); state.animated = true;
    assert.equal(await lookup(), null);
    assert.equal(state.refs[0].released, true);
  });
  it('does not cache a failed decode as a provider miss', async () => {
    state.response = response(svg);
    assert.equal(await lookup(), null);
    assert.equal(state.written, undefined);
  });
  it('releases the image if native pixel validation fails', async () => {
    state.response = response(png); state.masks.set(png, true); state.failValidation = true;
    assert.equal(await lookup(), null);
    assert.equal(state.refs[0].released, true);
    assert.equal(state.written, undefined);
  });
  it('revalidates old usable images offline with only a local file', async () => {
    state.offline = true;
    state.saved = { version: 3, key, at: Date.now(), response: response(svg) };
    state.files.set(svg, '/cache/signature'); state.masks.set('file:///cache/signature', true);
    assert.equal((await lookup())?.imageUrl, svg);
    assert.deepEqual(state.loaded, ['file:///cache/signature']);
    assert.equal(state.fetches, 0);
  });
  it('never decodes an old Leona JPEG or fetches a source offline', async () => {
    state.offline = true; state.saved = { version: 3, key, at: Date.now(), response: leona };
    assert.equal(await lookup(), null);
    assert.equal(state.fetches + state.loaded.length, 0);
  });
  it('preserves a valid old image during a provider outage', async () => {
    state.failFetch = true; state.saved = { version: 3, key, at: Date.now(), response: response(svg) };
    state.masks.set(svg, true);
    assert.equal((await lookup())?.imageUrl, svg);
    assert.equal(state.written, undefined);
  });
  it('revalidates a positive v4 hit and retries if the image is now opaque', async () => {
    state.saved = { version: 4, key, at: Date.now(), found: true, response: response(svg) };
    state.masks.set(svg, false); state.masks.set(png, true); state.response = response(png);
    assert.equal((await lookup())?.imageUrl, png);
    assert.equal(state.fetches, 1);
  });
  it('retries fresh negative v4 entries after replacing lossy mask validation', async () => {
    state.saved = { version: 4, key, at: Date.now(), found: false, response: response(png) };
    state.response = response(png); state.masks.set(png, true);
    assert.equal((await lookup())?.imageUrl, png);
    assert.equal(state.fetches, 1);
    assert.equal(state.written?.version, 7);
    assert.equal(state.written?.found, true);
  });
  it('rejects cache key collisions', async () => {
    state.offline = true; state.saved = { version: 4, key: key+'other', at: Date.now(), response: response(svg) };
    assert.equal(await lookup(), null);
    assert.deepEqual(state.loaded, []);
  });
  it('keeps a fresh negative hit for five minutes', async () => {
    state.saved = { version: 7, key, at: Date.now(), found: false, response: { signatures: [] } };
    assert.equal(await lookup(), null);
    assert.equal(state.fetches, 0);
  });
  it('treats an HTTP 404 with no JSON body as a provider miss', async () => {
    state.status = 404;
    assert.equal(await lookup(), null);
    assert.equal(state.written?.found, false);
  });
});

describe('Michael Jackson identity and licence lookup', () => {
  it('loads the exact Commons file after reciprocal identity and licence checks', async () => {
    const mbid = 'f27ec8db-af05-4f36-916e-3d57f91ecf5e';
    const file = 'Michael Jackson signature.svg';
    const michael = JSON.parse(readFileSync(new URL('./fixtures/signatures/michael-jackson-provider.json', import.meta.url), 'utf8'));
    const image = michael.signatures[0].asset.url;
    state.response = michael; state.masks.set(image, true);
    const claim = (value: string) => ({ mainsnak: { datavalue: { value } } });
    state.network.set(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`, { id: mbid, relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q2831' } }] });
    state.network.set('https://www.wikidata.org/wiki/Special:EntityData/Q2831.json', { entities: { Q2831: { id: 'Q2831', claims: { P434: [claim(mbid)], P109: [claim(file)] } } } });
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({ action: 'query', prop: 'templates', titles: `File:${file}`, tllimit: 'max', format: 'json' }).toString();
    state.network.set(url.href, { query: { pages: { 1: { title: `File:${file}`, templates: [{ title: 'Template:PD-signature' }] } } } });
    assert.equal((await getArtistSignature('Michael Jackson', api, '#ffffff', mbid))?.imageUrl, image);
    assert.equal(state.fetches, 4);
    assert.equal(state.written?.found, true);
  });
});
