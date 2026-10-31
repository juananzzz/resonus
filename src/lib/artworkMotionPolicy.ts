/** Unknown connections never count as Wi-Fi. Music has its own network policy. */
export function artworkNetworkAllowed(wifiOnly: boolean, network: { wifi: boolean; connected: boolean }): boolean {
  return network.connected && (!wifiOnly || network.wifi);
}
