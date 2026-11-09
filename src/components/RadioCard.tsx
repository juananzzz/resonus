/** Radio card for the Home shelf: the generated icon file when there is one,
 *  the same collage drawn as views when there isn't, artists underneath. */
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Cover } from './Cover';
import { songsLabel, useT } from '@/i18n';
import { useAccent } from '@/hooks/useAccent';
import { haptic } from '@/lib/haptics';
import { usePlayerStore } from '@/store/player';
import { collageCovers, textOn } from '@/lib/radioArt';
import { PlayingBars } from './PlayingBars';
import { openRadioMenu } from './RadioMenuSheet';
import { useSettings } from '@/store/settings';
import { useRadios, type RadioDef } from '@/store/radios';
import { tintForMode } from '@/hooks/useDominantColor';
import { colors, fontSize, radius, spacing, themed, useTheme, useThemeMode } from '@/theme';

/**
 * The icon as the native module draws it, in views: same layout, so the
 * shelf looks the same on a build without the module as on one with it.
 */
function RadioCollage({
  def,
  width,
  bare,
  color,
}: {
  def: RadioDef;
  width: number;
  /** The background, when it is not the one the radio was built with. */
  color?: string;
  /** No words on the picture: the screen that wears this as its header says
   *  the name underneath it already. */
  bare?: boolean;
}) {
  const bg = color || def.color || colors.surfaceHighlight;
  const ink = textOn(bg);
  const covers = collageCovers(def);
  const artists = covers.length;
  const sideD = Math.round(width * 0.4);
  const centerD = Math.round(width * 0.6);
  // A side with no artist behind it is left out, not drawn as an empty disc.
  const circle = (i: number, size: number, left: number, top: number, key: string) =>
    i >= artists ? null : (
      <Cover
        key={key}
        uri={covers[i]}
        size={size}
        rounded
        placeholderIcon="person-outline"
        transition={0}
        style={{ position: 'absolute', left, top }}
      />
    );
  return (
    <View
      style={[
        styles.collage,
        { width, height: width, backgroundColor: bg },
        bare ? { overflow: 'visible' } : null,
      ]}
    >
      {/* Sides first, the seed's own cover on top of them - the same order
          the native renderer paints in, and the same numbers (its 0.10/0.90
          centres): the file and the views are one picture. */}
      {circle(1, sideD, -Math.round(sideD * 0.25), Math.round(width * 0.34), 'left')}
      {circle(2, sideD, width - sideD + Math.round(sideD * 0.25), Math.round(width * 0.34), 'right')}
      {circle(0, centerD, Math.round((width - centerD) / 2), Math.round(width * 0.16), 'center')}
      {bare ? null : (
        <>
          <Text
            style={[styles.collageWord, { color: ink, textShadowColor: shadow(ink) }]}
            numberOfLines={1}
          >
            RADIO
          </Text>
          <Text
            style={[styles.collageName, { color: ink, textShadowColor: shadow(ink) }]}
            numberOfLines={2}
          >
            {def.seed.name}
          </Text>
        </>
      )}
    </View>
  );
}

/** The name sits over covers nobody chose: a shadow keeps it readable on
 *  whichever of them is bright. White on dark ink, black on light. */
function shadow(ink: string): string {
  return ink === '#FFFFFF' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)';
}

/** The radio's picture: the generated icon file when there is one, the same
 *  collage drawn as views when there isn't. Shared with the radio screen, so
 *  the shelf and the screen show one image. `cropHeight` turns the square
 *  into a shorter, full-bleed rectangle for the screen's header: the art is
 *  bottom-aligned inside it, so the crop takes the top off - the decorative
 *  RADIO word goes, the artist's name at the bottom stays, untouched. `bare`
 *  is the header's variant: no words at all, since the file would carry the
 *  name baked in and the title underneath says it already. */
