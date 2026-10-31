/**
 * Spotify-style Settings: the account at the top as a card (avatar, name and
 * server, the offline switch and signing out), then the categories as flat
 * rows. Restoring every setting is in About: sitting here it looked like
 * one more category and was a tap away from the button that goes offline.
 */
import Icon from '@/components/Icon';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { ScreenHeader, SettingsSafeArea, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { anyDownloads, useDownloads } from '@/store/downloads';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme, tracking } from '@/theme';

/** `asTab`: shown as the Settings tab (see `(tabs)/options`), with no way back. */
export default function SettingsScreen({ asTab = false }: { asTab?: boolean }) {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const router = useRouter();
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const { accent: accentColor } = useTheme();
  useSettings((s) => s.appFont); // re-render when font changes
  const logout = useAuthStore((s) => s.logout);
  const goOnline = useAuthStore((s) => s.goOnline);
  const goOffline = useAuthStore((s) => s.goOffline);
  const offline = useAuthStore((s) => s.offline);
  // Only offer "go offline" manually if there's something downloaded to listen to.
  // Until the catalog has been read, an empty map means "not known yet", not
  // "nothing downloaded". Hiding the switch on that basis is what made it
  // disappear for the first seconds on a large library, which is exactly the
  // library that needs it.
  const hasDownloads = useDownloads((s) => !s.hydrated || anyDownloads(s));
  const toast = useToast((s) => s.show);

  // Server account in offline mode (auth intact) vs local profile (no auth).
  const serverOffline = offline && !!auth;
  const initial = serverOffline
    ? (auth?.username ?? '?').charAt(0).toUpperCase()
    : offline
      ? 'O'
      : (auth?.username ?? '?').charAt(0).toUpperCase();
  const name = offline && !auth ? t('Local profile') : auth?.username ?? '—';
  const detail = serverOffline
    ? t('Offline · your downloads')
    : offline
      ? t('Music on your device')
      : auth?.serverUrl.replace(/^https?:\/\//, '') ?? '';

  // Offline, the categories are the same categories: each screen greys out what
  // needs a server rather than taking it away, so nothing here has to disappear
  // either (#114). "Library" is the exception, since server-offline leaves it
  // with nothing but scanning, and "Local music" is what a local profile gets
  // in its place.
  const sections: {
    key: string;
    title: string;
    icon: keyof typeof Icon.glyphMap;
    disabled?: boolean;
  }[] = [
    { key: 'playback', title: 'Quality & playback', icon: 'musical-notes-outline' as const },
    { key: 'player', title: 'Player', icon: 'play-circle-outline' as const },
    // Downloads: in server-offline it reduces to used space and delete (no
    // server means no downloading, but freeing space is still useful). In the
    // local profile (no account) there are NO server downloads, so it's skipped.
    ...(offline && !auth
      ? []
      : [
          {
            key: 'downloads',
            // Named for both halves of what is in there: what gets downloaded,
            // and what the app does when there is no connection. The switch
            // that turns the mode on by itself lived here with no sign of it
            // from the outside (#89).
            title: 'Downloads & offline',
            icon: 'download-outline' as const,
          },
        ]),
    // Library: online is the server's; in local profile, the device's music.
    // Server-offline it is greyed out and says nothing else: what is inside
    // (scanning, choosing libraries) is the server's, and what could be done
    // from here without one is already in "Downloads & offline" above. The row
    // dims like any other disabled control, arrow included, which is a thing
    // people already know how to read.
    {
      key: 'library',
      title: offline && !auth ? 'Local music' : 'Library',
      icon: offline && !auth ? ('phone-portrait-outline' as const) : ('server-outline' as const),
      disabled: serverOffline,
    },
    // Network: the addresses of the server and the switching between them. It
    // is the one thing here that must work offline and not merely be visible:
    // an address that is wrong, or a server that moved, is exactly why you
    // ended up offline, and hiding this screen left no way back in short of
    // deleting the profile and signing in again (#113). Checking an address is
    // a ping, which is one of the two requests offline mode lets through. A
    // local profile has no server, so there is nothing for it here.
    ...(auth ? [{ key: 'network', title: 'Network', icon: 'git-network-outline' as const }] : []),
    // Theme lives inside Appearance (row with chevron, like Language).
    { key: 'personalization', title: 'Appearance', icon: 'color-palette-outline' as const },
    { key: 'home-navigation', title: 'Home & navigation', icon: 'grid-outline' as const },
    { key: 'about', title: 'About::app', icon: 'information-circle-outline' as const },
  ];

  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Settings')} back={!asTab} />
      {/* The same centred pane every other settings screen gets from
          `SettingsPage`; this one draws its own header, so it says it here. */}
      <View style={settingsStyles.pane}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <View style={[settingsStyles.cardBox, styles.accountCard]}>
          <View style={[settingsStyles.row, styles.profileRow]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={settingsStyles.rowLabelBox}>
              <Text style={styles.profileName}>{name}</Text>
              <Text style={settingsStyles.rowDescription} numberOfLines={1}>
                {detail}
              </Text>
            </View>
          </View>
          {/* A mode, so a switch: it says whether it is on as well as turning
              it on. Only with something to go offline to, or while offline
              already, to come back. Either way the library reloads, so Home. */}
          {auth && (serverOffline || hasDownloads) ? (
            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <Icon name="cloud-offline-outline" size={22} color={colors.textSecondary} />
              <Text style={[settingsStyles.rowLabel, styles.flex]}>{t('Offline mode')}</Text>
              <Switch
                value={serverOffline}
                onValueChange={(on) => {
                  if (on) {
                    void goOffline(false);
                    toast(t('Offline'));
                  } else {
                    void goOnline();
                  }
                  router.replace('/(tabs)');
                }}
                trackColor={{ false: colors.control, true: accentColor }}
                thumbColor={colors.knob}
              />
            </View>
          ) : null}
          {/* "Change profile" and not "Sign out": the profile and its password
              are kept, and this leads to the list of them. Not red, since
              nothing is lost. In the local profile it's "Exit local mode".
              logout() doesn't need network, so it works offline. */}
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              settingsStyles.row,
              settingsStyles.rowBorder,
              pressed && { opacity: 0.6 },
            ]}
            onPress={() => logout()}
          >
            <Icon name="people-outline" size={22} color={colors.textSecondary} />
            <Text style={settingsStyles.rowLabel}>
              {offline && !auth ? t('Exit local mode') : t('Change profile')}
            </Text>
          </Pressable>
        </View>

        {sections.map((s) => (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!s.disabled }}
            disabled={s.disabled}
            style={({ pressed }) => [
              styles.sectionRow,
              s.disabled && { opacity: 0.5 },
              pressed && !s.disabled && { opacity: 0.6 },
            ]}
            onPress={() => router.push(`/settings/${s.key}`)}
          >
            <Icon name={s.icon} size={24} color={colors.text} />
            <Text style={styles.sectionRowTitle}>{t(s.title)}</Text>
            <Icon name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        ))}

      </ScrollView>
      </View>
    </SettingsSafeArea>
  );
}

const styles = themed((colors) => ({
  accountCard: { marginBottom: spacing.md },
  profileRow: { paddingVertical: spacing.lg },
  // No ring: the card is what sets the account apart now.
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  profileName: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  flex: { flex: 1 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  sectionRowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', flex: 1 },
}));
