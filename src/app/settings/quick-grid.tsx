/**
 * Settings › Appearance › Quick grid: what feeds the shortcut card grid on
 * Home and how many tiles to show. The grid is dynamic (sorts by last play),
 * so here you don't reorder: you just pick sources and size.
 */
import { ScrollView, Text } from 'react-native';

import { SelectList, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

const SIZES = [4, 6, 8] as const;

export default function QuickGridSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const showQuickGrid = useSettings((s) => s.showQuickGrid);
  const setShowQuickGrid = useSettings((s) => s.setShowQuickGrid);
  const withFavorites = useSettings((s) => s.quickGridFavorites);
  const setWithFavorites = useSettings((s) => s.setQuickGridFavorites);
  const withAlbums = useSettings((s) => s.quickGridAlbums);
  const setWithAlbums = useSettings((s) => s.setQuickGridAlbums);
  const withPlaylists = useSettings((s) => s.quickGridPlaylists);
  const setWithPlaylists = useSettings((s) => s.setQuickGridPlaylists);
  const withRadio = useSettings((s) => s.quickGridRadio);
  const setWithRadio = useSettings((s) => s.setQuickGridRadio);
  const size = useSettings((s) => s.quickGridSize);
  const setSize = useSettings((s) => s.setQuickGridSize);

  const sources = [
    {
      label: t('Pin favorites'),
      description: t('Keep the Favorites tile first.'),
      value: withFavorites,
      onChange: setWithFavorites,
    },
    {
      label: t('Recent albums'),
      value: withAlbums,
      onChange: setWithAlbums,
    },
    // Not greyed out anywhere: this was written as "there are no playlists
    // without a server", and there are. A local profile keeps its own on the
    // phone and an account without a connection reads them off its mirror, so
    // the grid puts up playlist tiles in both — with the switch that says so
    // greyed out and no way to turn it off.
    {
      label: t('Playlists'),
      value: withPlaylists,
      onChange: setWithPlaylists,
    },
    // Server-side only: the stations live on the server and there is no
    // offline mirror for them, so without a connection the grid has none.
    // That is why the switch carries no description: there is nothing to
    // explain.
    {
      label: t('Radio stations'),
      value: withRadio,
      onChange: setWithRadio,
    },
  ];

  return (
    <SettingsPage title={t('Quick grid')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={[
            {
              label: t('Show quick grid'),
              description: t('The shortcut cards at the top of Home.'),
              value: showQuickGrid,
              onChange: setShowQuickGrid,
            },
          ]}
        />

        {/* Sources and size only make sense with the grid active. */}
        {showQuickGrid ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Sources')}</Text>
            <SwitchList options={sources} />

            <Text style={settingsStyles.sectionTitle}>{t('Size')}</Text>
            <SelectList
              value={size}
              onChange={setSize}
              options={SIZES.map((n) => ({ value: n, label: t('{n} cards', { n }) }))}
            />
          </>
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
