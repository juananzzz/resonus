/** Only mobile data is held back: a VPN or Ethernet is not metered. Music has its own network policy. */
export function artworkNetworkAllowed(wifiOnly: boolean, network: { cellular: boolean; connected: boolean }): boolean {
  return network.connected && (!wifiOnly || !network.cellular);
}
