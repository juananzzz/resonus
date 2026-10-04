/**
 * Bottom sheet animation inside a `Modal` (animationType="none"):
 * the backdrop fades and the sheet slides up from the bottom on open (240 ms)
 * and slides down on close (160 ms). `dismiss(after)` plays the exit animation
 * and then runs the actual close (whoever closes the Modal), so the sheet
 * doesn't vanish abruptly. `pan` adds swipe-down-to-dismiss.
 */
import { useEffect } from 'react';
import { Dimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SHEET_IN, SHEET_OUT } from '@/theme/motion';

// Sheets always animate, even when the system has "remove animations" enabled:
// without a transition they appear abruptly with a visible layout jump. The
// reason lives with the token now (see `motion.reduceMotion.essential`).
const TIMING_IN = SHEET_IN;
const TIMING_OUT = SHEET_OUT;

const SCREEN_H = Dimensions.get('window').height;

/** Fraction of the sheet's height to drag past for the release to close it. */
const DISMISS_RATIO = 0.3;
/** Downward fling (px/s) that closes it regardless of how far it was dragged. */
const DISMISS_VELOCITY = 800;

export function useBottomSheetAnim(open: boolean, onClose?: () => void) {
  const progress = useSharedValue(0);
  // Actual sheet height (measured on first layout); until then, a full screen
  // height so the first frame stays safely out of view.
  const sheetH = useSharedValue(SCREEN_H);

  useEffect(() => {
    if (open) {
      progress.set(withTiming(1, TIMING_IN));
    } else {
      progress.set(0);
    }
  }, [open, progress]);

  const dismiss = (after: () => void) => {
    progress.set(withTiming(0, TIMING_OUT, (f) => {
      if (f) scheduleOnRN(after);
    }));
  };

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetH.value }],
  }));
  const onSheetLayout = (e: LayoutChangeEvent) => {
    sheetH.set(e.nativeEvent.layout.height);
  };

  /**
   * Swipe down to dismiss. The drag drives the very same `progress` as the
   * open/close animation, so the sheet follows the finger and the backdrop
   * fades along with it; on release it either finishes closing or springs back
   * to fully open. Without `onClose` it can be dragged but never closes, so
   * whoever wants the gesture must pass it.
   *
   * A factory because one gesture instance can only be attached to one
   * detector, and a sheet may need several: the song menu puts one on its
   * grabber and another on the list below, so the grabber still closes it when
   * the list is scrolled and owns the drag. Whichever one the finger lands on,
   * they all drive the same `progress`.
   */
  const makePan = () => Gesture.Pan()
    // Downward only and after 10 px, so taps on the actions still get through
    // and an upward drag never lifts the sheet above its place.
    .activeOffsetY(10)
    .failOffsetY(-10)
    .onUpdate((e) => {
      progress.set(Math.min(1, Math.max(0, 1 - e.translationY / sheetH.value)));
    })
    .onEnd((e) => {
      const closes =
        e.translationY > sheetH.value * DISMISS_RATIO || e.velocityY > DISMISS_VELOCITY;
      if (closes && onClose) {
        progress.set(withTiming(0, TIMING_OUT, (f) => {
          if (f) scheduleOnRN(onClose);
        }));
      } else {
        progress.set(withTiming(1, TIMING_IN));
      }
    });

  return { dismiss, pan: makePan(), makePan, backdropStyle, sheetStyle, onSheetLayout };
}
