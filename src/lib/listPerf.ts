/**
 * Shared FlatList virtualization props. Make scrolling smoother and reduce
 * memory in long lists (favorites, browse, queue) without changing behavior:
 * they only control how many items are mounted at once.
 */
export const listPerf = {
  removeClippedSubviews: true,
  initialNumToRender: 10,
  maxToRenderPerBatch: 10,
  // 21 screens keeps ~315 rows mounted on a typical phone — enough to cover a
  // 316-song playlist entirely, so ReanimatedSwipeable rows never unmount during
  // fast-scroll and re-mount blank.
  windowSize: 21,
  // 100ms between render batches (default 50ms): halves the render frequency
  // during fast-flings, keeping frames smooth at the cost of blanks on
  // very fast scrolls through completely un-rendered regions.
  updateCellsBatchingPeriod: 100,
};

/**
 * The same props, for a list whose rows answer a hold by travelling: a dragged
 * row is animated, which needs its cell mounted inside the virtual window, and
 * `removeClippedSubviews` is what hides them. The reorderable library leaves
 * that prop out of its own type for the same reason.
 */
export const reorderListPerf = {
  initialNumToRender: listPerf.initialNumToRender,
  maxToRenderPerBatch: listPerf.maxToRenderPerBatch,
  windowSize: listPerf.windowSize,
};
