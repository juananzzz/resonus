/** How the reorderable engine scrolls while a row is held at an end (#336). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REORDER_AUTOSCROLL_FRAME_MS,
  REORDER_AUTOSCROLL_STEP_PX,
  reorderAutoscroll,
} from '@/lib/listPerf';

/**
 * A track row is never shorter than its 48 px artwork plus its vertical
 * padding, so anything under 48 px cannot look like a whole row arriving.
 */
const NARROWEST_ROW_PX = 48;

/** The library's own steps: 80 px on Android Fabric, 100 px elsewhere. */
const LIBRARY_STEPS_PX = [80, 100];

describe('reorder autoscroll', () => {
  it('moves the list in steps the eye reads as motion, not as rows', () => {
    for (const libraryStep of LIBRARY_STEPS_PX) {
      const { autoscrollSpeedScale } = reorderAutoscroll(REORDER_AUTOSCROLL_STEP_PX);
      const step = libraryStep * autoscrollSpeedScale;
      assert.ok(
        step < NARROWEST_ROW_PX,
        `${step}px per step is a whole row on the library's ${libraryStep}px step`,
      );
      assert.ok(step > 0, 'the list has to keep moving');
    }
  });

  it('never waits longer than a frame between steps', () => {
    const { autoscrollDelay } = reorderAutoscroll(REORDER_AUTOSCROLL_STEP_PX);
    assert.equal(autoscrollDelay, REORDER_AUTOSCROLL_FRAME_MS);
    assert.ok(autoscrollDelay <= 16, `${autoscrollDelay}ms is more than a frame at 60fps`);
  });

  it('keeps up with a hand at the edge of the screen', () => {
    for (const libraryStep of LIBRARY_STEPS_PX) {
      const { autoscrollDelay, autoscrollSpeedScale } = reorderAutoscroll(
        REORDER_AUTOSCROLL_STEP_PX,
      );
      const pxPerSecond = (libraryStep * autoscrollSpeedScale * 1000) / autoscrollDelay;
      // A screen's worth of songs (4-5 rows) in under a second, and not so
      // fast that the row under the finger outruns it.
      assert.ok(pxPerSecond >= 700, `${pxPerSecond}px/s is too slow to reach the bottom`);
      assert.ok(pxPerSecond <= 1600, `${pxPerSecond}px/s outruns the hand`);
    }
  });

  it('scales the library step it was handed, and nothing else', () => {
    assert.deepEqual(reorderAutoscroll(20, 10), { autoscrollDelay: 10, autoscrollSpeedScale: 0.25 });
    assert.deepEqual(reorderAutoscroll(80), {
      autoscrollDelay: REORDER_AUTOSCROLL_FRAME_MS,
      autoscrollSpeedScale: 1,
    });
  });
});
