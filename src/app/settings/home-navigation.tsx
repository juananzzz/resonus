/** Settings › Home & navigation: what the tabs hold and how you move around. */
import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  SettingsScroll,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { canBlurBars } from '@/components/BarBlur';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useTheme } from '@/theme';
import { useSettings, type DefaultTab } from '@/store/settings';

export default function HomeNavigationSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const router = useRouter();
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const local = useLocalProfile();
  const serverType = useAuthStore((s) => s.auth?.serverType);
  // Jellyfin has no folder tree and the local profile no server: for both the
  // setting does not exist. Offline it is only out of reach, so greyed (#114).
  const canBrowseFolders = !local && (offline || serverType !== 'jellyfin');
  // Reads the server's now-playing list, which Jellyfin does not expose here.
  const canSeeElsewhere = !local && serverType !== 'jellyfin';
  const alwaysShowTabs = useSettings((s) => s.alwaysShowTabs);
  const setAlwaysShowTabs = useSettings((s) => s.setAlwaysShowTabs);
  const showTabLabels = useSettings((s) => s.showTabLabels);
  const setShowTabLabels = useSettings((s) => s.setShowTabLabels);
  const showPlayingElsewhere = useSettings((s) => s.showPlayingElsewhere);
  const setShowPlayingElsewhere = useSettings((s) => s.setShowPlayingElsewhere);
  const navbarPills = useSettings((s) => s.navbarPills);
  const setNavbarPills = useSettings((s) => s.setNavbarPills);
  const blurBars = useSettings((s) => s.blurBars);
  const setBlurBars = useSettings((s) => s.setBlurBars);
  const navBarStyle = useSettings((s) => s.navBarStyle);
  const setNavBarStyle = useSettings((s) => s.setNavBarStyle);
  const defaultTab = useSettings((s) => s.defaultTab);
  const setDefaultTab = useSettings((s) => s.setDefaultTab);
  const libraryShowsPlaylists = useSettings((s) => s.libraryShowsPlaylists);
  const setLibraryShowsPlaylists = useSettings((s) => s.setLibraryShowsPlaylists);
  const showFolderBrowser = useSettings((s) => s.showFolderBrowser);
  const setShowFolderBrowser = useSettings((s) => s.setShowFolderBrowser);
  const hapticsEnabled = useSettings((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettings((s) => s.setHapticsEnabled);

  return (
    <SettingsPage title={t('Home & navigation')}>
      <SettingsScroll>
        {/* The first title sticks to the header (no section margin). */}
        <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Home')}</Text>
        <SettingsGroup>
          {canSeeElsewhere ? (
            <SwitchList
              options={[
                {
                  label: t('Playing on other devices'),
                  description: t(
                    'At the top of Home, what is playing in your other apps and devices, ready to carry on here.',
                  ),
                  value: showPlayingElsewhere,
                  onChange: setShowPlayingElsewhere,
                  disabled: offline,
                },
              ]}
            />
          ) : null}
          <SettingRow
            label={t('Home buttons')}
            chevron
            onPress={() => router.push('/settings/home-buttons')}
          />
          <SettingRow
            label={t('Quick grid')}
            chevron
            onPress={() => router.push('/settings/quick-grid')}
          />
          <SettingRow
            label={t('Home chips')}
            chevron
            onPress={() => router.push('/settings/home-chips')}
          />
          <SettingRow
            label={t('Home sections')}
            chevron
            onPress={() => router.push('/settings/home-sections')}
          />
          <SettingRow
            label={t('Radios')}
            chevron
            onPress={() => router.push('/settings/radios')}
          />
          <SettingRow
            label={t('Greeting')}
            chevron
            onPress={() => router.push('/settings/greeting')}
          />
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Navigation')}</Text>
        <SettingsGroup>
          <SwitchList
            options={[
              {
                label: t('Always show the navigation bar'),
                value: alwaysShowTabs,
                onChange: setAlwaysShowTabs,
              },
              {
                label: t('Pill-shaped navigation bar'),
                value: navbarPills,
                onChange: setNavbarPills,
              },
              {
                label: t('Show tab names'),
                value: showTabLabels,
                onChange: setShowTabLabels,
              },
            ]}
          />
          <SettingRow
            label={t('Navigation bar')}
            chevron
            onPress={() => router.push('/settings/navigation-bar')}
          />
          {/* One choice for what fills the bar. Underneath it is still the
              blur switch and the style, so what anyone had saved holds. Blur
              is offered where the system draws it: Android 12 on, since
              before that there is only a tint, which was tried and dropped
              (b8bb8b1). */}
          <SelectList<'solid' | 'blur' | 'gradient'>
            label={t('Navigation bar style')}
            options={[
              { value: 'solid', label: t('Solid') },
              ...(canBlurBars ? [{ value: 'blur' as const, label: t('Blur') }] : []),
              { value: 'gradient', label: t('Gradient') },
            ]}
            value={
              navBarStyle === 'gradient' ? 'gradient' : blurBars && canBlurBars ? 'blur' : 'solid'
            }
            onChange={(v) => {
              setNavBarStyle(v === 'gradient' ? 'gradient' : 'solid');
              if (v !== 'gradient') setBlurBars(v === 'blur');
            }}
          />
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Explore')}</Text>
        <SettingsGroup>
          <SettingRow
            label={t('Explore sections')}
            chevron
            onPress={() => router.push('/settings/explore-sections')}
          />
          {/* Guarded as a whole, not with a spread inside the list: SwitchList
              always draws its card, so an empty array left a blank box. */}
          {canBrowseFolders ? (
            <SwitchList
              options={[
                {
                  label: t('Folder browsing'),
                  value: showFolderBrowser,
                  onChange: setShowFolderBrowser,
                  disabled: offline,
                },
              ]}
            />
          ) : null}
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Interface')}</Text>
        <SettingsGroup>
          <SelectList<DefaultTab>
            label={t('Open the app on')}
            options={[
              { value: 'index', label: t('Home') },
              { value: 'search', label: t('Search') },
              { value: 'explore', label: t('Explore') },
              { value: 'library', label: t('Your library') },
            ]}
            value={defaultTab}
            onChange={setDefaultTab}
          />
          <SwitchList
            options={[
              {
                label: t('Start on your playlists'),
                description: t(
                  'With no chip pressed, Your library shows Favorites and your playlists instead of everything mixed together.',
                ),
                value: libraryShowsPlaylists,
                onChange: setLibraryShowsPlaylists,
              },
              {
                label: t('Haptic feedback'),
                value: hapticsEnabled,
                onChange: (v: boolean) => {
                  setHapticsEnabled(v);
                  // Vibrates on enable: immediate confirmation that it works.
                  if (v) haptic('medium');
                },
              },
            ]}
          />
        </SettingsGroup>
      </SettingsScroll>
    </SettingsPage>
  );
}
