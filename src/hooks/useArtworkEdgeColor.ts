import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';

import { CACHED_COVER } from '@/api/data';
import { isManualOffline } from '@/api/netGate';
import { readableArtworkColor } from '@/lib/artworkColors';
import { colors, useThemeMode } from '@/theme';

const samples = new Map<string, Promise<string | undefined>>();

async function sampleEdge(uri: string, edge: 'top' | 'bottom'): Promise<string | undefined> {
  const marked = uri.startsWith(CACHED_COVER);
  const url = marked ? uri.slice(CACHED_COVER.length) : uri;
  const cached = await Image.getCachePathAsync(url).catch(() => null);
  if (!cached && !url.startsWith('file://') && (marked || isManualOffline())) return;
  const local = cached ? `file://${cached.replace(/^file:\/\//, '')}` : url;
  const context = ImageManipulator.manipulate(local);
  let file: string | undefined;
  try {
    const original = await context.renderAsync();
    if (edge === 'top') context.crop({ originX: 0, originY: 0, width: original.width, height: Math.min(12, original.height) });
    original.release();
    context.resize(edge === 'top' ? { width: 96, height: 4 } : { width: 96 });
    const small = await context.renderAsync();
    const stripContext = ImageManipulator.manipulate(small);
    try {
      const stripHeight = edge === 'top' ? small.height : Math.max(1, Math.round(small.height * 0.12));
      stripContext.crop({ originX: 0, originY: small.height - stripHeight, width: small.width, height: stripHeight });
      const strip = await stripContext.renderAsync();
      try {
        file = (await strip.saveAsync({ format: SaveFormat.PNG })).uri;
        const { getColors } = await import('react-native-image-colors');
        const palette = await getColors(file, { fallback: colors.background, cache: false, quality: 'highest' });
        return palette.platform === 'ios' ? palette.background : palette.dominant;
      } finally { strip.release(); }
    } finally { stripContext.release(); small.release(); }
  } finally {
    context.release();
    if (file) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
  }
}

/** Bottom 12% or the top 12 source pixels, retaining the edge hue for themed text. */
export function useArtworkEdgeColor(uri?: string, edge: 'top' | 'bottom' = 'bottom', preserveBrightness = false): string {
  const mode = useThemeMode();
  const [sample, setSample] = useState<{ uri: string; color: string }>();
  useEffect(() => {
    if (!uri) return;
    let active = true;
    const key = `${edge}:${uri}`;
    let task = samples.get(key);
    if (!task) {
      task = sampleEdge(uri, edge).catch(() => undefined);
      samples.set(key, task);
      if (samples.size > 64) samples.delete(samples.keys().next().value!);
      // A miss may succeed once the cover has arrived or the network returns.
      void task.then((color) => { if (!color) samples.delete(key); });
    }
    void task.then((color) => { if (active && color) setSample({ uri, color }); });
    return () => { active = false; };
  }, [uri, edge]);
  return sample && sample.uri === uri ? (preserveBrightness ? sample.color : readableArtworkColor(sample.color, mode)) : colors.background;
}
