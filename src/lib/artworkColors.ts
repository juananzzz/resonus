/** Keep the sampled hue, adjusting brightness only for legible themed controls. */
export function readableArtworkColor(hex: string, mode: 'light' | 'dark'): string {
  if (!/^#[\da-f]{6}$/i.test(hex)) return mode === 'dark' ? '#121212' : '#ffffff';
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const luminance = (values: number[]) => values.map(linear).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  let result = rgb;
  // Bound the resulting background, including neutral white/black sleeves.
  for (let step = 0; step < 100; step++) {
    const light = luminance(result);
    if (mode === 'dark' ? light <= 0.055 : light >= 0.8) break;
    result = result.map((v) => mode === 'dark' ? v * 0.97 : v + (1 - v) * 0.04);
  }
  return '#' + result.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
