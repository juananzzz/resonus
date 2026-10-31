import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { artworkNetworkAllowed } from '@/lib/artworkMotionPolicy';

describe('motion artwork network policy', () => {
  it('requires an explicit connected Wi-Fi network by default', () => {
    assert.equal(artworkNetworkAllowed(true, { wifi: true, connected: true }), true);
    // Cellular, unknown, Ethernet and a VPN without known underlying Wi-Fi
    // must not become Wi-Fi simply because they are not marked cellular.
    assert.equal(artworkNetworkAllowed(true, { wifi: false, connected: true }), false);
    assert.equal(artworkNetworkAllowed(true, { wifi: true, connected: false }), false);
  });
  it('lets users opt into cellular motion without permitting disconnected playback', () => {
    assert.equal(artworkNetworkAllowed(false, { wifi: false, connected: true }), true);
    assert.equal(artworkNetworkAllowed(false, { wifi: false, connected: false }), false);
  });
  it('stops on Wi-Fi handover and allows motion again when Wi-Fi returns', () => {
    const handover = [
      { wifi: true, connected: true },
      { wifi: false, connected: false },
      { wifi: false, connected: true },
      { wifi: true, connected: true },
    ];
    assert.deepEqual(handover.map((state) => artworkNetworkAllowed(true, state)), [true, false, false, true]);
  });
});
