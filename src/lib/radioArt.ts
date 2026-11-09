/**
 * The radio icons: three overlapping circles over the seed's colour with the
 * artist's name on them (the Spotify radio look), written as one PNG per
 * radio under `radios/` so the shelf shows the same picture every time
 * without redrawing it.
 *
 * The drawing itself happens in the native module `RadioArt` (there is no way
 * to rasterise a view from JS on React Native). On a build without the
 * module - a dev client that predates it - `ensureRadioIcon` gives up and
 * RadioCard draws the same collage as live views instead, which is the same
 * picture for as long as the shelf is on screen.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as FileSystem from 'expo-file-system/legacy';

import { COVER, coverArtUrl } from '@/api/data';
import { radioIconPath, RADIO_DIR, useRadios, type RadioDef } from '@/store/radios';

interface RadioArtModule {
  /** The options as one JSON string (the same shape as `GenerateOptions`),
   *  so neither platform has to map a JS object field by field. */
  generate: (payloadJson: string) => Promise<string>;
}

interface GenerateOptions {
  outPath: string;
  backgroundColor: string;
  textColor: string;
  title: string;
  /** Up to three cover URLs: seed first, then similar artists. */
  images: string[];
}

const native = requireOptionalNativeModule<RadioArtModule>('RadioArt');

/**
 * The collage's covers: the seed, then up to two similar artists. A seed with
 * no picture of its own wears its first track's album instead of an empty
 * circle in the middle of its card.
 */
export function collageCovers(def: RadioDef): (string | undefined)[] {
  const album = def.tracks?.find((s) => s.coverArt)?.coverArt;
  const seed = def.seed.coverArt || album || def.seed.id;
  return [
    coverArtUrl(seed, COVER.card),
    ...def.similar.slice(0, 2).map((a) => coverArtUrl(a.coverArt ?? a.id, COVER.card)),
  ];
}

/** Relative luminance of a `#rrggbb` colour, 0..1. Invalid input reads as
 *  dark, which is the side that keeps text visible anyway. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** Black or white, whichever reads on `hex`: the icon's and the header's
 *  own text colour, decided from the background it sits on. */
export function textOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#000000' : '#FFFFFF';
}

/** The icon for one radio: its file if it is already there, the file written
 *  by the native module if it isn't, or null when there is neither (the
 *  caller falls back to the live collage). */
export async function ensureRadioIcon(def: RadioDef): Promise<string | null> {
  try {
    // No colour yet: the collage stands in until a refresh finds one, and the
    // file is drawn then rather than baked in grey.
    if (!native || !def.color) return null;
    const path = radioIconPath(def);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) return path;
    await FileSystem.makeDirectoryAsync(RADIO_DIR, { intermediates: true });
    const images = collageCovers(def).filter((u): u is string => !!u);
    const options: GenerateOptions = {
      outPath: path,
      backgroundColor: def.color,
      textColor: textOn(def.color),
      title: def.seed.name,
      images,
    };
    return await native.generate(JSON.stringify(options));
  } catch {
    return null;
  }
}

/** Every icon the shelf doesn't have yet, best effort: each one that lands
 *  goes into the store (the card repaints); each one that doesn't leaves the
 *  collage. */
export async function ensureRadioIcons(defs: RadioDef[]): Promise<void> {
  await Promise.all(
    defs.map(async (def) => {
      const uri = await ensureRadioIcon(def);
      if (uri) useRadios.getState().setIcon(def.seed.id, uri);
    }),
  );
}
