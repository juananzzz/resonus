/**
 * Settings › Equalizer: toggle, device presets and one band per row.
 * Processing is done by the system equalizer (native module modules/audio-eq);
 * here you only choose gains, which are saved and applied to the app audio
 * immediately.
 */
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsPage,
  settingsStyles,
  SliderRow,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useEqualizer } from '@/store/equalizer';
import { useTheme } from '@/theme';

/** 62 → «62 Hz»; 16000 → «16 kHz». */
function formatFreq(hz: number): string {
  return hz >= 1000 ? `${Math.round(hz / 100) / 10} kHz` : `${hz} Hz`;
}

/** Milibelios → «+3.0 dB». */
function formatGain(millibels: number): string {
  const db = millibels / 100;
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export default function EqualizerSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const supported = useEqualizer((s) => s.supported);
  const bands = useEqualizer((s) => s.bands);
  const minLevel = useEqualizer((s) => s.minLevel);
  const maxLevel = useEqualizer((s) => s.maxLevel);
  const presets = useEqualizer((s) => s.presets);
  const enabled = useEqualizer((s) => s.enabled);
  const levels = useEqualizer((s) => s.levels);
  const setEnabled = useEqualizer((s) => s.setEnabled);
  const setBandLevel = useEqualizer((s) => s.setBandLevel);
  const applyPreset = useEqualizer((s) => s.applyPreset);
  const reset = useEqualizer((s) => s.reset);

  // The selected preset is view-only: touching a band clears the preset
  // («Custom»). What's saved are the gains.
  const [preset, setPreset] = useState(-1);

  if (!supported) {
    return (
      <SettingsPage title={t('Equalizer')}>
        <ScrollView contentContainerStyle={settingsStyles.content}>
          <Text style={settingsStyles.sectionDescription}>
            {t('This device does not offer an equalizer.')}
          </Text>
        </ScrollView>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={t('Equalizer')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={[
            {
              label: t('Equalizer'),
              description: t('Apply the equalizer to the app audio.'),
              value: enabled,
              onChange: setEnabled,
            },
          ]}
        />

        {presets.length > 0 ? (
          <SelectList
            label={t('Preset')}
            options={[
              { value: -1, label: t('Custom') },
              ...presets.map((name, i) => ({ value: i, label: name })),
            ]}
            value={preset}
            onChange={(v) => {
              setPreset(v);
              if (v >= 0) applyPreset(v);
            }}
          />
        ) : null}

        <Text style={settingsStyles.sectionTitle}>{t('Bands')}</Text>
        {bands.map((band) => (
          <SliderRow
            key={band.index}
            label={formatFreq(band.centerFreq)}
            value={levels[band.index] ?? 0}
            min={minLevel}
            max={maxLevel}
            // 1 dB steps: the range comes in millibels.
            step={100}
            formatValue={formatGain}
            onChange={(v) => {
              setPreset(-1);
              setBandLevel(band.index, v);
            }}
          />
        ))}

        <SettingRow
          icon="arrow-undo-outline"
          label={t('Reset bands')}
          onPress={() => {
            setPreset(-1);
            reset();
          }}
        />
      </ScrollView>
    </SettingsPage>
  );
}
