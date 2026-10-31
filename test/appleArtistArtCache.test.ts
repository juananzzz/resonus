import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, it } from 'node:test';

// Real production cache; replace only native storage, images and network I/O.
const logo = { imageUrl: 'https://is1-ssl.mzstatic.com/logo.png', aspect: 3 };
const art = { heroUrl: 'https://is1-ssl.mzstatic.com/hero.jpg', logo };
const state = { offline: true, saved: undefined as any, fetches: 0, imageReads: 0 };
(globalThis as any).__appleArtCacheTest = state;
const stub = (body: string) => `data:text/javascript,${encodeURIComponent('const s=globalThis.__appleArtCacheTest;' + body)}`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  let body: string | undefined;
  if (specifier === 'expo/fetch') body = `export async function fetch(){s.fetches++;throw Error('unavailable')}`;
  if (specifier === 'expo-file-system/legacy') body = `
    export const documentDirectory='file:///app/';
    export async function readAsStringAsync(){if(!s.saved)throw Error('missing');return JSON.stringify(s.saved)}
    export async function writeAsStringAsync(){}
    export async function makeDirectoryAsync(){}
  `;
  if (specifier === 'expo-image') body = `export const Image={getCachePathAsync:async()=>{s.imageReads++;return null}};`;
  if (specifier === '@/api/netGate') body = `export const isManualOffline=()=>s.offline;`;
  if (specifier === './localLibrary' && context.parentURL?.endsWith('/appleArtistArtCache.ts')) body = `export const hashKey=()=>"hash";`;
  return body === undefined ? next(specifier, context) : { shortCircuit: true, url: stub(body) };
} });
const { getAppleArtistArt, getAppleArtistLogo } = await import('@/lib/appleArtistArtCache');
hooks.deregister();
beforeEach(() => Object.assign(state, { offline: true, saved: { version: 1, key: 'queen', at: Date.now(), art }, fetches: 0, imageReads: 0 }));

it('reads the separate cached logo offline even without cached hero pixels', async () => {
  assert.equal(await getAppleArtistArt('Queen'), null);
  state.imageReads = 0;
  assert.equal((await getAppleArtistLogo('Queen'))?.imageUrl, logo.imageUrl);
  assert.equal(state.imageReads + state.fetches, 0);
});
it('reuses a fresh Apple cache online without a new search', async () => {
  state.offline = false;
  assert.equal((await getAppleArtistLogo('Queen'))?.imageUrl, logo.imageUrl);
  assert.equal(state.fetches, 0);
});
it('preserves cached logo metadata during an Apple outage', async () => {
  state.offline = false; state.saved.at = 0;
  assert.equal((await getAppleArtistLogo('Queen'))?.imageUrl, logo.imageUrl);
  assert.equal(state.fetches, 1);
});
it('rejects another name or an unsafe logo from the Apple cache', async () => {
  assert.equal(await getAppleArtistLogo('Other artist'), null);
  state.saved.art = { ...art, logo: { ...logo, imageUrl: 'https://unrelated.example/logo.png' } };
  assert.equal(await getAppleArtistLogo('Queen'), null);
  assert.equal(state.fetches, 0);
});
