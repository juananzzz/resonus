/**
 * How wide one card is in a fixed-column grid (#131).
 *
 * The width has to be the one the screen has now, not the one it had when the
 * module first loaded. A card measured against the portrait width and then
 * drawn on a phone that has been turned is either too narrow for the row or
 * too wide for it; taking the width as an argument lets the caller pass the
 * live value from `useScreenSize`/`useWindowDimensions`.
 */
export function gridCardWidth(
  width: number,
  columns: number,
  gap: number,
  sidePadding: number,
): number {
  const usable = width - sidePadding * 2 - gap * (columns - 1);
  return Math.max(0, usable / columns);
}
