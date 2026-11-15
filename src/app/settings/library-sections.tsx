/**
 * Settings › Library sections: which sections the Library tab draws, and in
 *  what order.
 *
 * The same draggable list the Home chips and the navigation bar use, switches
 *  and all. Unlike the Home chips, the last one on cannot be turned off: those
 *  can all go and the row simply disappears, while the Library is the only way
 *  into the whole of a library, so a tab with no chips is a catalogue with no
 *  way in. It is the same floor the navigation bar puts under Home and the
 *  settings put under the last library.
 *
 * Every section is listed whether or not this profile can reach it (see the
 *  hint below), and the tab still leaves out what it has no answer for: a
 *  Jellyfin account has no folder tree, and offline there are no stations.
 *
 * The Downloaded switch is here too, but not in the draggable list: the ↓ it
 *  stands for is drawn at the right end of every section's sort row, at a fixed
 *  place, so there is nothing for dragging it to achieve. Listing it apart,
 *  without the drag icon, is what tells that to the finger. What a section is
 *  *shown* for is this screen's; what a section is filtered to is not on any
 *  screen here — the heart lives in the section's own sort row and saves its
 *  state per section, because a switch you press while reading is not a
 *  preference to set from the settings.
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
import { useSettings, type LibrarySection, type LibrarySectionKey } from '@/store/settings';
import { useToast } from '@/store/toast';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';

/** Each row's label, as an i18n key: the sections' plus the ↓ filter's. The
 *  same ones the tab draws. */
const LABEL: Record<LibrarySectionKey, string> = {
  playlists: 'Playlists',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  genres: 'Genres',
  radio: 'Radio',
  podcasts: 'Podcasts',
  folders: 'Folders',
  downloaded: 'Downloaded',
};

function SectionRow({
  section,
  onToggle,
}: {
  section: LibrarySection;
  onToggle: (value: boolean) => void;
}) {
  const t = useT();
  const drag = useReorderableDrag();
  // From the store, not `colors.accent`: without subscription the switch would
  //  keep the previous accent while the screen stays mounted.
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
      <Text style={styles.label}>{t(LABEL[section.key])}</Text>
      <Switch
        value={section.enabled}
        onValueChange={onToggle}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
  );
}

/**
 * The Downloaded switch, on a row of its own and without the drag icon.
 *
 * The ↓ it stands for is drawn at the right end of every section's sort row,
 *  at a fixed place, so dragging this row would move nothing — a row that
 *  cannot be grabbed is the only way to say that. The icon is the same one the
 *  tab draws there, so the switch and what it switches are told as one thing.
 */
function FilterRow({
  section,
  onToggle,
}: {
  section: LibrarySection;
  onToggle: (value: boolean) => void;
}) {
  const t = useT();
  const { accent } = useTheme();
  return (
    <View style={styles.row}>
      <Icon name="arrow-down-circle" size={22} color={colors.textSecondary} />
      <Text style={styles.label}>{t(LABEL[section.key])}</Text>
      <Switch
        value={section.enabled}
        onValueChange={onToggle}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
  );
}

export default function LibrarySectionsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  //  mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const sections = useSettings((s) => s.librarySections);
  const setSections = useSettings((s) => s.setLibrarySections);
  const setSection = useSettings((s) => s.setLibrarySection);
  const toast = useToast((s) => s.show);
  // The Downloaded switch is not one of the sections, and not one of the rows
  //  that can be dragged: see the note at the top of the file and the one on
  //  `FilterRow`. The tab reads its switch by key, so the entry stays in the
  //  saved list — leaving it out would read as the filter being off.
  const downloadRow = sections.find((s) => s.key === 'downloaded');
  const rows = sections.filter((s) => s.key !== 'downloaded');
  const enabledCount = rows.filter((s) => s.enabled).length;

  /** The last one on stays on: see the note at the top of the file. */
  function toggle(key: LibrarySectionKey, value: boolean) {
    if (!value && key !== 'downloaded' && enabledCount <= 1) {
      toast(t('Keep at least one section on'));
      return;
    }
    setSection(key, value);
  }

  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Library sections')} />
      {/* The filter's switch first, in front of the sections the way the saved
          list keeps it: it is not one of them, so it is not in the list of
          rows that can be dragged. */}
      {downloadRow ? (
        <FilterRow section={downloadRow} onToggle={(v) => toggle('downloaded', v)} />
      ) : null}
      {/* Every section is listed, including the ones this profile cannot reach:
          what is stored is a preference about any profile, and a Jellyfin
          account rearranging the list an offline one comes back to is the kind
          of surprise nobody asked for (#114). */}
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <SectionRow section={item} onToggle={(v) => toggle(item.key, v)} />
        )}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const next = rows.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          // The indices the drag gives are the list's, so the reordering runs
          //  over the rows that are shown. The Downloaded entry goes back in
          //  front of them the way `normalizeLibrarySections` puts a saved
          //  list without one — the tab reads it by key either way.
          setSections(downloadRow ? [{ ...downloadRow }, ...next] : next);
        }}
        contentContainerStyle={[
          styles.list,
          // Centred once the screen is wider than a list wants to be, like
          // every other settings screen (#131).
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
