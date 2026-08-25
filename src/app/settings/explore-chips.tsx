/**
 * Settings › Explore chips: draggable list (same engine as the queue and
 * playlists) to show/hide and reorder the Home chips. Changes are applied and
 * saved immediately.
 *
 * With none active the entire row disappears from Home; that's why there's no
 * separate master toggle.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Switch, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { SafeAreaView } from 'react-native-safe-area-context';

import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';

import { ScreenHeader, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useSettings, type ExploreChip, type ExploreChipKey } from '@/store/settings';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';

/** Each chip's label, as an i18n key. The same ones Home draws. */
const LABEL: Record<ExploreChipKey, string> = {
  shuffle: 'Shuffle',
  favorites: 'Favorites',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  genres: 'Genres',
  radio: 'Radio',
  history: 'Recently played',
  audiobooks: 'Audiobooks',
};

function ChipRow({ chip, disabled }: { chip: ExploreChip; disabled?: boolean }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setExploreChip = useSettings((s) => s.setExploreChip);
  // From the store, not `colors.accent`: without subscription the switch would
  // keep the previous accent while the screen stays mounted.
  const { accent } = useTheme();
  return (
    // Still draggable while greyed out: where it goes is a preference about the
    // Home screen you get back, and it costs nothing to set now.
    <View style={[styles.row, disabled && { opacity: 0.5 }]}>
      <Pressable
        hitSlop={8}
        onPressIn={() => {
          haptic('medium');
          drag();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('Reorder')}
      >
        <Ionicons name="reorder-two" size={24} color={colors.textSecondary} />
      </Pressable>
      <Text style={styles.label}>{t(LABEL[chip.key])}</Text>
      <Switch
        value={chip.enabled}
        onValueChange={(v) => setExploreChip(chip.key, v)}
        disabled={disabled}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
  );
}

/** Chips Home does not draw without a connection (it filters them out through
 * OFFLINE_KEYS). Their rows stay here, greyed out, so the list is the same list
 * whichever mode you are in (#114) — except in the local profile, where they
 * are gone: the genres come from `getGenres` and the stations from
 * `getRadioStations`, both of which want an account, and neither is coming
 * back to a profile that never had one (see `useLocalProfile`). */
const SERVER_ONLY: ExploreChipKey[] = ['genres', 'radio'];

export default function ExploreChipsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const local = useLocalProfile();
  const exploreChips = useSettings((s) => s.exploreChips);
  const setExploreChips = useSettings((s) => s.setExploreChips);
  const chipIcons = useSettings((s) => s.exploreChipIcons);
  const setChipIcons = useSettings((s) => s.setExploreChipIcons);
  const visible = local ? exploreChips.filter((c) => !SERVER_ONLY.includes(c.key)) : exploreChips;
  return (
    <SafeAreaView style={settingsStyles.safe} edges={['top']}>
      <ScreenHeader title={t('Explore chips')} />
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        data={visible}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <ChipRow chip={item} disabled={offline && SERVER_ONLY.includes(item.key)} />
        )}
        // Under the last chip, and scrolling with them: it is about the row as
        // a whole rather than about any one chip, and a switch pinned to the
        // bottom edge of the screen would read as a bar.
        ListFooterComponent={
          <View style={styles.iconsBox}>
            <SwitchList
              options={[{ label: t('Show icons'), value: chipIcons, onChange: setChipIcons }]}
            />
          </View>
        }
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          // Offline every chip is on screen, so the positions dragged are the
          // positions stored. In the local profile two of them are not, and
          // they keep the place they had: what is stored is a preference about
          // any profile, and reordering here must not shuffle the order an
          // account will come back to.
          const nextVisible = visible.slice();
          const [moved] = nextVisible.splice(from, 1);
          nextVisible.splice(to, 0, moved);
          let vi = 0;
          const next = exploreChips.map((c) =>
            local && SERVER_ONLY.includes(c.key) ? c : nextVisible[vi++],
          );
          setExploreChips(next);
        }}
        contentContainerStyle={[
          styles.list,
          // Centred once the screen is wider than a list wants to be, like
          // every other settings screen (#131).
          { paddingBottom: bottomPad, paddingHorizontal: centredPadding(width, spacing.lg) },
        ]}
      />
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  // Clear of the last chip, which is a card of the same width right above it.
  iconsBox: { marginTop: spacing.lg },
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
