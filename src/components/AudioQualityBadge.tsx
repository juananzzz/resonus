/** Discreet label with the format, the bitrate and the sample rate. */
import { Text } from 'react-native';

import { type Song } from '@/api/subsonic';
import { qualityLabel, transcodeTarget } from '@/lib/audioQuality';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { localSourceFor } from '@/store/player';
import { useNetworkType } from '@/store/networkType';
import { useSettings } from '@/store/settings';
import { useSongCache } from '@/store/songCache';
import { fontSize, themed } from '@/theme';

export function AudioQualityBadge({ song }: { song: Song }) {
  // Out of the React Compiler: `localSourceFor` reads the two settings below
  // from their stores, and a memo would keep the answer they first gave.
  'use no memo';
  // Streaming quality depends on the current network (Wi-Fi or mobile data).
  const cellular = useNetworkType((s) => s.cellular);
  const maxBitRate = useSettings((s) => (cellular ? s.maxBitRateCellular : s.maxBitRate));
  const streamFormat = useSettings((s) => (cellular ? s.streamFormatCellular : s.streamFormat));
  const losslessOnly = useSettings((s) => s.streamLosslessOnly);
  const target = transcodeTarget(song, maxBitRate, streamFormat, losslessOnly);
  const dlUri = useDownloads((s) => s.files[song.id]);
  const dlBitRate = useDownloads((s) => s.dlBitRates[song.id]);
  const cached = useSongCache((s) => s.entries[song.id]);
  // Subscribed so the badge follows them; the rule that reads them belongs to
  // the player, and being downloaded no longer means being played from disk
  // (#108). Saying "128 kbps copy" while streaming the original is the kind of
  // lie this badge exists to prevent.
  useSettings((s) => s.preferDownloads);
  useAuthStore((s) => s.offline);
  const source = localSourceFor(song);
  const fromDownload = !!dlUri && !!source;
  // The cache's copy is only the one playing when the player picked it.
  const fromCache = !fromDownload && !!cached && source === cached.uri;
  const label = qualityLabel(
    song,
    target.bitRate,
    fromDownload ? dlUri : fromCache ? cached.uri : undefined,
    fromCache ? cached.bitRate : dlBitRate,
    target.format,
  );
  // With nothing to say it still takes its line: the player's cover is sized
  // from what is left, and a line coming and going per song resized it.
  return <Text style={styles.badge}>{label || '\u00A0'}</Text>;
}

const styles = themed((colors) => ({
  badge: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
}));
