/**
 * Settings › Profile picture: the round image beside the Home chips.
 *
 * Picked the way a radio cover is (same image library options, which is what
 * stays crash-free on iOS), then copied into the app's own documents: the
 * picker's file lives in a cache the system may sweep, and a swept avatar
 * would leave a hole in the header. Tapping the picture on Home opens
 * Settings, which is why it is forced on while the settings gear is off.
 */
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import Icon from '@/components/Icon';
import {
  SettingRow,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { colors, spacing, themed, useTheme } from '@/theme';

const AVATAR_FILE = 'profile-avatar.jpg';
const PREVIEW_SIZE = 72;

export default function ProfilePictureSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const showProfileImage = useSettings((s) => s.showProfileImage);
  const setShowProfileImage = useSettings((s) => s.setShowProfileImage);
  const profileImageUri = useSettings((s) => s.profileImageUri);
  const setProfileImageUri = useSettings((s) => s.setProfileImageUri);
  const gearOn = useSettings((s) => s.homeButtons.some((b) => b.key === 'settings' && b.enabled));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pick() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      const asset = res.assets?.[0];
      if (res.canceled || !asset) return;
      const dest = `${FileSystem.documentDirectory ?? ''}${AVATAR_FILE}`;
      await FileSystem.copyAsync({ from: asset.uri, to: dest });
      setFailed(false);
      setProfileImageUri(dest);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      if (profileImageUri) {
        await FileSystem.deleteAsync(profileImageUri, { idempotent: true }).catch(() => {});
      }
      setProfileImageUri(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage title={t('Profile picture')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SettingsGroup>
          <View style={styles.preview}>
            {profileImageUri && !failed ? (
              <Image
                source={{ uri: profileImageUri }}
                style={styles.image}
                onError={() => setFailed(true)}
              />
            ) : (
              <View style={styles.fallback}>
                <Icon name="person-outline" size={32} color={colors.textSecondary} />
              </View>
            )}
          </View>
          {gearOn ? (
            <SwitchList
              options={[
                {
                  label: t('Show profile picture'),
                  description: t('Round, beside the Home chips: tapping it opens Settings.'),
                  value: showProfileImage,
                  onChange: setShowProfileImage,
                },
              ]}
            />
          ) : (
            <SettingRow
              label={t('Show profile picture')}
              description={t(
                'With the settings icon off, your picture stays on so settings are one tap away.',
              )}
              right={t('Always shown')}
            />
          )}
          <SettingRow
            label={t('Choose photo')}
            icon="image-outline"
            onPress={() => void pick()}
          />
          {profileImageUri ? (
            <SettingRow
              label={t('Remove photo')}
              icon="trash-outline"
              destructive
              onPress={() => void remove()}
            />
          ) : null}
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  preview: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  image: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: PREVIEW_SIZE / 2,
  },
  fallback: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: PREVIEW_SIZE / 2,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
