/**
 * Self-contained bottom sheet: its visibility lives here and is opened
 * imperatively via `openRef`, so showing/hiding it does NOT re-render the
 * screen (with its list) that declares it — with state in the screen, opening
 * the menu had a noticeable delay. The content comes as a function receiving
 * `close` to close after choosing an action.
 *
 * Slides up and down and closes with a swipe, like the song menu: these menus
 * open the same way and from the same ⋯, so they behave the same way too.
 *
 * Two escape hatches, because not every sheet can be opened and drawn from
 * here: `visible` for the sheets mounted once in the root layout whose
 * visibility already lives in a store they read, and `overSheet` for content
 * that belongs to the `Modal` but sits over and outside the sheet. Both are
 * optional, and every sheet that opens by `openRef` and draws only its sheet
 * passes neither and is unchanged. What is left over is a sheet that needs a
 * second gesture - the hook hands out `makePan` for that, but this frame owns
 * only one, so those sheets stay their own.
 */
import { type MutableRefObject, type ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';

export function SheetModal({
  openRef,
  visible,
  overSheet,
  onClosed,
  children,
}: {
  /** The screen holds a ref and calls `openRef.current()` to open. */
  openRef?: MutableRefObject<() => void>;
  /**
   * Escape hatch, for the sheets mounted once in the root layout whose
   * visibility already lives somewhere the caller reads (a store, say) rather
   * than in a screen that can call a ref. Opening follows the caller; the sheet
   * still slides out, and `onClosed` is where the caller flips what it reads -
   * that is what keeps the `Modal` up for the length of the animation, exactly
   * as the hand-drawn sheets do it today.
   */
  visible?: boolean;
  /**
   * Escape hatch, for the content that belongs to the `Modal` but sits **over
   * and outside** the sheet — a confirm `Dialog`, the cover viewer, the
   * calendar on every platform but Android. Leaving it out is the common case;
   * drawing it inside the sheet instead changes the layering and slides it with
   * the sheet, which is what the sheets that carry one avoid.
   *
   * It takes the same `close` as the sheet's content because those actions
   * finish a choice the same way a swipe does.
   */
  overSheet?: (close: (after?: () => void) => void) => ReactNode;
  /** Runs once the sheet is off screen, however it was closed. */
  onClosed?: () => void;
  /** `close()` closes the sheet; `close(after)` runs `after` once it is off
   *  screen, for actions that navigate away (see ArtistPickerSheet). */
  children: (close: (after?: () => void) => void) => ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [openByRef, setOpenByRef] = useState(false);
  if (openRef) openRef.current = () => setOpenByRef(true);
  // Either this component opened the sheet itself, or the caller says it is on.
  // A caller-driven close still runs the slide-out below: the caller flips what
  // it reads only once the sheet is off screen, which is what keeps the Modal
  // up for the length of the animation.
  const shown = openByRef || !!visible;

  const closeNow = () => {
    setOpenByRef(false);
    onClosed?.();
  };
  const { dismiss, pan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    shown,
    closeNow,
  );
  // The sheet slides down and only then is the Modal dismissed. Actions close
  // through here, so choosing one looks the same as swiping it away.
  const close = (after?: () => void) =>
    dismiss(() => {
      closeNow();
      after?.();
    });

  return (
    <Modal
      transparent
      animationType="none"
      visible={shown}
      onRequestClose={() => close()}
    >
      {/* Gestures inside an RN Modal need a root view of their own: the Modal
          renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />
        </Animated.View>
        {/* One drag around everything: what goes in here is a short list of
            actions that never scrolls, so nothing else competes for the
            gesture (the song menu needs two because its list does scroll). */}
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
            onLayout={onSheetLayout}
          >
            {/* Spotify-style grabber: the visual cue that the sheet can be
                dragged down to dismiss. */}
            <View style={styles.grabber} />
            {children(close)}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
      {/* Content that belongs to the Modal but sits over and outside the sheet -
          a confirm Dialog, the cover viewer, the calendar outside Android. It
          takes the same `close` as the sheet's content, because a choice made
          in it finishes the sheet the same way a swipe does. */}
      {overSheet?.(close)}
    </Modal>
  );
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    // Smaller than the old spacing.lg because the grabber below already brings
    // its own margin: together they add up to the same top gap as before.
    paddingTop: spacing.sm,
  },
  // Spotify's little handle. Its only job is to advertise the drag gesture, so
  // it stays discreet: it must read as an affordance, not as a control.
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
}));
