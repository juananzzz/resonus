/** Settings › Appearance: language, theme, song lists and interface. */
import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
  SwitchList,
  TextRow,
} from '@/components/SettingsUI';
import { canBlurBars } from '@/components/BarBlur';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useTheme, type BorderStyle } from '@/theme';
import {
  APP_FONT_LABELS,
  LANGUAGE_NAMES,
  useSettings,
  type CoverCorners,
  type DefaultTab,
  type SwipeAction,
} from '@/store/settings';

export default function AppearanceSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const router = useRouter();
  const t = useT();
  // The folders tab only exists with a Subsonic server (see library).
  const offline = useAuthStore((s) => s.offline);
  const local = useLocalProfile();
  const serverType = useAuthStore((s) => s.auth?.serverType);
  // Jellyfin has no folder tree to browse, so for that server the setting does
  // not exist at all. Offline it exists and is simply out of reach, which is a
  // different thing and reads as one: greyed out, where it always was (#114).
  // The local profile is the first case, not the second: the tab reads folders
  // off a Subsonic server and there is none, so the switch would be promising a
  // tab that cannot appear. (The phone's music does live in folders, and
  // browsing them is a thing worth having — but it is a thing to build, not a
  // switch to un-grey: `getMusicDirectory` has no local side.)
  const canBrowseFolders = !local && (offline || serverType !== 'jellyfin');
  const language = useSettings((s) => s.language);
  const themeMode = useSettings((s) => s.themeMode);
  const themeModeLabel = {
    system: t('System'),
    dark: t('Dark'),
    light: t('Light'),
    schedule: t('Scheduled'),
  }[themeMode];
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
  const swipeAction = useSettings((s) => s.swipeAction);
  const setSwipeAction = useSettings((s) => s.setSwipeAction);
  const swipeLeftAction = useSettings((s) => s.swipeLeftAction);
  const setSwipeLeftAction = useSettings((s) => s.setSwipeLeftAction);
  const showFolderBrowser = useSettings((s) => s.showFolderBrowser);
  const setShowFolderBrowser = useSettings((s) => s.setShowFolderBrowser);
  const hapticsEnabled = useSettings((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettings((s) => s.setHapticsEnabled);
  const appFont = useSettings((s) => s.appFont);
  const coverCorners = useSettings((s) => s.coverCorners);
  const setCoverCorners = useSettings((s) => s.setCoverCorners);
  const artistSignaturesEnabled = useSettings((s) => s.artistSignaturesEnabled);
  const setArtistSignaturesEnabled = useSettings((s) => s.setArtistSignaturesEnabled);
  const artistSignaturesApi = useSettings((s) => s.artistSignaturesApi);
  const setArtistSignaturesApi = useSettings((s) => s.setArtistSignaturesApi);
  const borderStyle = useSettings((s) => s.borderStyle);
  const setBorderStyle = useSettings((s) => s.setBorderStyle);

  return (
    <SettingsPage title={t('Appearance')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SettingsGroup>
          <SettingRow
            label={t('Language')}
            description={LANGUAGE_NAMES[language]}
            chevron
            onPress={() => router.push('/settings/language')}
          />
          <SettingRow
            label={t('Theme')}
            description={themeModeLabel}
            chevron
            onPress={() => router.push('/settings/theme')}
          />
          <SettingRow
            label={t('Font')}
            description={APP_FONT_LABELS[appFont]}
            chevron
            onPress={() => router.push('/settings/font')}
          />
          <SelectList<CoverCorners>
            label={t('Cover corners')}
            options={[
              { value: 'square', label: t('Square') },
              { value: 'rounded', label: t('Rounded') },
              { value: 'round', label: t('More rounded') },
            ]}
            value={coverCorners}
            onChange={setCoverCorners}
          />
          <SelectList<BorderStyle>
            label={t('Border radius')}
            description={t('Round corners everywhere, or flatter ones')}
            options={[
              { value: 'round', label: t('Round') },
              { value: 'pointier', label: t('Pointier') },
            ]}
            value={borderStyle}
            onChange={setBorderStyle}
          />
        </SettingsGroup>

        {/* Under its own heading, where the seven switches used to be, and not
            up with the language and the theme: it is its own thing and reads
            like one. */}
        <Text style={settingsStyles.sectionTitle}>{t('Song lists')}</Text>
        <SettingRow
          label={t('Song lists')}
          chevron
          onPress={() => router.push('/settings/song-lists')}
        />

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

        <Text style={settingsStyles.sectionTitle}>{t('Home')}</Text>
        <SettingsGroup>
          <SwitchList
            options={[
              {
                label: t('Playing on other devices'),
                description: t(
                  'At the top of Home, what is playing in your other apps and devices, ready to carry on here.',
                ),
                value: showPlayingElsewhere,
                onChange: setShowPlayingElsewhere,
              },
            ]}
          />
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
            ]}
          />
        </SettingsGroup>

        <Text style={settingsStyles.sectionTitle}>{t('Interaction')}</Text>
        <SettingsGroup>
          <SelectList<SwipeAction>
            label={t('Swipe right')}
            options={[
              { value: 'off', label: t('Off') },
              { value: 'queue', label: t('Add to queue') },
              { value: 'next', label: t('Play next') },
              { value: 'favorite', label: t('Add to favorites') },
              { value: 'menu', label: t('More options') },
            ]}
            value={swipeAction}
            onChange={setSwipeAction}
          />
          <SelectList<SwipeAction>
            label={t('Swipe left')}
            options={[
              { value: 'off', label: t('Off') },
              { value: 'queue', label: t('Add to queue') },
              { value: 'next', label: t('Play next') },
              { value: 'favorite', label: t('Add to favorites') },
              { value: 'menu', label: t('More options') },
            ]}
            value={swipeLeftAction}
            onChange={setSwipeLeftAction}
          />
          <SwitchList
            options={[
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
        <Text style={settingsStyles.sectionTitle}>{t('Artist pages')}</Text>
        <SettingsGroup>
          <SwitchList options={[
            { label: t('Artist signatures'), value: artistSignaturesEnabled, onChange: setArtistSignaturesEnabled },
          ]} />
          <TextRow label={t('Artist signatures API')} description={t('Optional HTTPS provider. Artist names are sent when signatures are enabled.')} value={artistSignaturesApi} onChange={setArtistSignaturesApi} maxLength={2048} keyboardType="url" autoCapitalize="none" />
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  );
}
