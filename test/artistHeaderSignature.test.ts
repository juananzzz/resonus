import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, it } from 'node:test';

const logo = { imageUrl: 'https://is1-ssl.mzstatic.com/logo.png', aspect: 3, attribution: 'Apple Music' };
const state = { logo: logo as typeof logo | null, usable: true, failApple: false,
  calls: [] as string[], loadOptions: [] as unknown[], providerOptions: [] as unknown[] };
Object.assign(globalThis, { __artistHeaderTest: state });
const stub = (body: string) => `data:text/javascript,${encodeURIComponent('const s=globalThis.__artistHeaderTest;' + body)}`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (!context.parentURL?.endsWith('/artistHeaderSignature.ts')) return next(specifier, context);
  const body: Record<string, string> = {
    './appleArtistArtCache': `export async function getAppleArtistLogo(){s.calls.push('apple');if(s.failApple)throw Error('unavailable');return s.logo}`,
    './signatureImage': `export async function loadSignatureImage(logo,offline,tint){s.calls.push('pixels');s.loadOptions.push([offline,tint]);return s.usable?{...logo,image:{}}:null}`,
    './signatureCache': `export async function getArtistSignature(name,api,tint,mbid){s.calls.push('provider');s.providerOptions.push([name,api,tint,mbid]);return {imageUrl:api,image:{},aspect:2,attribution:name}}`,
  };
  return body[specifier] ? { shortCircuit: true, url: stub(body[specifier]) } : next(specifier, context);
} });
const { getArtistHeaderSignature } = await import('@/lib/artistHeaderSignature');
hooks.deregister();
const options = { appleLogos: true, api: 'https://signatures.example', offline: false, tintColor: '#ffffff' };
beforeEach(() => Object.assign(state, { logo, usable: true, failApple: false, calls: [], loadOptions: [], providerOptions: [] }));

it('prefers a checked Apple logo before fetching any provider signature', async () => {
  assert.equal((await getArtistHeaderSignature('Queen', options))?.imageUrl, logo.imageUrl);
  assert.deepEqual(state.calls, ['apple', 'pixels']);
});
it('never queries Apple when only the signature provider is enabled', async () => {
  assert.equal((await getArtistHeaderSignature('Daddy Yankee', { ...options, appleLogos: false }))?.imageUrl, options.api);
  assert.deepEqual(state.calls, ['provider']);
});
it('falls back to the provider for a missing, rejected or failed Apple logo', async () => {
  for (const mode of ['missing', 'rejected', 'failed']) {
    state.calls = []; state.logo = mode === 'missing' ? null : logo;
    state.usable = mode !== 'rejected'; state.failApple = mode === 'failed';
    assert.equal((await getArtistHeaderSignature('Queen', options))?.imageUrl, options.api);
    assert.equal(state.calls.at(-1), 'provider');
  }
});
it('allows Apple without enabling a provider and propagates offline/tint to validation', async () => {
  assert.ok(await getArtistHeaderSignature('Queen', { ...options, api: undefined, offline: true, tintColor: '#171717' }));
  assert.deepEqual(state.loadOptions, [[true, '#171717']]);
  assert.deepEqual(state.calls, ['apple', 'pixels']);
});
it('keeps the name without contacting either source when both are disabled', async () => {
  assert.equal(await getArtistHeaderSignature('Queen', { ...options, api: undefined, appleLogos: false }), null);
  assert.deepEqual(state.calls, []);
});

it('preserves the MusicBrainz identity when falling back from Apple to the signature provider', async () => {
  state.logo = null;
  const mbid = 'f27ec8db-af05-4f36-916e-3d57f91ecf5e';
  await getArtistHeaderSignature('Michael Jackson', { ...options, musicBrainzId: mbid });
  assert.deepEqual(state.providerOptions, [['Michael Jackson', options.api, options.tintColor, mbid]]);
});
