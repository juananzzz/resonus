/**
 * The profile picture beside the Home chips: round, as tall as a chip, one
 * more chip in the row. Tapping it opens Settings, which is why it is forced
 * on while the settings gear is off.
 */
import { Pressable } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { colors, themed } from '@/theme';

/** As tall as a chip: its vertical padding twice plus one line of text. */
export const AVATAR_SIZE = 32;

export function ProfileAvatar() {
  const t = useT();
  const uri = useSettings((s) => s.profileImageUri);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('Settings')}
      onPress={() => router.push('/settings')}
      style={styles.touch}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={styles.image}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.fallback}>
          <Icon name="person-outline" size={18} color={colors.textSecondary} />
        </View>
      )}
    </Pressable>
  );
}

const styles = themed((colors) => ({
  touch: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  image: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  fallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
