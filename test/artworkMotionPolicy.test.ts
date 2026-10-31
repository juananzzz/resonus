import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { artworkNetworkAllowed } from '@/lib/artworkMotionPolicy';

describe('motion artwork network policy', () => {
  it('holds back only mobile data by default', () => {
    assert.equal(artworkNetworkAllowed(true, { cellular: false, connected: true }), true);
    assert.equal(artworkNetworkAllowed(true, { cellular: true, connected: true }), false);
    assert.equal(artworkNetworkAllowed(true, { cellular: false, connected: false }), false);
  });
  it('lets users opt into cellular motion without permitting disconnected playback', () => {
    assert.equal(artworkNetworkAllowed(false, { cellular: true, connected: true }), true);
    assert.equal(artworkNetworkAllowed(false, { cellular: true, connected: false }), false);
  });
  it('stops on Wi-Fi handover and allows motion again when Wi-Fi returns', () => {
    const handover = [
      { cellular: false, connected: true },
      { cellular: false, connected: false },
      { cellular: true, connected: true },
      { cellular: false, connected: true },
    ];
    assert.deepEqual(handover.map((state) => artworkNetworkAllowed(true, state)), [true, false, false, true]);
  });
});
