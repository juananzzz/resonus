/**
 * The box a screen asks you to type into: the magnifier, the field, and the
 * button that empties it.
 *
 * Twelve screens drew that markup themselves, and what they drew was not one
 * thing but two: the bar, which is the same everywhere, and the row it sits in,
 * which is the screen's. Only the bar is taken here. The row keeps its own
 * paddings and heights (three screens put the gap to what follows inside it,
 * `TrackListView` animates the one it grows out of), the `Cancel` button that
 * some screens put under the bar stays with the screen that has it, and so does
 * the gap some screens draw where the bar used to be.
 *
 * `autoCorrect` is off and `autoCapitalize` is off because a filter is matched
 * case-insensitively: the two screens that left capitalizing to the system
 * (its own default is sentences) now stop showing you "The Beales" capitalised
 * while searching for it. `returnKeyType` is the search glyph on every screen
 * that draws this bar, so the Return key says what pressing it does even where
 * it used to look like a plain return.
 */
import { type MutableRefObject, type ReactNode } from 'react';
import { Pressable, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import { colors, fontSize, radius, restyled, spacing, themed, useTheme } from '@/theme';

const styles = themed((palette) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    backgroundColor: palette.surfaceHighlight,
    paddingHorizontal: spacing.lg,
    // A capsule with Round, a rounded rectangle with Pointier.
    borderRadius: restyled(radius.pill, radius.md),
  },
  field: { flex: 1, color: palette.text, fontSize: fontSize.md, paddingVertical: 0 },
}));

export function SearchBox({
  placeholder,
  value,
  onChangeText,
  ref,
  autoFocus,
  onFocus,
  iconSize,
  iconColor,
  after,
  style,
  fieldStyle,
}: {
  /** What the screen asks for, already spoken (`t('Find an album')`). */
  placeholder: string;
  /** The screen's own typed text; the box is a controlled component like the field. */
  value: string;
  /** How the field answers what you typed. */
  onChangeText: (text: string) => void;
  /** A screen that drives something from the field itself holds this and calls
   *  `focus()`/`blur()` on it - the Search tab's keyboard navigation. The same
   *  arrangement the frame takes for its action (`actionRef`) and the sheet for
   *  its doors (`openRef`). */
  ref?: MutableRefObject<TextInput | null>;
  /** Opened on purpose (a browse screen embedded in a tab): the keyboard that
   *  comes next is what you were already looking at. */
  autoFocus?: boolean;
  /** The screen's answer to the field taking focus, where it has one to give. */
  onFocus?: () => void;
  /** 20 where the bar is the one you tap to search the whole app, 18 in a filter. */
  iconSize?: number;
  /** The quieter tone everywhere; one step louder where the box sits on a pane. */
  iconColor?: string;
  /** What the screen wants inside the bar past the Clear button (the offline dot). */
  after?: ReactNode;
  /** The screen's own geometry of the bar: its margins, the one a row gives it. */
  style?: StyleProp<ViewStyle>;
  /** The field's own type: the smaller face inside a playlist, the air two bars keep. */
  fieldStyle?: StyleProp<TextStyle>;
}) {
  // Its own subscription to the theme: the screens around it have one, but a
  // component that reads a colour is the one that has to be told to paint again.
  useTheme();
  const t = useT();
  const tone = iconColor ?? colors.textMuted;
  const size = iconSize ?? 18;
  return (
    <View style={[styles.bar, style]}>
      <Icon name="search" size={size} color={tone} />
      <TextInput
        ref={ref}
        style={[styles.field, fieldStyle]}
        placeholder={placeholder}
        placeholderTextColor={tone}
        autoCapitalize="none"
        autoCorrect={false}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        autoFocus={autoFocus}
        returnKeyType="search"
      />
      {/* Empty there is nothing to undo, and a button you cannot use is one more
          thing on the bar. */}
      {value.length > 0 ? (
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('Clear')}
          onPress={() => onChangeText('')}
        >
          <Icon name="close-circle" size={size} color={tone} />
        </Pressable>
      ) : null}
      {after}
    </View>
  );
}
