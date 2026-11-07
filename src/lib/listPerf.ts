/**
 * Shared FlatList virtualization props. Make scrolling smoother and reduce
 * memory in long lists (favorites, browse, queue) without changing behavior:
 * they only control how many items are mounted at once.
 */
export const listPerf = {
  removeClippedSubviews: true,
  // Render 20 items per batch (doubled from default 10) so the full buffer fills
  // twice as fast on first open — a fast fling before all rows are rendered shows
  // blank cells, and larger batches halve the time to cover a 316-song playlist.
  initialNumToRender: 10,
  maxToRenderPerBatch: 20,
  // 21 screens keeps ~315 rows mounted on a typical phone — enough to cover a
  // 316-song playlist entirely, so ReanimatedSwipeable rows never unmount during
  // fast-scroll and re-mount blank.
  windowSize: 21,
  // 50ms (the default): reverted from 100ms. Faster batching means un-rendered
  // rows fill in sooner during fast-scroll, at the cost of slightly more JS work.
  updateCellsBatchingPeriod: 50,
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
