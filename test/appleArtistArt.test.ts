import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appleArtistArtFromPage, appleMediaUrl } from '@/lib/appleArtistArt';

describe('Apple artist header metadata', () => {
  const image = { url: 'https://is1-ssl.mzstatic.com/image/{w}x{h}{c}.{f}', width: 2197, height: 2197 };
  const page = (header: unknown) => `<script id="serialized-server-data">${JSON.stringify([{ data: { header } }])}</script>`;
  it('extracts the actual Kacey hero, motion preview and HLS dictionary shape', () => {
    const result = appleArtistArtFromPage(page({ artistLogo: null, artwork: { dictionary: image },
      videoArtwork: { dictionary: { motionArtistSquare1x1: {
        video: 'https://mvod.itunes.apple.com/itunes-assets/clip.m3u8', previewFrame: image,
      } } } }));
    assert.equal(result?.heroUrl, 'https://is1-ssl.mzstatic.com/image/1200x1200bb.jpg');
    assert.equal(result?.previewUrl, result?.heroUrl);
    assert.equal(result?.videoUrl, 'https://mvod.itunes.apple.com/itunes-assets/clip.m3u8');
    assert.equal(result?.logo, null);
  });
  it('keeps still artwork when motion is absent or unsafe', () => {
    const result = appleArtistArtFromPage(page({ artistLogo: null, colorBackdropArtwork: { dictionary: image },
      videoArtwork: { dictionary: { motionArtistSquare1x1: { video: 'https://evil.example/a.m3u8' } } } }));
    assert.ok(result?.heroUrl);
    assert.equal(result?.videoUrl, undefined);
  });
  it('rejects malformed pages, dimensions and hostile CDN lookalikes', () => {
    assert.equal(appleArtistArtFromPage(page({ artistLogo: null, artwork: { dictionary: { ...image, height: 0 } } })), null);
    assert.equal(appleArtistArtFromPage('<script id="serialized-server-data">bad</script>'), null);
    for (const url of ['http://is1.mzstatic.com/a', 'https://mzstatic.com.evil.example/a', 'https://user:pass@is1.mzstatic.com/a', 'file:///a']) {
      assert.equal(appleMediaUrl(url), undefined);
    }
    assert.equal(appleMediaUrl('https://mvod.itunes.apple.com/a.mp4', true), undefined);
  });
});
