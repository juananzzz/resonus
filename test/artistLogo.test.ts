import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { artistLogoFromPage, artistPageFromSearch, parseArtistLogo } from '@/lib/artistLogo';

describe('Apple artist logo fallback', () => {
  const logo = { url: 'https://is1-ssl.mzstatic.com/image/artist/{w}x{h}{c}.{f}', width: 2880, height: 775 };
  it('reads the Kacey artistLogo dictionary shape and keeps its aspect ratio', () => {
    const html = `<script id="serialized-server-data">${JSON.stringify([{ data: { header: { artistLogo: { dictionary: logo } } } }])}</script>`;
    const result = artistLogoFromPage(html);
    assert.equal(result?.imageUrl, 'https://is1-ssl.mzstatic.com/image/artist/1000x269bb.png');
    assert.equal(result?.aspect, 2880 / 775);
    assert.match(result!.attribution, /title logo/);
  });
  it('only visits an exact artist name match on Apple Music', () => {
    const row = { artistName: 'Kacey Musgraves', artistLinkUrl: 'https://music.apple.com/us/artist/kacey-musgraves/466044182?uo=4' };
    assert.equal(artistPageFromSearch({ results: [row] }, 'Kacey Musgraves'), row.artistLinkUrl.split('?')[0]);
    assert.equal(artistPageFromSearch({ results: [row] }, 'Other Artist'), undefined);
    assert.equal(artistPageFromSearch({ results: [{ ...row, artistLinkUrl: 'https://example.com/us/artist/name' }] }, row.artistName), undefined);
  });
  it('rejects malformed pages, hostile hosts and zero dimensions', () => {
    assert.equal(artistLogoFromPage('<script>alert(1)</script>'), null);
    assert.equal(artistLogoFromPage('<script id="serialized-server-data">invalid</script>'), null);
    assert.equal(parseArtistLogo({ ...logo, width: 0 }), null);
    assert.equal(parseArtistLogo({ ...logo, url: 'https://mzstatic.com.evil.example/image.png' }), null);
    assert.equal(parseArtistLogo({ ...logo, url: 'https://user:pass@is1-ssl.mzstatic.com/a.png' }), null);
  });
});
