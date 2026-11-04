/**
 * Settings › Your library chips: which chips are at the top of Your library,
 * and in what order. The same draggable list as the Explore sections, without
 * their floor: with every chip off the tab still lists everything you keep.
 */
import Icon from '@/components/Icon';
import { Pressable, Switch, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { ScreenHeader, SettingsSafeArea } from '@/components/SettingsUI';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useSettings, type LibraryChip, type LibraryChipKey } from '@/store/settings';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';

/** Each chip's label, as an i18n key. The same ones the tab draws. */
const LABEL: Record<LibraryChipKey, string> = {
  playlists: 'Playlists',
  albums: 'Albums',
  artists: 'Artists',
  podcasts: 'Podcasts',
};

function ChipRow({ chip }: { chip: LibraryChip }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setChip = useSettings((s) => s.setLibraryChip);
  // From the store, not `colors.accent`: without subscription the switch would
  // keep the previous accent while the screen stays mounted.
  const { accent } = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        hitSlop={8}
        onPressIn={() => {
          haptic('medium');
          drag();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('Reorder')}
      >
        <Icon name="reorder-two" size={24} color={colors.textSecondary} />
      </Pressable>
      <Text style={styles.label}>{t(LABEL[chip.key])}</Text>
      <Switch
        value={chip.enabled}
        onValueChange={(v) => setChip(chip.key, v)}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
  );
}

export default function LibraryChipsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const chips = useSettings((s) => s.libraryChips);
  const setChips = useSettings((s) => s.setLibraryChips);

  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Your library chips')} />
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        data={chips}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <ChipRow chip={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const next = chips.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setChips(next);
        }}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPad, paddingHorizontal: centredPadding(width, spacing.lg) },
        ]}
      />
    </SettingsSafeArea>
  );
}

const styles = themed((colors) => ({
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  label: { flex: 1, color: colors.text, fontSize: fontSize.md },
}));
