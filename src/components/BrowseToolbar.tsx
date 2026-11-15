/**
 * The row that sits between a browse list and its search box: what the list is
 * ordered by on the left, and what it is held to on the right, drawn to the
 * edge so the row reads as its two ends.
 *
 * It replaced a scrolling row of order pills, and the reason is what the pills
 * left behind: as pills the order was a second scrolling row of the same shape
 * as the tab's chips of sections, which made the two hard to tell apart at a
 * glance. The order is spelled out next to the icon rather than hidden behind
 * it, the way the Library tab writes it, so nothing is lost by the menu: what
 * the list is sorted by is still readable without opening anything.
 *
 * The two toggles on the right are the section's filters, and both are optional
 * — a section that has nothing to heart or nothing to hold to downloaded draws
 * no icon that would do nothing. Each says what it is to the finger as well
 * (see `accessibilityState`), and they condition each other on the same row:
 * hearted and downloaded together is the intersection, the two questions asked
 * of one list rather than one after the other.
 */
import Icon from '@/components/Icon';
import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SortSheet } from '@/components/SortSheet';
import { useAccent } from '@/hooks/useAccent';
import { useT } from '@/i18n';
import { colors, fontSize, spacing, themed } from '@/theme';

export function BrowseToolbar<T extends string>({
  options,
  value,
  onChange,
  download,
  favorite,
  ordering,
}: {
  /** In the order they should be shown; the label is a translation key. One of
   *  them, or none, is not a choice, and then no control is drawn. */
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** The filters the row holds the list to, each with whether it is on and how
   *  a press says otherwise. Left out by a section that has nothing of that
   *  kind — an icon that would do nothing is worse than no icon. */
  download?: { on: boolean; toggle: () => void };
  favorite?: { on: boolean; toggle: () => void };
  /** Whether the order is the list's to offer at all. The search answer comes
   *  back by relevance, so the sheet would offer orders the list is not in —
   *  while the two filters still hold it, and their presses belong where the
   *  finger already found them. */
  ordering?: boolean;
}) {
  const t = useT();
  const accent = useAccent();
  const sortRef = useRef<() => void>(() => {});

  const current = options.find((o) => o.key === value);
  const showOrder = ordering !== false && options.length > 1 && !!current;

  return (
    // A row with nothing to draw goes without its padding: a screen that
    //  searches and has no filters of its own would otherwise leave a 12 dp
    //  band there, and the list under it would jump when the box opens.
    <View style={showOrder || download || favorite ? styles.row : undefined}>
      {!showOrder ? (
        <View />
      ) : (
        <Pressable
          style={styles.sort}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('Sort')}
          onPress={() => sortRef.current()}
        >
          <Icon name="swap-vertical" size={18} color={colors.textSecondary} />
          <Text style={styles.sortText} numberOfLines={1}>
            {t(current.label)}
          </Text>
        </Pressable>
      )}

      {download || favorite ? (
        <View style={styles.filters}>
          {download ? (
            <Pressable
              // The two claims must not overlap: the icons are 22 dp wide and
              //  sit `gap.lg` apart, so the slops may add up to that 16 dp and
              //  no more. Hit-testing takes the later sibling first, and a
              //  slop of 12 would have the heart reach 8 dp into the ↓'s half —
              //  a tap aimed between the two would pick the wrong filter.
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityLabel={t('Only downloaded')}
              accessibilityState={{ checked: download.on }}
              onPress={download.toggle}
            >
              {/* The ↓ the rows wear on what is on the phone, filled when the
                  filter is on and its outline while it is not — the same
                  language the heart next to it answers in. */}
              <Icon
                name={download.on ? 'arrow-down-circle' : 'arrow-down-circle-outline'}
                size={22}
                color={download.on ? accent : colors.textSecondary}
              />
            </Pressable>
          ) : null}
          {favorite ? (
            <Pressable
              // Same rule as the ↓: see the note above about the two claims.
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityLabel={t('Only favorited')}
              accessibilityState={{ checked: favorite.on }}
              onPress={favorite.toggle}
            >
              <Icon
                name={favorite.on ? 'heart' : 'heart-outline'}
                size={22}
                color={favorite.on ? accent : colors.text}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <SortSheet
        options={options}
        field={value}
        onPick={(key) => onChange(key as T)}
        openRef={sortRef}
      />
    </View>
  );
}

const styles = themed((colors) => ({
  // The same row an album, a playlist and a genre have, to the same margins.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  // Room to shrink: a long order name gives way to the buttons rather than
  // pushing them off the edge.
  sort: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  sortText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  // The two toggles at the row's right end. Spaced like the pair a genre used
  //  to wear here, so a row with one of them still reads as a group.
  filters: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
}));
