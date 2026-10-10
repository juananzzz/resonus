/**
 * Settings › Theme › My theme: the theme creator, at its most basic. Three
 * colours and a handful of choices, each one of the fields a theme is made of
 * (`CustomTheme`). Every change is on screen at once while the theme is on,
 * so the app around it is the preview.
 */
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ColorPickerDialog } from '@/components/ColorPickerDialog';
import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import {
  DEFAULT_CUSTOM_THEME,
  radius,
  spacing,
  themed,
  useTheme,
  type CustomTheme,
  type ThemeCorners,
  type ThemeSpec,
} from '@/theme';

type ColorField = 'background' | 'surface' | 'accent';

/** A row that names a colour and shows it, and opens the picker. */
function ColorRow({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [settingsStyles.row, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${color}`}
      onPress={onPress}
    >
      <View style={settingsStyles.rowLabelBox}>
        <Text style={settingsStyles.rowLabel}>{label}</Text>
        <Text style={settingsStyles.rowDescription}>{color.toUpperCase()}</Text>
      </View>
      <View style={[styles.swatch, { backgroundColor: color }]} />
    </Pressable>
  );
}

export default function ThemeEditor() {
  // Repaints with every change: the screen is drawn in the theme it edits.
  useTheme();
  const t = useT();
  const theme = useSettings((s) => s.customTheme);
  const setTheme = useSettings((s) => s.setCustomTheme);
  const skin = useSettings((s) => s.themeSkin);
  const setSkin = useSettings((s) => s.setThemeSkin);
  const [editing, setEditing] = useState<ColorField | null>(null);
  const set = <K extends keyof CustomTheme>(key: K) => (value: CustomTheme[K]) => setTheme({ [key]: value });

  return (
    <SettingsPage title={t('My theme')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={[
            {
              label: t('Use my theme'),
              value: skin === 'custom',
              onChange: (on) => setSkin(on ? 'custom' : 'default'),
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Colors')}</Text>
        <SettingsGroup>
          <ColorRow label={t('Background')} color={theme.background} onPress={() => setEditing('background')} />
          <ColorRow label={t('Cards')} color={theme.surface} onPress={() => setEditing('surface')} />
          <ColorRow label={t('Accent color')} color={theme.accent} onPress={() => setEditing('accent')} />
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Shape and type')}</Text>
        <SettingsGroup>
          <SelectList<ThemeCorners>
            label={t('Corners')}
            value={theme.corners}
            onChange={set('corners')}
            options={[
              { value: 'sharp', label: t('Square') },
              { value: 'soft', label: t('Rounded') },
              { value: 'round', label: t('More rounded') },
            ]}
          />
          <SelectList<ThemeSpec['font']>
            label={t('Font')}
            value={theme.font}
            onChange={set('font')}
            options={[
              { value: 'app', label: t('Default') },
              // A proper name, like the fonts in Settings › Font.
              { value: 'exo2', label: 'Exo 2' },
            ]}
          />
          <SelectList<ThemeSpec['headings']>
            label={t('Headings')}
            value={theme.headings}
            onChange={set('headings')}
            options={[
              { value: 'normal', label: t('Default') },
              { value: 'upper', label: t('Capitals') },
            ]}
          />
        </SettingsGroup>
        <View style={styles.gap} />
        <SwitchList
          options={[
            {
              label: t('Bevel'),
              description: t('A thin lit edge round cards and covers'),
              value: theme.bevel,
              onChange: set('bevel'),
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Pieces')}</Text>
        <SettingsGroup>
          <SelectList<ThemeSpec['playButton']>
            label={t('Play button')}
            value={theme.playButton}
            onChange={set('playButton')}
            options={[
              { value: 'default', label: t('Default') },
              { value: 'accent', label: t('Accent color') },
              { value: 'silver', label: t('Silver') },
            ]}
          />
          <SelectList<ThemeSpec['bars']>
            label={t('Navigation bar and mini player')}
            value={theme.bars}
            onChange={set('bars')}
            options={[
              { value: 'default', label: t('Default') },
              { value: 'metal', label: t('Metal') },
            ]}
          />
        </SettingsGroup>

        <View style={styles.gap} />
        <SettingRow
          label={t('Start over')}
          icon="arrow-undo-outline"
          destructive
          onPress={() => setTheme(DEFAULT_CUSTOM_THEME)}
        />
      </ScrollView>
      {editing ? (
        <ColorPickerDialog
          initialColor={theme[editing]}
          onCancel={() => setEditing(null)}
          onSave={(hex) => {
            setEditing(null);
            setTheme({ [editing]: hex });
          }}
        />
      ) : null}
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  gap: { height: spacing.md },
}));
