/**
 * Shared pieces for the Settings screen and its sub-screens: rows inside
 * rounded boxes (surface on background, more readable), with the description
 * in gray inside the row, a switch on the right, and selectors that open a
 * compact floating menu.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
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
import { SafeAreaView, useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

/**
 * Live accent, read from the store instead of the global constant.
 *
 * `colors.accent` is mutated when choosing another accent, but that alone
 * doesn't repaint anything: Settings screens mounted below the selector
 * don't notice and keep showing the previous color until you exit and
 * re-enter. Subscribing here repaints everything at once.
 */
function useAccent(): string {
  return useSettings((s) => s.accentColor);
}

/** Header with back arrow and centered title. */
export function ScreenHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={settingsStyles.header}>
      <Pressable hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </Pressable>
      <Text style={settingsStyles.headerTitle}>{title}</Text>
      <View style={{ width: 28 }} />
    </View>
  );
}

/** Settings screen container (safe-area + header). */
export function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={settingsStyles.safe} edges={['top']}>
      <ScreenHeader title={title} />
      {children}
    </SafeAreaView>
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
  icon?: keyof typeof Ionicons.glyphMap;
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
        <Ionicons name={icon} size={20} color={destructive ? colors.danger : colors.text} />
      ) : null}
      <View style={settingsStyles.rowLabelBox}>
        <Text style={[settingsStyles.rowLabel, destructive && { color: colors.danger }]}>
          {label}
        </Text>
        {description ? <Text style={settingsStyles.rowDescription}>{description}</Text> : null}
      </View>
      {right ? <Text style={settingsStyles.rowValue}>{right}</Text> : null}
      {chevron ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null}
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
    // `measureInWindow` measures from the window content, i.e. BELOW the status
    // bar, while the Modal renders full-screen from the very top. These are two
    // different origins separated by exactly `insets.top`, and not adding it
    // placed the menu that distance too high. We convert here, once, so the rest
    // of the calculation lives entirely in screen coordinates (which is what
    // `frame` uses).
    rowRef.current?.measureInWindow((_x, y, _w, h) => setAnchor({ y: y + insets.top, h }));
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
              <Ionicons
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
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
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
                    {isActive ? <Ionicons name="checkmark" size={18} color={accent} /> : null}
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
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  /** Text for the current value (already translated by the caller). */
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const accent = useAccent();
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  return (
    <View style={settingsStyles.cardBox}>
      <View style={[settingsStyles.row, { paddingBottom: 0 }]}>
        <View style={settingsStyles.rowLabelBox}>
          <Text style={settingsStyles.rowLabel}>{label}</Text>
          {description ? <Text style={settingsStyles.rowDescription}>{description}</Text> : null}
        </View>
        <Text style={settingsStyles.rowValue}>{formatValue(shown)}</Text>
      </View>
      <Slider
        style={settingsStyles.slider}
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
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.text}
      />
    </View>
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
  }[];
}) {
  const accent = useAccent();
  return (
    <View style={settingsStyles.cardBox}>
      {options.map((opt, i) => (
        <View key={opt.label} style={[settingsStyles.row, i > 0 && settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowLabelBox}>
            <Text style={settingsStyles.rowLabel}>{opt.label}</Text>
            {opt.description ? (
              <Text style={settingsStyles.rowDescription}>{opt.description}</Text>
            ) : null}
          </View>
          <Switch
            value={opt.value}
            onValueChange={opt.onChange}
            trackColor={{ false: colors.border, true: accent }}
            thumbColor={colors.text}
          />
        </View>
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

export const settingsStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: SCREEN_BOTTOM_PADDING },
  // Spotify-style group title: bold, light, with air above.
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
  },
  // Rounded box on the background (rows live inside, more readable).
  cardBox: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
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
  // Floating menu anchored to the right (Android-style dropdown).
  menu: {
    position: 'absolute',
    right: spacing.lg,
    minWidth: 170,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    elevation: 8,
    shadowColor: '#000',
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
  pillButtonText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
});
