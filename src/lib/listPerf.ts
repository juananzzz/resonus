/**
 * Shared FlatList virtualization props. Make scrolling smoother and reduce
 * memory in long lists (favorites, browse, queue) without changing behavior:
 * they only control how many items are mounted at once.
 */
export const listPerf = {
  removeClippedSubviews: true,
  initialNumToRender: 10,
  // 20 items per batch: cells fill in quickly during a fast fling so blank rows
  // don't appear, while the reduced windowSize keeps the total mounted count low.
  maxToRenderPerBatch: 20,
  // 11 viewports keeps ~130 rows mounted — roughly half what windowSize: 21
  // mounted. Fewer live ReanimatedSwipeable gesture handlers = less lag. The
  // higher maxToRenderPerBatch compensates by filling newly-visible rows fast.
  windowSize: 11,
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
