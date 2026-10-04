/**
 * A row admitting it was touched, late enough not to do it while you scroll.
 *
 * The song rows had no press feedback and said why: it "triggered while
 * scrolling and made it look like rows were being tapped". That is true of the
 * state `Pressable` hands out, which turns on the moment a finger lands.
 *
 * `unstable_pressDelay` looks like the answer and is not: during its wait the
 * gesture sits in `RESPONDER_INACTIVE_PRESS_IN`, and releasing from there goes
 * straight to `NOT_RESPONDER` without ever calling `onPressIn`. A tap quicker
 * than the delay would lose it, and the song rows use it to clear the mark a
 * long press leaves behind.
 *
 * So the delay goes on the appearance instead of on the gesture. Touch down
 * starts a fade that only begins after `motion.duration.press`; anything that
 * turns out to be a scroll is cancelled long before that, and the callbacks
 * keep firing exactly when they always did.
 */
import { useCallback } from 'react';
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/theme/motion';

/** What a pressed row fades to. The same amount the sheets use for theirs. */
const PRESSED = 0.62;

export function usePressFeedback(): {
  style: { opacity: number };
  onPressIn: () => void;
  onPressOut: () => void;
} {
  const dim = useSharedValue(1);

  const onPressIn = useCallback(() => {
    dim.set(withDelay(motion.duration.press, withTiming(PRESSED, { duration: motion.duration.press })));
  }, [dim]);

  const onPressOut = useCallback(() => {
    // Cancelled rather than reversed: while the wait is still running there is
    // nothing to come back from, and letting it play out after the finger has
    // gone is the flash this exists to avoid.
    cancelAnimation(dim);
    dim.set(withTiming(1, { duration: motion.duration.exit }));
  }, [dim]);

  const style = useAnimatedStyle(() => ({ opacity: dim.value }));
  return { style: style as unknown as { opacity: number }, onPressIn, onPressOut };
}
