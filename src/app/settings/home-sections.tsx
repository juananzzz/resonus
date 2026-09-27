/**
 * Settings › Home sections: draggable list (same engine as the queue and
 * playlists) to show/hide and reorder the album rows on Home. Changes are
 * applied and saved immediately.
 */
import Icon from '@/components/Icon';
import { Pressable, Switch, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';

import { ScreenHeader, SettingsSafeArea } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useSettings, type HomeSection, type HomeSectionKey } from '@/store/settings';
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

/** Label (i18n key) of each section. */
const LABEL: Record<HomeSectionKey, string> = {
  recentlyAdded: 'Recently added',
  newReleases: 'New releases',
  recentlyPlayed: 'Recently played',
  mostPlayed: 'Most played albums',
  mostPlayedSongs: 'Most played songs',
  randomSongs: 'Random songs',
  discover: 'Discover',
  playlists: 'Playlists',
  podcasts: 'Recent episodes',
  randomAlbums: 'Random albums',
  randomArtists: 'Random artists',
};

function SectionRow({ section }: { section: HomeSection }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setHomeSection = useSettings((s) => s.setHomeSection);
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
        onValueChange={(v) => setHomeSection(section.key, v)}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
  );
}

/** Sections that don't exist locally: their row here would promise something
 *  Home never renders (same criteria as folder browsing in Appearance). */
const SERVER_ONLY: HomeSectionKey[] = ['discover'];

export default function HomeSectionsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const homeSections = useSettings((s) => s.homeSections);
  const setHomeSections = useSettings((s) => s.setHomeSections);
  const visible = offline
    ? homeSections.filter((s) => !SERVER_ONLY.includes(s.key))
    : homeSections;

  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Home sections')} />
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        data={visible}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <SectionRow section={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const nextVisible = visible.slice();
          const [moved] = nextVisible.splice(from, 1);
          nextVisible.splice(to, 0, moved);
          // Hidden ones go back to their absolute position: reordering locally
          // must not lose or reposition the config of server-only rows.
          let vi = 0;
          const next = homeSections.map((s) =>
            offline && SERVER_ONLY.includes(s.key) ? s : nextVisible[vi++],
          );
          setHomeSections(next);
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
