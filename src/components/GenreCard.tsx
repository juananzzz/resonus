/** Colored card for a genre, with its first covers fanned out. Links to /genre/[name]. */
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER } from '@/api/data';
import { Cover } from '@/components/Cover';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useGenreArt } from '@/hooks/useGenreArt';
import { albumsLabel } from '@/i18n';
import { useSettings } from '@/store/settings';
import { fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { bump } from '@/lib/perfLog';

/**
 * The card's height, and the size of the covers on it. Both fixed: the columns
 * decide how wide a card is (#131), and the art keeps its own proportion at
 * any of those widths.
 */
export const GENRE_CARD_HEIGHT = 108;
const ART_SIZE = 92;

/** Stable hue derived from the genre name. */
function genreHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

/**
 * How bright a card is, and how bright the writing on it is, as sRGB relative
 * luminance rather than as a lightness. The saturation is the accent's own.
 *
 * Both numbers are read against `#1DB954`, which measures 0.356 at 73%: a card
 * is a shade under the app's green and just as saturated, so a grid of them
 * carries the weight everything else on the page does. Pale is what they were
 * first, and pale was the one thing in the app that looked borrowed.
 *
 * They also fix the contrast of the writing, at (0.30 + 0.05) / (0.02 + 0.05),
 * for every hue at once.
 */
const CARD_LUMA = 0.3;
const INK_LUMA = 0.02;
const SATURATION = 0.72;

function hslLuminance(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = (
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  ).map((v) => {
    const u = v + m;
    return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The lightness that puts a hue at `target` brightness.
 *
 * One lightness for every hue is not one brightness: yellow at 60% is three
 * times as bright as blue at the same 60%, and a grid built that way reads as a
 * random handful of colours rather than as a palette. Solved rather than
 * tabulated, and remembered per hue, so the saturation and the two targets
 * above stay the only numbers anybody has to touch.
 */
const solved = new Map<string, number>();
function lightnessFor(hue: number, target: number): number {
  const key = `${hue}:${target}`;
  const seen = solved.get(key);
  if (seen !== undefined) return seen;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (hslLuminance(hue, SATURATION, mid) < target) lo = mid;
    else hi = mid;
  }
  const l = Math.round((lo + hi) * 5000) / 100;
  solved.set(key, l);
  return l;
}

function genreColors(name: string): { card: string; ink: string } {
  const hue = genreHue(name);
  const s = SATURATION * 100;
  return {
    card: `hsl(${hue}, ${s}%, ${lightnessFor(hue, CARD_LUMA)}%)`,
    ink: `hsl(${hue}, ${s}%, ${lightnessFor(hue, INK_LUMA)}%)`,
  };
}

export const GenreCard = memo(function GenreCard({
  name,
  albumCount,
  width,
}: {
  name: string;
  albumCount?: number;
  width?: number;
}) {
  const { coverArtUrl } = useCoverUrls();
  bump('render · GenreCard');
  // Not for the card's own colour, which no longer follows the appearance, but
  // for the grey behind a cover that has not arrived: on Search the grid is
  // memoised, so nothing above would repaint these.
  useTheme();
  const lang = useSettings((s) => s.language);
  const albums = useGenreArt(name, albumCount);
  /**
   * The same card under both appearances. Splitting it by appearance was tried
   * and put back: the deep card the light theme was given is a wall of heavy
   * blocks on white, and on near-black it swallows every dark cover standing on
   * it. Dark writing on a coloured block works on either page.
   */
  const { card, ink } = genreColors(name);
  // An album with no artwork is left out rather than given a placeholder: a
  // grey square is more conspicuous on one of these than a card with no art.
  const art = (albums ?? [])
    .map((a) => coverArtUrl(a.coverArt ?? a.id, COVER.thumb))
    .filter((uri): uri is string => !!uri);

  return (
    <Link href={`/genre/${encodeURIComponent(name)}`} asChild>
      <Pressable
        style={StyleSheet.flatten([
          styles.card,
          { backgroundColor: card },
          width != null ? { width } : { flex: 1 },
        ])}
      >
        {/* Back one first, so the more turned one lands on top of it. The card
            has no padding of its own: these are positioned against its edges,
            and the label carries the insets instead. */}
        {art.map((uri, i) => (
          <View key={i} style={i === 0 ? styles.back : styles.front}>
            <Cover uri={uri} size={ART_SIZE} style={styles.cover} />
          </View>
        ))}
        <View style={styles.label}>
          <Text style={[styles.name, { color: ink }]} numberOfLines={2}>
            {name}
          </Text>
          {albumCount != null ? (
            <Text style={[styles.count, { color: ink }]} numberOfLines={1}>
              {albumsLabel(albumCount, lang)}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
});

const styles = themed((colors) => ({
  card: { height: GENRE_CARD_HEIGHT, borderRadius: radius.lg, overflow: 'hidden' },
  /** The right inset is what keeps the name clear of the covers. */
  label: { paddingTop: spacing.md, paddingLeft: spacing.md, paddingRight: ART_SIZE },
  name: { fontSize: fontSize.md, fontWeight: '500' },
  count: { fontSize: fontSize.sm, marginTop: 2 },
  // Both hang off the right edge and out of the bottom; the card clips them,
  // which is what makes the pair read as a stack rather than as two pictures.
  // The background is not decoration: Android takes the shadow from the view's
  // outline, and a view with nothing behind it has none, so a rounded cover
  // would be given a square one.
  back: {
    position: 'absolute',
    top: 16,
    right: -6,
    transform: [{ rotate: '10deg' }],
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceHighlight,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  front: {
    position: 'absolute',
    top: 28,
    right: -26,
    transform: [{ rotate: '25deg' }],
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceHighlight,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  cover: { borderRadius: radius.lg },
}));
