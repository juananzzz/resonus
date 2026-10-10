/**
 * Settings › Theme: the appearance (dark, light, or the phone's own) and the
 * accent colour of whichever one is on screen — each keeps its own. All of it
 * applies the moment it is chosen.
 */
import { ColorPickerDialog } from '@/components/ColorPickerDialog';
import Icon from '@/components/Icon';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SelectList, SettingsGroup, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
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
  type ThemeSkin,
  useTheme,
  useThemeMode,
} from '@/theme';

/** The hours a scheduled theme can change at. */
const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, '0')}:00`,
}));

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

/** Black or white, whichever reads on `hex`. */
function tickOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const y = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return y > 140 ? '#000' : '#FFF';
}

/** The user's own colour, and the way into making or changing it. */
function CustomSwatch({
  color,
  active,
  onPick,
  onEdit,
}: {
  color: string;
  active: boolean;
  onPick: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const colors = useTheme();
  return (
    <View style={styles.swatches}>
      {color ? (
        <Pressable
          onPress={onPick}
          accessibilityRole="button"
          accessibilityLabel={t('Custom color')}
          accessibilityState={{ selected: active }}
          style={[styles.swatch, { backgroundColor: color }, active && styles.swatchActive]}
        >
          {active ? <Icon name="checkmark" size={24} color={tickOn(color)} /> : null}
        </Pressable>
      ) : null}
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={color ? t('Edit custom color') : t('Create custom color')}
        style={[styles.swatch, styles.tintSwatch, { backgroundColor: colors.surfaceHighlight }]}
      >
        <Icon name={color ? 'create-outline' : 'add'} size={24} color={colors.text} />
      </Pressable>
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
  const themeLightFrom = useSettings((s) => s.themeLightFrom);
  const setThemeLightFrom = useSettings((s) => s.setThemeLightFrom);
  const themeDarkFrom = useSettings((s) => s.themeDarkFrom);
  const setThemeDarkFrom = useSettings((s) => s.setThemeDarkFrom);
  const pureBlack = useSettings((s) => s.pureBlack);
  const setPureBlack = useSettings((s) => s.setPureBlack);
  const backgroundTint = useSettings((s) => s.backgroundTint);
  const setBackgroundTint = useSettings((s) => s.setBackgroundTint);
  const customAccentColor = useSettings((s) => s.customAccentColor);
  const setCustomAccentColor = useSettings((s) => s.setCustomAccentColor);
  const themeSkin = useSettings((s) => s.themeSkin);
  const setThemeSkin = useSettings((s) => s.setThemeSkin);
  const [pickerOpen, setPickerOpen] = useState(false);
  const accent = mode === 'light' ? accentColorLight : accentColor;

  return (
    <SettingsPage title={t('Theme')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={styles.label}>{t('Style')}</Text>
        <SelectList<ThemeSkin>
          collapsible={false}
          value={themeSkin}
          onChange={setThemeSkin}
          options={[
            { value: 'default', label: t('Default') },
            { value: 'chrome', label: t('Chrome (experimental)') },
          ]}
        />
        {themeSkin === 'chrome' ? (
          <Text style={[styles.subLabel, styles.skinNote]}>
            {t('Chrome brings its own colours, font and corners. The settings below come back when it is off.')}
          </Text>
        ) : null}
        {/* Everything below is the default style's, and stays set while
            another one is on. */}
        <View
          style={[styles.secondLabel, themeSkin !== 'default' && styles.dimmed]}
          pointerEvents={themeSkin === 'default' ? 'auto' : 'none'}
        >
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
            { value: 'dark', label: t('Dark') },
            { value: 'light', label: t('Light') },
            { value: 'schedule', label: t('Scheduled') },
          ]}
        />
        {themeMode === 'schedule' ? (
          <>
            <View style={styles.gap} />
            <SettingsGroup>
              <SelectList<number>
                label={t('Light from')}
                options={HOURS}
                value={themeLightFrom}
                onChange={setThemeLightFrom}
              />
              <SelectList<number>
                label={t('Dark from')}
                options={HOURS}
                value={themeDarkFrom}
                onChange={setThemeDarkFrom}
              />
            </SettingsGroup>
          </>
        ) : null}
        {/* A variant of dark rather than a fourth mode, so following the
            system still works with it. */}
        <View style={styles.gap} />
        <SwitchList
          options={[
            {
              label: t('Pure black'),
              value: pureBlack,
              onChange: setPureBlack,
            },
          ]}
        />

        {/* Still pickable with pure black, for when it is turned off; dimmed
            so it is clear it is not what is on screen. */}
        <Text style={[styles.label, styles.secondLabel]}>{t('Background')}</Text>
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
        <Text style={styles.subLabel}>{t('Palette')}</Text>
        <Swatches value={accent} onPick={(hex) => setAccentColor(hex, mode)} />
        <Text style={[styles.subLabel, styles.secondSubLabel]}>{t('Custom::color')}</Text>
        <CustomSwatch
          color={customAccentColor}
          active={!!customAccentColor && customAccentColor.toLowerCase() === accent.toLowerCase()}
          onPick={() => setAccentColor(customAccentColor, mode)}
          onEdit={() => setPickerOpen(true)}
        />
        {pickerOpen ? (
          <ColorPickerDialog
            initialColor={customAccentColor || accent}
            onCancel={() => setPickerOpen(false)}
            onSave={(hex) => {
              setPickerOpen(false);
              setCustomAccentColor(hex);
              setAccentColor(hex, mode);
            }}
          />
        ) : null}
        </View>
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
  subLabel: { color: colors.textMuted, fontSize: fontSize.xs, marginBottom: spacing.sm },
  secondSubLabel: { marginTop: spacing.lg },
  skinNote: { marginTop: spacing.sm, marginBottom: 0 },
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
}));
