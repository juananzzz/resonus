/**
 * Settings › Home & navigation › Radios: the artist radios as a whole.
 *
 * Off at the top means off everywhere: no shelf, no radio in the menus, and
 * nothing built or asked for in the background. Below it, how many radios
 * Home offers and whether one keeps playing once its songs run out. New
 * radios come with pulling Home to refresh, so there is no button for it.
 */
import { useQueryClient } from '@tanstack/react-query';
import { ScrollView } from 'react-native';

import {
  SelectList,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { refreshRadios } from '@/lib/radioBuild';
import { RADIO_COUNT_OPTIONS, useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

export default function RadiosSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  const enabled = useSettings((s) => s.radiosEnabled);
  const setEnabled = useSettings((s) => s.setRadiosEnabled);
  const count = useSettings((s) => s.radioCount);
  const setCount = useSettings((s) => s.setRadioCount);
  const endless = useSettings((s) => s.radioEndless);
  const setEndless = useSettings((s) => s.setRadioEndless);

  return (
    <SettingsPage title={t('Radios')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SettingsGroup>
          <SwitchList
            options={[
              {
                label: t('Artist radios'),
                description: t(
                  'Radios built from the artists you play most. Off, there are none on Home or in the menus, and nothing is fetched for them.',
                ),
                value: enabled,
                onChange: setEnabled,
              },
            ]}
          />
        </SettingsGroup>
        {/* Off, the rest has nothing to act on: taken away rather than greyed. */}
        {enabled ? (
          <SettingsGroup>
            <SelectList<number>
              label={t('Radios on Home')}
              options={RADIO_COUNT_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
              value={count}
              onChange={(n) => {
                setCount(n);
                // A new set of that size, built in the background; fewer show
                // at once meanwhile (Home slices what is saved).
                void refreshRadios({ force: true })
                  .then(() => queryClient.invalidateQueries({ queryKey: ['radios'] }))
                  .catch(() => {});
              }}
            />
            <SwitchList
              options={[
                {
                  label: t('Keep playing when a radio ends'),
                  description: t('When its songs run out, another round from the same artists.'),
                  value: endless,
                  onChange: setEndless,
                },
              ]}
            />
          </SettingsGroup>
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
