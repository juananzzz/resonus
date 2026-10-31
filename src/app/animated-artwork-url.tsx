/**
 * Per-album Apple Music URL for the animated artwork, from the album's ⋯
 * menu. Asked before the search and trusted as chosen: it pins an album the
 * fuzzy search keeps mismatching to the exact artwork.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SettingsPage, TextRow } from '@/components/SettingsUI';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { animatedArtworkKey } from '@/lib/animatedArtwork';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { fontSize, radius, spacing, themed, useTheme } from '@/theme';

export default function AnimatedArtworkUrlScreen() {
  useTheme();
  const router = useRouter();
  const t = useT();
  const toast = useToast((s) => s.show);
  const { artist, album } = useLocalSearchParams<{ artist?: string; album?: string }>();
  const key = animatedArtworkKey(artist ?? '', album ?? '');
  const { width } = useScreenSize();
  const saved = useSettings((s) => s.animatedArtworkUrls[key]);
  const setAnimatedArtworkUrl = useSettings((s) => s.setAnimatedArtworkUrl);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved ?? '';
  const save = () => {
    const url = value.trim();
    if (!url.startsWith('http')) {
      toast(t('That does not look like an Apple Music URL.'));
      return;
    }
    setAnimatedArtworkUrl(key, url);
    toast(t('Animated artwork URL saved.'));
    router.back();
  };
  const forget = () => {
    setAnimatedArtworkUrl(key, null);
    toast(t('Animated artwork URL removed.'));
    router.back();
  };
  return (
    <SettingsPage title={t('Animated cover')}>
      <View style={{ paddingHorizontal: centredPadding(width, spacing.lg) }}>
      <TextRow
        label={t('Apple Music URL')}
        description={t('The album page on Apple Music whose animated cover plays for this album.')}
        value={value}
        placeholder="https://music.apple.com/…/album/…"
        maxLength={300}
        keyboardType="url"
        autoCapitalize="none"
        onChange={setDraft}
      />
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          onPress={save}
        >
          <Text style={styles.primaryText}>{t('Save')}</Text>
        </Pressable>
        {saved ? (
          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            onPress={forget}
          >
          <Text style={styles.secondaryText}>{t('Remove')}</Text>
        </Pressable>
        ) : null}
      </View>
      </View>
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  primary: {
    flex: 1,
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryText: { color: colors.onInverse, fontSize: fontSize.md, fontWeight: '600' },
  secondary: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  secondaryText: { color: colors.text, fontSize: fontSize.md },
}));
