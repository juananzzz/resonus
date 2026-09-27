/**
 * Shared pieces for the Settings screen and its sub-screens: rows inside
 * rounded boxes (surface on background, more readable), with the description
 * in gray inside the row, a switch on the right, and selectors that open a
 * compact floating menu.
 */
import Icon from '@/components/Icon';
import Slider from '@react-native-community/slider';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAccent } from '@/hooks/useAccent';
import { CONTENT_MAX_WIDTH } from '@/hooks/useScreenSize';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING, themed, tracking } from '@/theme';
import { BackChevron } from './BackChevron';

/**
 * The frame every settings screen sits in.
 *
 * The inset is read and applied here rather than left to a `SafeAreaView`:
 * that one pads itself once its own native view has been measured, so the
 * first frame of a screen is drawn without it and corrects a frame later —
 * which is a title that lands slightly low and hops. "Your library" and
 * Explore already read it by hand for the same reason; this is the rest of
 * the app catching up. The context has the number long before any of this,
 * so the first frame is the right one.
 */
export function SettingsSafeArea({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[settingsStyles.safe, { paddingTop: insets.top }]}>{children}</View>;
}

/** Header with back arrow and centered title. `back={false}` for a screen that
 *  is a tab, with nowhere to go back to. */
export function ScreenHeader({ title, back = true }: { title: string; back?: boolean }) {
  return (
    <View style={settingsStyles.header}>
      {back ? <BackChevron size={28} /> : <View style={{ width: 28 }} />}
      <Text style={settingsStyles.headerTitle}>{title}</Text>
      <View style={{ width: 28 }} />
    </View>
  );
}

/**
 * Settings screen container (safe-area + header).
 *
 * The settings stop growing at a reading measure and sit in the middle of
 * anything wider, which is every one of these screens at once: a switch whose
 * label is at one edge of a tablet and whose switch is at the other is a row
 * you have to look twice at to pair up (#131). The header is left across the
 * full width, where the way back belongs.
 */
export function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SettingsSafeArea>
      <ScreenHeader title={title} />
      <View style={settingsStyles.pane}>{children}</View>
    </SettingsSafeArea>
  );
}

/**
 * Flat settings row: white label, gray description below, and whatever goes
 * on the right (chevron with `onPress`, `right` text, or both).
 */
