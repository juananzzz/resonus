import { useQuery } from '@tanstack/react-query';
import { Image, type ImageRef } from 'expo-image';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { useT } from '@/i18n';
import { getArtistHeaderSignature } from '@/lib/artistHeaderSignature';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';
import { useSettings } from '@/store/settings';
import { publicHttpsUrl } from '@/lib/artworkSources';

/** The real name remains accessible and visible until an autograph has drawn. */
export function ArtistSignature({ name, width, musicBrainzId }: { name: string; width: number; musicBrainzId?: string }) {
  const t = useT();
  const enabled = useSettings((s) => s.artistSignaturesEnabled);
  const appleLogos = useSettings((s) => s.appleArtistLogos);
  const offline = useAuthStore((s) => s.offline);
  const api = useSettings((s) => s.artistSignaturesApi);
  const { data: signature } = useQuery({
    queryKey: ['artist-header-signature-v9', enabled, api, appleLogos, name, musicBrainzId, offline, colors.text],
    queryFn: () => getArtistHeaderSignature(name, {
      api: enabled ? api : undefined, appleLogos, offline, tintColor: colors.text, musicBrainzId,
    }),
    enabled: appleLogos || (enabled && !!publicHttpsUrl(api)),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const [displayed, setDisplayed] = useState<ImageRef>();
  const [failed, setFailed] = useState<ImageRef>();
  const shown = !!signature && displayed === signature.image && failed !== signature.image;
  const imageWidth = Math.min(280, width - spacing.lg * 2);
  return (
    <Pressable
      accessibilityRole={shown ? 'button' : undefined}
      accessibilityLabel={name}
      accessibilityHint={shown ? t('Show signature source') : undefined}
      disabled={!shown}
      onPress={() => Alert.alert(name, signature?.attribution || name)}
      style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, minHeight: 104, justifyContent: 'flex-end', alignItems: 'center' }}
    >
      {shown ? <View style={{ height: 88 }} /> : (
        <Text numberOfLines={2} style={{ color: colors.text, fontSize: fontSize.xxl, fontWeight: '600', textAlign: 'center' }}>{name}</Text>
      )}
      {signature && failed !== signature.image ? (
        <Image
          source={signature.image}
          style={{ position: 'absolute', left: (width - imageWidth) / 2, bottom: spacing.md, width: imageWidth, height: 88, opacity: shown ? 1 : 0 }}
          contentFit="contain"
          contentPosition="bottom"
          recyclingKey={`${api}\n${name}\n${signature.imageUrl}`}
          onDisplay={() => setDisplayed(signature.image)}
          onError={() => setFailed(signature.image)}
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
}
