/**
 * The artist card that peeks below the player controls, next to (or instead of)
 * the lyrics card: the artist's photo, their name and the first lines of the
 * biography, with the full artist page one tap away.
 *
 * It draws nothing without a biography, which is also what the player asks
 * before it makes room for it: a card holding a name and an empty space under
 * it is worse than no card.
 */
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CACHED_COVER, COVER, coverArtUrl, getArtistInfo } from '@/api/data';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { fontSize, radius, spacing, themed } from '@/theme';

/** Lines of biography shown before it is expanded. */
const BIO_LINES = 3;
/** Below this the biography fits, so there is nothing to unfold. The artist
 *  screen draws its own toggle at the same length. */
const BIO_TOGGLE_AT = 220;

export function ArtistPlayerCard() {
  const t = useT();
  const router = useRouter();
  const song = usePlayerStore(currentSong);
  const artistId = song?.artistId;
  // Same question the artist screen asks: offline answers from the phone, a
  // server account from the server, and neither is true while there is no
  // profile open at all — where `getArtistInfo` has no account to sign with.
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const [bioExpanded, setBioExpanded] = useState(false);

  const { data: info } = useQuery({
    queryKey: ['artistInfo', artistId],
    queryFn: () => getArtistInfo(artistId!),
    enabled: canFetch && !!artistId,
  });

  // The artist's photo, falling back to their cover art. Offline that can come
  // back marked (see `CACHED_COVER`), which only `Cover` knows how to read and
  // this banner is not square: rather than a broken request, no photo.
  const photo = info?.imageUrl ?? coverArtUrl(artistId, COVER.card);
  const imageUri = photo?.startsWith(CACHED_COVER) ? undefined : photo;

  if (!song || !artistId || !info?.biography) return null;

  return (
    <View style={styles.card}>
      {/* The whole card goes to the artist, the way tapping the cover goes to
          the lyrics. The toggle below is a Pressable of its own, so it takes
          its own taps and only unfolds the text. */}
      <Pressable accessibilityRole="button" onPress={() => router.push(`/artist/${artistId}`)}>
        <View style={styles.photo}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
          <Text style={styles.label}>{t('About the artist')}</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {song.artist}
          </Text>
          <Text style={styles.bio} numberOfLines={bioExpanded ? undefined : BIO_LINES}>
            {info.biography}
          </Text>
          {info.biography.length > BIO_TOGGLE_AT ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setBioExpanded((on) => !on)}
            >
              <Text style={styles.more}>{bioExpanded ? t('Show less') : t('Show more')}</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

/** How tall the photo is. A band across the card, like Spotify's. */
const PHOTO_H = 180;

const styles = themed((colors) => ({
  card: {
    // The page's own colour rather than a card surface or the cover's tint: it
    // is what sits under a photo that runs to the edges, and the blurred
    // backdrop behind the player is what makes it read as a card at all.
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    // The player has no global horizontal padding (because of the slider), so
    // the card supplies its own margin — the same one as the lyrics card.
    marginHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  photo: {
    height: PHOTO_H,
    width: '100%',
    backgroundColor: colors.surfaceHighlight,
  },
  label: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    // Over a photo, so it is white in both appearances and carries its own
    // shadow for the pictures that are pale up there.
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  body: {
    padding: spacing.lg,
  },
  name: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  bio: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  more: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
}));
