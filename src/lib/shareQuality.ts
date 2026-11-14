/** What a shared link should stream, in Navidrome's own share terms. */
import type { TranscodeFormat } from '@/store/settings';

export interface ShareEncoding {
  /** '' when the original file is served; otherwise the requested codec. */
  format: TranscodeFormat;
  /** 0 when the original file is served; otherwise kbps. */
  maxBitRate: number;
}

/**
 * The quality a share asks Navidrome for.
 *
 * "Original" is the absence of both a codec and a cap: sending either one
 * would make the server transcode a link whose whole point was not to. A
 * positive bitrate is kept as chosen, with an empty codec left to the
 * server's default transcoder.
 */
export function shareEncoding(bitRate: number, format: TranscodeFormat): ShareEncoding {
  if (!Number.isFinite(bitRate) || bitRate <= 0) return { format: '', maxBitRate: 0 };
  return { format, maxBitRate: Math.round(bitRate) };
}
