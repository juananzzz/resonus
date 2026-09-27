/**
 * Settings › Theme: the appearance (dark, light, or the phone's own) and the
 * accent colour of whichever one is on screen — each keeps its own. All of it
 * applies the moment it is chosen.
 *
 * The light one carries "(experimental)" in its own label rather than a warning
 * off to one side. It is a whole second palette across every screen in the app,
 * and the odds are that somewhere a corner of it still wants adjusting: the word
 * belongs where the choice is made, so nobody picks it and then wonders whether
 * what they are looking at is on purpose.
 */
import Icon from '@/components/Icon';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SelectList, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { ACCENT_OPTIONS, useSettings } from '@/store/settings';
import {
  BACKGROUND_TINTS,
  fontSize,
  radius,
  spacing,
  themed,
  type BackgroundTint,
  type ThemePreference,
  useThemeMode,
} from '@/theme';

/** In the order they are offered, the default first. */
const TINTS: { key: BackgroundTint; name: string }[] = [
  { key: 'blue', name: 'Blue' },
  { key: 'neutral', name: 'Neutral' },
  { key: 'purple', name: 'Purple' },
  { key: 'green', name: 'Green' },
  { key: 'warm', name: 'Warm' },
  { key: 'teal', name: 'Teal' },
  { key: 'rose', name: 'Rose' },
  { key: 'olive', name: 'Olive' },
];

/** The backgrounds, each drawn as the card grey it gives in the appearance on screen. */
function TintSwatches({
  value,
  onPick,
  dimmed,
  light,
}: {
  value: BackgroundTint;
  onPick: (tint: BackgroundTint) => void;
  dimmed: boolean;
  light: boolean;
}) {
  const t = useT();
  return (
    <View style={[styles.swatches, dimmed && styles.dimmed]}>
      {TINTS.map(({ key, name }) => {
        const active = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onPick(key)}
            accessibilityRole="button"
            accessibilityLabel={t(name)}
            accessibilityState={{ selected: active }}
            style={[
              styles.swatch,
              styles.tintSwatch,
              { backgroundColor: BACKGROUND_TINTS[key][light ? 'light' : 'dark'].surfaceHighlight },
              active && styles.swatchActive,
            ]}
          >
            {active ? <Icon name="checkmark" size={24} color={light ? '#000' : '#FFF'} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The row of colours. Which appearance it is picking for is the one on screen;
 *  see the note where it is used. */
function Swatches({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const t = useT();
  return (
    <View style={styles.swatches}>
      {ACCENT_OPTIONS.map((opt) => {
        const active = opt.color.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={opt.color}
            onPress={() => onPick(opt.color)}
            accessibilityRole="button"
            accessibilityLabel={t(opt.name)}
            style={[styles.swatch, { backgroundColor: opt.color }, active && styles.swatchActive]}
          >
            {/* The swatches are the colours as named — the vivid ones — in
                both appearances, so black is always the tick that reads on
                them. What the light theme paints with is a darkened version
                of whichever one is picked (see `readableOn` in the theme):
                the same colour, taken down to where it can be read on
                white. */}
            {active ? <Icon name="checkmark" size={24} color="#000" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ThemeSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else. The
  // appearance is also read, since it is the one being given a colour.
  const mode = useThemeMode();
  const t = useT();
  const accentColor = useSettings((s) => s.accentColor);
  const accentColorLight = useSettings((s) => s.accentColorLight);
  const setAccentColor = useSettings((s) => s.setAccentColor);
  const themeMode = useSettings((s) => s.themeMode);
  const setThemeMode = useSettings((s) => s.setThemeMode);
  const pureBlack = useSettings((s) => s.pureBlack);
  const setPureBlack = useSettings((s) => s.setPureBlack);
  const backgroundTint = useSettings((s) => s.backgroundTint);
  const setBackgroundTint = useSettings((s) => s.setBackgroundTint);

  return (
    <SettingsPage title={t('Theme')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {/* "Mode" and not "Appearance": Appearance is the screen this one hangs
            off, and two headings with the same word one level apart read as a
            mistake. */}
        <Text style={styles.label}>{t('Mode')}</Text>
        <SelectList<ThemePreference>
          collapsible={false}
          value={themeMode}
          onChange={setThemeMode}
          options={[
            { value: 'system', label: t('System') },
            { value: 'dark', label: t('Dark (default)') },
            { value: 'light', label: t('Light (experimental)') },
          ]}
        />
        {/* A variant of dark rather than a fourth mode, so following the
            system still works with it. */}
        <View style={styles.gap} />
        <SwitchList
          options={[
            {
              label: t('Pure black'),
              description: t('A black background instead of dark grey whenever the app is dark. Made for OLED screens.'),
              value: pureBlack,
              onChange: setPureBlack,
            },
          ]}
        />

        {/* Still pickable with pure black, for when it is turned off; dimmed
            so it is clear it is not what is on screen. */}
        <Text style={[styles.label, styles.secondLabel]}>{t('Background')}</Text>
        <Text style={styles.hint}>{t('The shade of the greys, dark or light. Pure black keeps its own.')}</Text>
        <TintSwatches
          value={backgroundTint}
          onPick={setBackgroundTint}
          dimmed={mode !== 'light' && pureBlack}
          light={mode === 'light'}
        />

        {/* One row, and it belongs to the appearance you are looking at: each
            keeps its own colour, so switching mode brings back the one chosen
            there rather than repainting it with the other's. Nothing has to say
            so on screen — the ticked swatch is already the answer. */}
        <Text style={[styles.label, styles.secondLabel]}>{t('Accent color')}</Text>
        <Swatches
          value={mode === 'light' ? accentColorLight : accentColor}
          onPick={(hex) => setAccentColor(hex, mode)}
        />
      </ScrollView>
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  secondLabel: { marginTop: spacing.xl },
  gap: { height: spacing.md },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchActive: { borderWidth: 3, borderColor: colors.text },
  tintSwatch: { borderWidth: 1, borderColor: colors.textMuted },
  dimmed: { opacity: 0.4 },
  hint: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: -spacing.sm, marginBottom: spacing.md },
}));