export function SettingRow({
  label,
  description,
  icon,
  right,
  chevron,
  destructive,
  onPress,
}: {
  label: string;
  description?: string;
  /**
   * Left icon: used by ACTION rows (scan, clear…) to visually stand out from
   * read-only data rows.
   */
  icon?: keyof typeof Icon.glyphMap;
  /** Gray text on the right (current value, "Coming soon"…). */
  right?: string;
  /** Right arrow: only for rows that navigate to another screen. */
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      {icon ? (
        <Icon name={icon} size={20} color={destructive ? colors.danger : colors.text} />
      ) : null}
      <View style={settingsStyles.rowLabelBox}>
        <Text style={[settingsStyles.rowLabel, destructive && { color: colors.danger }]}>
          {label}
        </Text>
        {description ? <Text style={settingsStyles.rowDescription}>{description}</Text> : null}
      </View>
      {right ? <Text style={settingsStyles.rowValue}>{right}</Text> : null}
      {chevron ? <Icon name="chevron-forward" size={20} color={colors.textMuted} /> : null}
    </>
  );
  if (!onPress) {
    return <View style={[settingsStyles.cardBox, settingsStyles.row]}>{body}</View>;
  }
  return (
    <Pressable
      style={({ pressed }) => [
        settingsStyles.cardBox,
        settingsStyles.row,
        pressed && { opacity: 0.6 },
      ]}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

/** Minimum height of each floating menu option (grows if the label wraps). */
const MENU_ITEM_H = 42;

/**
 * Compact "choose one" selector: a single row with the current value ("Streaming
 * quality · Original ⌄") that opens a small floating menu anchored to the right
 * (Android-style dropdown) with the options; choosing one closes it. With
 * `collapsible: false` it renders as a visible radio list (e.g. Language screen).
 * Labels come already translated from the caller.
 *
 * `disabled` greys the row out and stops it opening: for a setting that another
 * one above has left with nothing to do (the transcode codec when the quality
 * is "Original"). It stays visible so it can still be found, and
 * `disabledLabel` replaces the value, because a greyed-out "OPUS" still reads
 * as if something were being transcoded to Opus.
 */
export function SelectList<T extends string | number | boolean>({
  options,
  value,
  onChange,
  label,
  description,
  collapsible = true,
  disabled = false,
  disabledLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  description?: string;
  collapsible?: boolean;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const accent = useAccent();
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  // The row's position on screen (measured on open) and the menu's natural
  // height (measured on render): with both we anchor exactly, flush to the row.
  const [anchor, setAnchor] = useState<{ y: number; h: number } | null>(null);
  const [menuH, setMenuH] = useState(0);
  const rowRef = useRef<View>(null);
  const active = options.find((o) => o.value === value) ?? options[0];

  function openMenu() {
    // `measureInWindow` and the Modal share an origin, the top of the screen:
    // the window runs edge to edge and the Modal is `statusBarTranslucent`. It
    // did not always: before edge-to-edge the window began under the status bar
    // and the row's `y` had to have `insets.top` added to it to reach the
    // Modal's space. Adding it now moves the menu down by a status bar.
    rowRef.current?.measureInWindow((_x, y, _w, h) => setAnchor({ y, h }));
  }

  /**
   * Places the menu flush to the row: below if it fits, otherwise above.
   *
   * Everything is in screen coordinates (the Modal's and `frame`'s); the
   * row's `y` already comes converted from `openMenu`. The limits come from
   * the safe-area frame and not from `Dimensions.get('window')`, which is a
   * different space and would trigger the "doesn't fit" check too early.
   *
   * Also returns the available space on the chosen side as a height cap: with
   * the menu capped (and scrollable) there's always a position flush to the
   * row, so we never need to detach it to the screen edge.
   */
  function menuLayout(a: { y: number; h: number }, mh: number): { top: number; maxHeight: number } {
    const limitTop = insets.top + spacing.sm;
    const limitBottom = frame.height - insets.bottom - spacing.sm;
    const belowTop = a.y + a.h - spacing.xs; // flush below the row
    const aboveBottom = a.y + spacing.xs; // flush above the row
    const roomBelow = limitBottom - belowTop;
    const roomAbove = aboveBottom - limitTop;
    // Below if it fits; if not, above if it fits; if neither, the side with
    // more room (the scroll handles the rest).
    const useBelow = mh <= roomBelow || (mh > roomAbove && roomBelow >= roomAbove);
    if (useBelow) return { top: belowTop, maxHeight: Math.max(0, roomBelow) };
    return { top: aboveBottom - Math.min(mh, roomAbove), maxHeight: Math.max(0, roomAbove) };
  }

  if (!collapsible) {
    return (
      <View style={settingsStyles.cardBox}>
        {options.map((opt, i) => {
          const isActive = opt.value === value;
          return (
            <Pressable
              key={String(opt.value)}
              style={({ pressed }) => [
                settingsStyles.row,
                i > 0 && settingsStyles.rowBorder,
                pressed && { opacity: 0.6 },
              ]}
              onPress={() => {
                if (!isActive) onChange(opt.value);
              }}
            >
              <Text style={[settingsStyles.rowLabel, { flex: 1 }]}>{opt.label}</Text>
              <Icon
                name={isActive ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={isActive ? accent : colors.textMuted}
              />
            </Pressable>
          );
        })}
      </View>
    );
  }

  const menu = anchor != null ? menuLayout(anchor, menuH) : null;

  return (
    <>
      <Pressable
        ref={rowRef}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={({ pressed }) => [
          settingsStyles.cardBox,
          settingsStyles.row,
          // Dimming the whole row, not recolouring the label: the muted colour
          // is the description's own, so label and description came out the
          // same and the row lost the hierarchy the others keep.
          disabled && { opacity: 0.5 },
          pressed && !disabled && { opacity: 0.6 },
        ]}
        onPress={openMenu}
      >
        <View style={settingsStyles.rowLabelBox}>
          <Text style={settingsStyles.rowLabel}>{label ?? active?.label}</Text>
          {description ? <Text style={settingsStyles.rowDescription}>{description}</Text> : null}
        </View>
        {label ? (
          <Text style={settingsStyles.rowValue}>
            {disabled ? (disabledLabel ?? active?.label) : active?.label}
          </Text>
        ) : null}
        {/* No arrow on a row that cannot open, but its width stays: otherwise
            the value would sit flush to the edge and break the column the rows
            above and below line up in. */}
        {disabled ? (
          <View style={{ width: 18 }} />
        ) : (
          <Icon name="chevron-down" size={18} color={colors.textMuted} />
        )}
      </Pressable>

      {/* `statusBarTranslucent` makes the Modal full-screen, which is the space
          `menuLayout`'s math is done in (same space as `useSafeAreaFrame`). */}
      <Modal
        transparent
        statusBarTranslucent
        animationType="fade"
        visible={anchor != null}
        onRequestClose={() => setAnchor(null)}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setAnchor(null)} />
        {menu != null ? (
          <View
            // Invisible on the first frame (before height is measured): avoids
            // seeing it jump when it opens upward.
            style={[
              settingsStyles.menu,
              // Cap the width so a very long label can't push the menu off the
              // left edge (it's anchored to the right); below the cap it hugs
              // its content and only wraps past it.
              {
                top: menu.top,
                maxHeight: menu.maxHeight,
                maxWidth: frame.width - spacing.lg * 2,
                opacity: menuH > 0 ? 1 : 0,
              },
            ]}
          >
            <ScrollView
              // The height is measured here and not via `onLayout` on the menu:
              // with a cap, `onLayout` would return the already-clipped
              // height and feed back on itself. The content size is the natural
              // size, which is what we need to compare with the available space.
              // We add the menu's padding, which lies outside the ScrollView.
              onContentSizeChange={(_w, h) => setMenuH(h + spacing.sm * 2)}
              // Only scrolls if the menu doesn't fit in full; if it fits, it's invisible.
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              {options.map((opt) => {
                const isActive = opt.value === value;
                return (
                  <Pressable
                    key={String(opt.value)}
                    style={({ pressed }) => [settingsStyles.menuItem, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                      setAnchor(null);
                      if (!isActive) onChange(opt.value);
                    }}
                  >
                    <Text style={[settingsStyles.menuItemText, isActive && { color: accent }]}>
                      {opt.label}
                    </Text>
                    {isActive ? <Icon name="checkmark" size={18} color={accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

/**
 * Row with a slider below (Spotify crossfade style): label and current value
 * on top, slider bar below. The shown value tracks the finger while dragging;
 * the change is applied on release.
 */
export function SliderRow({
  label,
  description,
  value,
  min = 0,
  max,
  step = 1,
  formatValue,
  fineTune,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  /** Greys the row out and stops it moving, for a setting that another one
   *  above it has turned off. Same as `SelectList`'s. */
  disabled?: boolean;
  /** Text for the current value (already translated by the caller). */
  formatValue: (value: number) => string;
  /**
   * Makes the value tappable: it opens a pad with up/down arrows that move it
   * by `step`, finer than the slider's own. `doneLabel` closes the pad and
   * comes from the caller because this file translates nothing.
   */
  fineTune?: { step: number; doneLabel: string };
  onChange: (value: number) => void;
}) {
  const accent = useAccent();
  const [live, setLive] = useState<number | null>(null);
  const [tuning, setTuning] = useState(false);
  const shown = live ?? value;

  return (
    <View style={[settingsStyles.cardBox, disabled && { opacity: 0.5 }]}>
      <View style={[settingsStyles.row, { paddingBottom: 0 }]}>
        <View style={settingsStyles.rowLabelBox}>
          <Text style={settingsStyles.rowLabel}>{label}</Text>
          {description ? <Text style={settingsStyles.rowDescription}>{description}</Text> : null}
        </View>
        {fineTune && !disabled ? (
          // The double chevron is the whole hint that the number opens
          // something: same grey as the value, and the same idea as the arrow
          // a SelectList row carries, which is where anyone reading this
          // screen has already learnt what it means.
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            style={({ pressed }) => [settingsStyles.tunableValue, pressed && { opacity: 0.6 }]}
            onPress={() => setTuning(true)}
          >
            <Text style={settingsStyles.rowValue}>{formatValue(shown)}</Text>
            {/* Two separate icons rather than `chevron-expand`, whose pair sits
                too tight to read as two directions at a glance. */}
            <View style={settingsStyles.tunableArrows}>
              <Icon name="chevron-up" size={12} color={colors.textMuted} />
              <Icon
                name="chevron-down"
                size={12}
                color={colors.textMuted}
                style={{ marginTop: -1 }}
              />
            </View>
          </Pressable>
        ) : (
          <Text style={settingsStyles.rowValue}>{formatValue(shown)}</Text>
        )}
      </View>
      {fineTune ? (
        <FineTunePad
          visible={tuning}
          title={label}
          value={value}
          min={min}
          max={max}
          step={fineTune.step}
          doneLabel={fineTune.doneLabel}
          formatValue={formatValue}
          onChange={onChange}
          onClose={() => setTuning(false)}
        />
      ) : null}
      <Slider
        style={settingsStyles.slider}
        disabled={disabled}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={setLive}
        onSlidingComplete={(v) => {
          setLive(null);
          onChange(v);
        }}
        minimumTrackTintColor={accent}
        maximumTrackTintColor={colors.control}
        thumbTintColor={colors.knob}
      />
    </View>
  );
}

/**
 * Little pad that opens over a slider's value to nudge it one small step at a
 * time, for the last tenths a finger can't land on. Holding an arrow repeats,
 * and after a moment it moves in fives so crossing the whole range is still a
 * few seconds and not a minute.
 *
 * The store only hears about it when the finger lifts: while an arrow repeats
 * this is one value per tick, and every one of them would be written to disk.
 */
function FineTunePad({
  visible,
  title,
  value,
  min,
  max,
  step,
  doneLabel,
  formatValue,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  doneLabel: string;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
  onClose: () => void;
}) {
  const accent = useAccent();
  const [draft, setDraft] = useState(value);
  /** The same value, readable from inside the repeat timer. */
  const draftRef = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Which arrow the finger is on, 0 for none. Every tick checks it before
   * moving anything: a press repeats around ten times a second, each one a
   * re-render inside a Modal, and that is exactly the situation where a
   * release event goes missing and the value walks off on its own.
   */
  const holding = useRef(0);

  /** Last value handed to the store, so the same one is never saved twice. */
  const saved = useRef(value);

  // Opens on whatever the setting is now, which may have moved on the slider.
  useEffect(() => {
    if (!visible) return;
    setDraft(value);
    draftRef.current = value;
    saved.current = value;
  }, [visible, value]);

  useEffect(() => () => stopTimer(), []);

  function stopTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  /** Moves the draft and says whether it actually had anywhere to go. */
  function nudge(direction: number, amount: number): boolean {
    const next = Math.min(Math.max(draftRef.current + direction * amount, min), max);
    // Tenths add up in binary to things like 4.300000000000001.
    const clean = Math.round(next * 100) / 100;
    if (clean === draftRef.current) return false;
    draftRef.current = clean;
    setDraft(clean);
    return true;
  }

  /**
   * One step now and the next one scheduled, over and over while the finger
   * stays down: a chain of timeouts instead of an interval, so two ticks can
   * never overlap and there is only ever one timer to cancel. After a couple of
   * seconds it moves in threes, enough to cross the range without the value
   * running away in the first instant.
   */
  function tick(direction: number, count: number) {
    if (holding.current !== direction) return;
    const moved = nudge(direction, count > 15 ? step * 3 : step);
    // Nothing left at the end of the range, and nobody else is going to stop
    // a timer that keeps firing under a finger that is still down.
    if (!moved || count > 200) return;
    timer.current = setTimeout(() => tick(direction, count + 1), count === 0 ? 400 : 110);
  }

  function hold(direction: number) {
    stopTimer(); // a press that never got its release doesn't get to linger
    holding.current = direction;
    tick(direction, 0);
  }

  /** Nothing is saved until the finger lifts (or the pad closes). */
  function release() {
    holding.current = 0;
    stopTimer();
    if (draftRef.current === saved.current) return;
    saved.current = draftRef.current;
    onChange(draftRef.current);
  }

  function close() {
    release();
    onClose();
  }

  // Greyed out at the end of the range, but never `disabled`: turning that on
  // mid-press swallows the release, and with it the only chance to save.
  const arrow = (direction: number, icon: 'chevron-up' | 'chevron-down') => {
    const spent = direction > 0 ? draft >= max : draft <= min;
    return (
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [settingsStyles.padArrow, pressed && { opacity: 0.6 }]}
        onPressIn={() => hold(direction)}
        onPressOut={release}
        // Belt and braces over the same release: `release` is idempotent, and
        // the touch events land even when Pressability loses track of the
        // gesture, which is what left the value climbing on its own.
        onTouchEnd={release}
        onTouchCancel={release}
      >
        <Icon name={icon} size={28} color={spent ? colors.textMuted : colors.text} />
      </Pressable>
    );
  };

  return (
    <Modal transparent statusBarTranslucent visible={visible} animationType="fade" onRequestClose={close}>
      <Pressable style={settingsStyles.padBackdrop} onPress={close} />
      <View style={settingsStyles.padCenter} pointerEvents="box-none">
        <View style={settingsStyles.padCard}>
          <Text style={settingsStyles.padTitle}>{title}</Text>
          {arrow(1, 'chevron-up')}
          <Text style={settingsStyles.padValue}>{formatValue(draft)}</Text>
          {arrow(-1, 'chevron-down')}
          <Pressable hitSlop={8} style={settingsStyles.padDone} onPress={close}>
            <Text style={[settingsStyles.padDoneLabel, { color: accent }]}>{doneLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Group of toggles, one per row, with inline help text. */
export function SwitchList({
  options,
}: {
  options: {
    label: string;
    description?: string;
    value: boolean;
    onChange: (value: boolean) => void;
    /**
     * Greys the row out and stops the switch moving, for a setting that has
     * nothing to do in the mode you are in. It stays where it always is, so
     * looking for it is not a search that ends in nothing (#114).
     */
    disabled?: boolean;
  }[];
}) {
  const accent = useAccent();
  return (
    <View style={settingsStyles.cardBox}>
      {options.map((opt, i) => (
        // The whole row and not the switch alone. A switch is a small thing to
        // hit with a thumb, and it sits at the far edge of the screen, which on
        // a tall phone is the hardest corner to reach one-handed: the label is
        // the part being aimed at anyway. It is one control, so it also reads
        // as one to a screen reader, and the switch inside stops announcing
        // itself separately.
        <Pressable
          key={opt.label}
          disabled={opt.disabled}
          onPress={() => opt.onChange(!opt.value)}
          accessibilityRole="switch"
          accessibilityLabel={opt.label}
          accessibilityHint={opt.description}
          accessibilityState={{ checked: opt.value, disabled: !!opt.disabled }}
          style={({ pressed }) => [
            settingsStyles.row,
            i > 0 && settingsStyles.rowBorder,
            // The whole row, not the label alone: see `SelectList`.
            opt.disabled && { opacity: 0.5 },
            pressed && { opacity: 0.6 },
          ]}
        >
          <View style={settingsStyles.rowLabelBox}>
            <Text style={settingsStyles.rowLabel}>{opt.label}</Text>
            {opt.description ? (
              <Text style={settingsStyles.rowDescription}>{opt.description}</Text>
            ) : null}
          </View>
          <Switch
            value={opt.value}
            onValueChange={opt.onChange}
            disabled={opt.disabled}
            trackColor={{ false: colors.control, true: accent }}
            thumbColor={colors.knob}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </Pressable>
      ))}
    </View>
  );
}

/** Label/value pair for read-only data. */
/**
 * Row with an editable text field. The character counter only appears near the
 * limit: when there's plenty of space it's noise, not information.
 */
export function TextRow({
  label,
  description,
  value,
  placeholder,
  maxLength,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  maxLength: number;
  onChange: (v: string) => void;
}) {
  const accent = useAccent();
  const near = value.length >= maxLength - 3;
  return (
    <View style={[settingsStyles.cardBox, settingsStyles.textRow]}>
      <View style={settingsStyles.textRowTop}>
        <View style={settingsStyles.rowLabelBox}>
          <Text style={settingsStyles.rowLabel}>{label}</Text>
          {description ? <Text style={settingsStyles.rowDescription}>{description}</Text> : null}
        </View>
        {near ? (
          <Text style={[settingsStyles.rowValue, { color: accent }]}>
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
      <TextInput
        style={settingsStyles.textInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        maxLength={maxLength}
        autoCorrect={false}
        returnKeyType="done"
      />
    </View>
  );
}

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={[settingsStyles.cardBox, settingsStyles.field]}>
      <Text style={settingsStyles.fieldLabel}>{label}</Text>
      <Text style={settingsStyles.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export const settingsStyles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: SCREEN_BOTTOM_PADDING },
  /** Where the settings themselves live, centred once there is room to spare. */
  pane: { flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  // Spotify-style group title: bold, light, with air above.
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
  },
  // A division inside a section, for when the same settings come in more than
  // one set (streaming, once per network). Quieter than `sectionTitle` and with
  // less air above it, so it reads as belonging to the title above rather than
  // competing with it.
  groupTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  // Rounded box on the background (rows live inside, more readable).
  cardBox: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  // A hairline that starts where the text does: the row trades its left
  // padding for a margin, so the content stays put and the line is inset.
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.highlight,
    marginLeft: spacing.lg,
    paddingLeft: 0,
  },
  rowLabel: { color: colors.text, fontSize: fontSize.md },
  /**
   * Label side of a settings row. The `minWidth` is what keeps it alive: with a
   * zero flex basis it can't claim any space of its own, so a long value on the
   * right took the whole row and left it wrapping one letter per line.
   *
   * A floor here rather than a cap on the value, so the split isn't fixed: a
   * short value takes only what it needs and the label gets the rest, while a
   * long one can stretch to 60% before the label starts pushing back.
   */
  rowLabelBox: { flex: 1, minWidth: '40%' },
  rowDescription: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  /**
   * The value on the right of a settings row. `flexShrink` is 0 by default in
   * React Native, so without this a long value never gave way; it wraps onto
   * several lines instead, right-aligned so the lines stay flush to the edge.
   * The label's `minWidth` is what stops it from taking the whole row.
   */
  rowValue: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    flexShrink: 1,
    textAlign: 'right',
  },
  textRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.sm },
  textRowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  textInput: {
    color: colors.text,
    fontSize: fontSize.md,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  slider: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    height: 32,
  },
  // A slider value that opens the pad: the number keeps its own style and the
  // chevron sits next to it, shrinking last so the number never gets clipped.
  tunableValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  tunableArrows: { alignItems: 'center' },
  // Pad that nudges a slider's value one step at a time.
  padBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdropStrong },
  padCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  padCard: {
    minWidth: 200,
    alignItems: 'center',
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    elevation: 8,
    shadowColor: colors.shadow,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  padTitle: { color: colors.textSecondary, fontSize: fontSize.sm },
  // Wide enough for the whole range, so the arrows don't shift as digits and
  // signs come and go under them.
  padValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '500',
    minWidth: 120,
    textAlign: 'center',
  },
  padArrow: { paddingVertical: spacing.xs, paddingHorizontal: spacing.xl },
  padDone: { alignSelf: 'flex-end', marginTop: spacing.sm },
  padDoneLabel: { fontSize: fontSize.md, fontWeight: '600' },
  // Floating menu anchored to the right (Android-style dropdown).
  menu: {
    position: 'absolute',
    right: spacing.lg,
    minWidth: 170,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    elevation: 8,
    shadowColor: colors.shadow,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    // space-between keeps the check pinned to the right edge now that the text
    // no longer flex-grows to fill the row (see menuItemText).
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    // minHeight (not a fixed height) so options whose label wraps to several
    // lines grow instead of clipping; the vertical padding keeps them readable.
    minHeight: MENU_ITEM_H,
    paddingVertical: spacing.sm,
  },
  // flexShrink (not flex: 1, whose flex-basis:0 collapses the text and wraps it
  // aggressively): the menu hugs the widest label instead of squeezing it.
  menuItemText: { color: colors.text, fontSize: fontSize.sm, flexShrink: 1 },
  field: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs, marginBottom: 2 },
  fieldValue: { color: colors.text, fontSize: fontSize.md },
  // Centered white pill button (Spotify's "Log out").
  pillButton: {
    alignSelf: 'center',
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl + spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  pillButtonText: { color: colors.onInverse, fontSize: fontSize.md, fontWeight: '600' },
}));
