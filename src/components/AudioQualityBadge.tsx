/** Etiqueta discreta con el formato, bitrate y si es lossless/Hi-Res. */
import { StyleSheet, Text } from 'react-native';

import { type Song } from '@/api/subsonic';
import { useT } from '@/i18n';
import { colors, fontSize } from '@/theme';

const LOSSLESS = new Set([
  'flac', 'wav', 'alac', 'aiff', 'ape', 'wv', 'dsd', 'dsf', 'wma',
]);

function qualityLabel(song: Song, t: (k: string) => string): string | null {
  if (song.localUri || !song.suffix) return null;
  const fmt = song.suffix.toUpperCase();
  const parts: string[] = [fmt];

  const lossless = LOSSLESS.has(song.suffix.toLowerCase());
  const hiRes =
    (song.bitDepth != null && song.bitDepth > 16) ||
    (song.samplingRate != null && song.samplingRate > 48000);

  if (hiRes) {
    parts.push(t('Hi-Res'));
  } else if (lossless) {
    parts.push(t('Lossless'));
  }

  if (song.bitRate && song.bitRate > 0) {
    parts.push(`${song.bitRate} kbps`);
  }

  if (song.bitDepth || song.samplingRate) {
    const depth = song.bitDepth ? `${song.bitDepth}-bit` : '';
    const rate = song.samplingRate
      ? song.samplingRate >= 1000
        ? `${song.samplingRate / 1000} kHz`
        : `${song.samplingRate} Hz`
      : '';
    const sample = [depth, rate].filter(Boolean).join(' / ');
    if (sample) parts.push(sample);
  }

  return parts.join(' · ');
}

export function AudioQualityBadge({ song }: { song: Song }) {
  const t = useT();
  const label = qualityLabel(song, t);
  if (!label) return null;
  return <Text style={styles.badge}>{label}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
});
