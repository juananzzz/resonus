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
 * Five escape hatches, because not every sheet can be opened and drawn from
 * here: `visible` for the sheets mounted once in the root layout whose
 * visibility already lives in a store they read; `overSheet` for content that
 * belongs to the `Modal` but sits over and outside the sheet; `panEnabled` for a
 * sheet whose own list scrolls, so its dismiss-drag only has the top of it;
 * `sheetDrag` false for the sheets that place their OWN drags inside the sheet -
 * a header one and a list one, side by side so they can never both fire - and
 * `maxSheetHeight` for the one sheet that caps its own height. A sheet that
 * places its own drags takes the factory behind them: `children` receives
 * `makePan`, whose gestures drive this sheet's animation. All are optional, and
 * every sheet that opens by `openRef`, never scrolls, draws only its sheet and
 * takes no second drag passes none and is unchanged.
 */
import { type MutableRefObject, type ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { type GestureType, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';

export function SheetModal({
  openRef,
  visible,
  panEnabled,
  sheetDrag,
  maxSheetHeight,
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
   * Escape hatch, for a sheet whose own list scrolls: the drag that dismisses
   * the sheet and that scroll want the same stretch of it, so one of the two has
   * to have it, and only the sheet knows which - it reads its own scroll offset.
   * Leaving this out keeps the drag on all the time, which is what the sheets
   * whose content never scrolls want.
   */
  panEnabled?: boolean;
  /**
   * Escape hatch, for the sheets with a scrolling list AND a header: they wrap
   * their header in one drag and their list in another, side by side inside the
   * sheet, so the two can never both fire at once. Passing false means this frame
   * draws no drag of its own around the sheet (and no grabber, which belongs to
   * the header's drag); the content then takes `makePan` and places them where
   * they sit today. Leaving it out means one drag around everything.
   */
  sheetDrag?: boolean;
  /**
   * Escape hatch, for the one sheet that caps its own height (`maxHeight`): the
   * cap travels with the sheet rather than being dropped by the shared frame, so
   * the backdrop still shows above it. `maxWidth` is the frame's own and stays
   * here.
   */
  maxSheetHeight?: number | `${number}%`;
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
   *  screen, for actions that navigate away (see ArtistPickerSheet).
   *
   *  `makePan` is a factory for drags that drive THIS sheet's animation - the
   *  hook keeps them on the same `progress`, so a sheet that places its own
   *  drags (`sheetDrag={false}`) still slides, and grabs, the sheet it is in. */
  children: (
    close: (after?: () => void) => void,
    makePan: () => GestureType,
  ) => ReactNode;
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
  const { dismiss, pan, makePan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
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

  // The one sheet that caps its own height: the cap travels with the sheet, so
  // the backdrop still shows above it. The off case is a `false` entry, which is
  // what the other optional style entries in this app already are.
  const sheetCap = maxSheetHeight === undefined ? false : { maxHeight: maxSheetHeight };

  // The sheet itself, built once and wrapped in one of the two drags below: what
  // differs between those is only what is wrapped around it, so the sheet can
  // never drift apart from itself while the two cases are written out separately.
  // The grab-cue is handed in rather than drawn here, because it belongs to the
  // frame's own drag: a sheet that places its OWN drags inside (`sheetDrag={false}`)
  // draws its cue itself, inside the drag around its header.
  const sheet = (grabber?: ReactNode) => (
    <Animated.View
      style={[
        styles.sheet,
        sheetCap,
        { paddingBottom: insets.bottom + spacing.md },
        sheetStyle,
      ]}
      onLayout={onSheetLayout}
    >
      {grabber}
      {children(close, makePan)}
    </Animated.View>
  );

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
        {/* One drag around everything (the default): what goes in here is a short
            list of actions that never scrolls, so nothing else competes with it.
            A sheet that says so (`sheetDrag={false}`, and `panEnabled` for one
            whose list scrolls but is dragged only at the top) places its own
            drags inside the sheet instead - side by side, so the two can never
            both fire at once - and takes the factory that still drives THIS
            sheet's animation. */}
        {sheetDrag === false ? (
          sheet()
        ) : (
          <GestureDetector gesture={panEnabled === undefined ? pan : pan.enabled(panEnabled)}>
            {/* Spotify-style grabber: the visual cue that the sheet can be
                dragged down to dismiss. A sheet that owns its drags draws it
                itself, inside the drag around its header. */}
            {sheet(<Grabber />)}
          </GestureDetector>
        )}
      </GestureHandlerRootView>
      {/* Content that belongs to the Modal but sits over and outside the sheet -
          a confirm Dialog, the cover viewer, the calendar outside Android. It
          takes the same `close` as the sheet's content, because a choice made
          in it finishes the sheet the same way a swipe does. */}
      {overSheet?.(close)}
    </Modal>
  );
}

/**
 * The sheet's grab-cue: the visual cue that the sheet can be dragged down to
 * dismiss. This file draws it above the sheet's content, because that is where
 * its own drag is; a sheet that places its own drags draws it where ITS header
 * drag is instead - above its list, not above the sheet.
 */
export function Grabber() {
  return <View style={styles.grabber} />;
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