export function RadioArt({
  def,
  width,
  cropHeight,
  bare,
  padTop = 0,
}: {
  def: RadioDef;
  width: number;
  cropHeight?: number;
  bare?: boolean;
  /** What covers the top of a cropped header (status bar and top bar): the
   *  circles are fitted below it instead of hanging under it. */
  padTop?: number;
}) {
  const uri = useRadios((s) => s.icons[def.seed.id]);
  // The screen's header takes the colour in the current appearance, like the
  // gradient it runs into; the card keeps the one its icon file was drawn in.
  const mode = useThemeMode();
  const tint = bare && def.color ? tintForMode(def.color, mode, true) : undefined;
  const height = cropHeight ?? width;
  // Corners only when the art is the card's full square: the screen's cover
  // runs edge to edge of the display and has none. The frame wears the radio
  // colour behind the art: the cropped strip above it would otherwise show
  // the page background (a black bar in the dark theme).
  const frame = {
    width,
    height,
    overflow: 'hidden' as const,
    borderRadius: cropHeight == null ? radius.md : 0,
    backgroundColor: tint || def.color || colors.surfaceHighlight,
  };
  const art = !bare && uri ? (
    <Image source={{ uri }} style={{ width, height: width }} contentFit="cover" transition={150} />
  ) : (
    <RadioCollage def={def} width={width} bare={bare} color={tint} />
  );
  if (height >= width) return <View style={frame}>{art}</View>;
  if (bare) {
    // The circles span 0.16 to 0.76 of the square: scale it so that band
    // fits between the bars and the bottom edge, and centre it there.
    const room = height - padTop - spacing.lg;
    const side = Math.min(width, room / 0.6);
    const top = padTop + (room - side * 0.6) / 2 - side * 0.16;
    return (
      <View style={frame}>
        <View style={{ position: 'absolute', left: (width - side) / 2, top }}>
          <RadioCollage def={def} width={side} bare color={tint} />
        </View>
      </View>
    );
  }
  // The square hangs from the bottom of the rectangle: whatever is cut off
  // is cut from above, which is where the word is.
  return (
    <View style={frame}>
      <View style={{ width, height: width, marginTop: height - width }}>{art}</View>
    </View>
  );
}

export const RadioCard = memo(function RadioCard({
  def,
  width,
}: {
  def: RadioDef;
  width: number;
}) {
  // Memoised, so it has to ask for a repaint on a theme change itself.
  useTheme();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const playingHere = usePlayerStore((s) => s.sourceHref === `/artist-radio/${def.seed.id}`);
  const accent = useAccent();
  const similar = def.similar.slice(0, 3).map((a) => a.name);
  // The seed's name is on the picture already; with nobody beside it, the
  // line says how much is in it instead of saying the name twice.
  const artists =
    similar.length > 0
      ? similar.join(', ')
      : def.tracks
        ? songsLabel(def.tracks.length, lang)
        : t('Radio');

  return (
    <Link href={`/artist-radio/${def.seed.id}`} asChild>
      <Pressable
        style={StyleSheet.flatten([styles.container, { width }])}
        accessibilityRole="button"
        accessibilityLabel={def.seed.name}
        onLongPress={() => {
          haptic('light');
          openRadioMenu(def, def.tracks ?? []);
        }}
      >
        <RadioArt def={def} width={width} />
        {/* The radio that is playing says so where a list's playing row
            does: the bars, and its line in the accent. */}
        <View style={styles.caption}>
          {playingHere ? <PlayingBars size={12} /> : null}
          <Text
            style={[styles.artists, playingHere && { color: accent }]}
            numberOfLines={1}
          >
            {artists}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
});

const styles = themed((t) => ({
  container: { gap: spacing.xs },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  artists: {
    flexShrink: 1,
    color: t.textSecondary,
    fontSize: fontSize.sm,
  },
  collage: {
    // The radius is the frame's, outside: the collage only has to keep its
    // circles inside the square.
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  collageWord: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.sm,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.5,
    textShadowRadius: 3,
  },
  collageName: {
    color: t.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    textShadowRadius: 4,
  },
}));
