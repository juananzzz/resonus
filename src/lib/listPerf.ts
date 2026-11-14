/**
 * Shared FlatList virtualization props. Make scrolling smoother and reduce
 * memory in long lists (favorites, browse, queue) without changing behavior:
 * they only control how many items are mounted at once.
 */
export const listPerf = {
  removeClippedSubviews: true,
  initialNumToRender: 10,
  maxToRenderPerBatch: 10,
  windowSize: 11,
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

/**
 * How the reorderable engine scrolls while a dragged row is held at an end of
 * the list.
 *
 * It does not scroll continuously: it jumps a fixed step and waits before the
 * next one (see `AUTOSCROLL_CONFIG` in `ReorderableListCore.tsx`). On Android
 * Fabric - the engine React Native 0.86 runs - that is 80 px every 50 ms, and
 * on iOS 100 px every 80 ms. 80 px is a whole track row, so a playlist being
 * reordered to the bottom lands on the next song, sits still while that row
 * comes in, and jumps again: under a hand holding a row at the edge of the
 * screen that is every new song catching before the scroll goes on (#336).
 *
 * A fifth of that step, one frame apart, is 16 px per frame. That still
 * crosses four or five rows in under a second, only in movements the eye
 * reads as a scroll rather than as a row arriving. `autoscrollSpeedScale` is
 * a share of the library's own step, so it is computed from that number
 * instead of written down as a ratio whose reason has been lost.
 */
const LIBRARY_AUTOSCROLL_STEP_PX = 80; // Android Fabric, ReorderableListCore
export const REORDER_AUTOSCROLL_STEP_PX = 16;
/** One frame at 60 fps: no pause long enough to read as the list stopping. */
export const REORDER_AUTOSCROLL_FRAME_MS = 16;

export function reorderAutoscroll(
  stepPx: number,
  frameMs = REORDER_AUTOSCROLL_FRAME_MS,
): { autoscrollDelay: number; autoscrollSpeedScale: number } {
  return {
    autoscrollDelay: frameMs,
    autoscrollSpeedScale: stepPx / LIBRARY_AUTOSCROLL_STEP_PX,
  };
}
