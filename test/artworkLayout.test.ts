import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { playerArtworkLayout, savedAnimatedArtworkMode, type AnimatedArtworkMode } from '@/lib/artworkLayout';

const base = { motionMode: 'cover' as AnimatedArtworkMode, hasMotion: true, staticFullBleed: true, hasCover: true, landscape: false };

describe('independent static and animated artwork layouts', () => {
  it('never lets the static full-bleed switch override any animated choice', () => {
    for (const motionMode of ['cover', 'background', 'fullBleed'] as const) {
      for (const staticFullBleed of [true, false]) {
        assert.equal(playerArtworkLayout({ ...base, motionMode, staticFullBleed }), motionMode);
      }
    }
  });
  it('keeps the static cover switch independent of every animated choice', () => {
    for (const motionMode of ['cover', 'background', 'fullBleed'] as const) {
      assert.equal(playerArtworkLayout({ ...base, motionMode, hasMotion: false }), 'fullBleed');
      assert.equal(playerArtworkLayout({ ...base, motionMode, hasMotion: false, staticFullBleed: false }), 'cover');
    }
  });
  it('retains the cover and background layouts in landscape, with full bleed falling back to the cover', () => {
    assert.equal(playerArtworkLayout({ ...base, landscape: true }), 'cover');
    assert.equal(playerArtworkLayout({ ...base, landscape: true, motionMode: 'background' }), 'background');
    assert.equal(playerArtworkLayout({ ...base, landscape: true, motionMode: 'fullBleed' }), 'cover');
    assert.equal(playerArtworkLayout({ ...base, landscape: true, hasMotion: false }), 'cover');
  });
  it('does not leave a cover-sized hole when no artwork exists', () => {
    assert.equal(playerArtworkLayout({ ...base, hasCover: false, motionMode: 'fullBleed' }), 'cover');
  });
});

describe('animated artwork settings migration', () => {
  it('preserves both original upstream modes', () => {
    assert.equal(savedAnimatedArtworkMode({ animatedCoverBackground: false }), 'cover');
    assert.equal(savedAnimatedArtworkMode({ animatedCoverBackground: true }), 'background');
  });
  it('preserves the effective full-bleed mode of previous local builds', () => {
    assert.equal(savedAnimatedArtworkMode({ playerFullBleed: true, animatedCoverBackground: false }), 'fullBleed');
    assert.equal(savedAnimatedArtworkMode({ playerFullBleed: false, animatedCoverBackground: true }), 'background');
  });
  it('gives an explicit new choice precedence over both legacy switches', () => {
    assert.equal(savedAnimatedArtworkMode({ animatedArtworkMode: 'cover', playerFullBleed: true, animatedCoverBackground: true }), 'cover');
    assert.equal(savedAnimatedArtworkMode({ animatedArtworkMode: 'fullBleed', playerFullBleed: false }), 'fullBleed');
  });
  it('rejects malformed modes and leaves empty profiles at the default', () => {
    assert.equal(savedAnimatedArtworkMode({ animatedArtworkMode: 'unexpected', animatedCoverBackground: true }), undefined);
    assert.equal(savedAnimatedArtworkMode({}), undefined);
  });
});
