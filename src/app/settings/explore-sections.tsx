/**
 * Settings › Explore sections: which pills are at the top of Explore, and in
 * what order.
 *
 * The same draggable list the Home chips and the navigation bar use, switches
 * and all. Unlike the Home chips, the last one on cannot be turned off: those
 * can all go and the row simply disappears, while Explore is the only way into
 * the whole of a library, so a tab with no chips is a catalogue with no way in.
 * It is the same floor the navigation bar puts under Home and the library
 * settings put under the last library.
 *
 * Every section is listed whether or not this profile can reach it (see the
 * hint below), and the tab still leaves out what it has no answer for: a
 * Jellyfin account has no folder tree, and offline there are no stations.
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
import { useSettings, type ExploreSection, type ExploreSectionKey } from '@/store/settings';
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

/** Each section's label, as an i18n key. The same ones the tab draws. */
const LABEL: Record<ExploreSectionKey, string> = {
  playlists: 'Playlists',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  genres: 'Genres',
  radio: 'Radio',
  podcasts: 'Podcasts',
  folders: 'Folders',
};

function SectionRow({
  section,
  onToggle,
}: {
  section: ExploreSection;
  onToggle: (value: boolean) => void;
}) {
  const t = useT();
  const drag = useReorderableDrag();
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

export default function ExploreSectionsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const sections = useSettings((s) => s.exploreSections);
  const setSections = useSettings((s) => s.setExploreSections);
  const setSection = useSettings((s) => s.setExploreSection);
  const toast = useToast((s) => s.show);
  const enabledCount = sections.filter((s) => s.enabled).length;

  /** The last one on stays on: see the note at the top of the file. */
  function toggle(key: ExploreSectionKey, value: boolean) {
    if (!value && enabledCount <= 1) {
      toast(t('Keep at least one section on'));
      return;
    }
    setSection(key, value);
  }

  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Explore sections')} />
      {/* Every section is listed, including the ones this profile cannot reach:
          what is stored is a preference about any profile, and a Jellyfin
          account rearranging the list an offline one comes back to is the kind
          of surprise nobody asked for (#114). */}
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        data={sections}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <SectionRow section={item} onToggle={(v) => toggle(item.key, v)} />
        )}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const next = sections.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setSections(next);
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
