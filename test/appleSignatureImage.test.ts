import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, describe, it } from 'node:test';

// Exercise the actual logo parser and image loader, stubbing native I/O only.
const state = { opaque: false, local: null as string | null, loaded: [] as string[], tints: [] as string[], released: false };
Object.assign(globalThis, { __appleSignatureImageTest: state });
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'expo-image') return { shortCircuit: true,
    url: `data:text/javascript,${encodeURIComponent(`
      const s = globalThis.__appleSignatureImageTest;
      export const Image = {
        getCachePathAsync: async () => s.local,
        loadAsync: async (uri, options) => {
          s.loaded.push(uri);
          s.tints.push(options.tintColor);
          return {isAnimated:false,release(){s.released=true}};
        },

      };
    `)}` };
  if (specifier === './signatureInk' && context.parentURL?.endsWith('/signatureImage.ts')) return { shortCircuit: true,
    url: `data:text/javascript,${encodeURIComponent(`const s=globalThis.__appleSignatureImageTest;export async function hasVisibleSignatureInk(){return !s.opaque}`)}` };
  return next(specifier, context);
} });
const { loadSignatureImage } = await import('@/lib/signatureImage');
const { parseArtistLogo } = await import('@/lib/artistLogo');
hooks.deregister();
const logo = parseArtistLogo({ url: 'https://is1-ssl.mzstatic.com/artist/{w}x{h}{c}.{f}', width: 2880, height: 775 })!;

beforeEach(() => Object.assign(state, { opaque: false, local: null, loaded: [], tints: [], released: false }));
describe('Apple title logo mask validation', () => {
  it('accepts a transparent logo through the shared production loader', async () => {
    const result = await loadSignatureImage(logo, false);
    assert.equal(result?.imageUrl, logo.imageUrl);
    assert.ok(result?.image);
    assert.equal(state.released, false);
    assert.deepEqual(state.tints, ['#ffffff']);
  });
  it('tints Apple logos at decode time with the requested theme ink', async () => {
    assert.ok(await loadSignatureImage(logo, false, '#171717'));
    assert.ok(await loadSignatureImage(logo, false, '#ffffff'));
    assert.deepEqual(state.tints, ['#171717', '#ffffff']);
  });
  it('rejects and releases an opaque Apple PNG', async () => {
    state.opaque = true;
    assert.equal(await loadSignatureImage(logo, false), null);
    assert.equal(state.released, true);
  });
  it('does not fetch missing logo bytes offline', async () => {
    assert.equal(await loadSignatureImage(logo, true), null);
    assert.deepEqual(state.loaded, []);
  });
  it('validates the cached logo through its local file offline', async () => {
    state.local = '/cache/logo';
    assert.ok(await loadSignatureImage(logo, true));
    assert.deepEqual(state.loaded, ['file:///cache/logo']);
  });
});
