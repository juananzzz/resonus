/**
 * The little "E" next to a title: the file is tagged as explicit.
 *
 * Only the explicit case gets a badge. Servers also report "clean" (a censored
 * edit) and that is worth reading in the song information sheet, but a mark on
 * every row for the absence of swearing is not what anyone is scanning a list
 * for. Nothing at all is what a track with no advisory tag shows, which is most
 * of them.
 *
 * Switched off from Settings › Appearance › Lists & albums, and the switch is read
 * here rather than by each of the eight places that draw one, so there is no
 * screen left to remember to check.
 */
import { Text, View } from 'react-native';

import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { radius, themed } from '@/theme';

/**
 * Whether the badge would draw anything at all.
 *
 * Rows ask before they lay themselves out: the badge shares its line with the
 * artist name, and a row with no artist must not keep an empty line open for a
 * badge that is turned off.
 */
export function useExplicitBadge(status?: string): boolean {
  const show = useSettings((s) => s.showExplicitTag);
  return show && status === 'explicit';
}

export function ExplicitBadge({ status }: { status?: string }) {
  const t = useT();
  const visible = useExplicitBadge(status);
  if (!visible) return null;
  return (
    <View style={styles.badge} accessibilityLabel={t('Explicit')}>
      <Text style={styles.letter} allowFontScaling={false}>
        E
      </Text>
    </View>
  );
}

const styles = themed((colors) => ({
  // A filled square rather than an outlined one: it has to read at 14 px next
  // to text it must not compete with, and a hairline box that size turns to
  // mush on a low-density screen.
  badge: {
    width: 14,
    height: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `allowFontScaling` off on the letter above: the box is a fixed size, and a
  // reader with large text turned on would get an E cropped by its own badge.
  letter: {
    color: colors.background,
    // Smaller than anything in the scale, because the box is smaller than
    // anything the scale was written for.
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 14,
  },
}));
