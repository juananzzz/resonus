/**
 * The file addresses a song download should try, in order.
 *
 * A server answering for the quality asked for is the first choice; the
 * original file is the fallback. That is what a failed transcode must not take
 * away: Navidrome can answer "no such file or directory" from its transcoding
 * cache (and refuse every retry the same way) while the file it would have
 * transcoded is readable. Asking for the original gets the song onto the phone
 * at all, which is the point of the download (#328).
 *
 * The original arrives through two endpoints because servers do not agree on
 * them: `/rest/download` is the documented one, and `/rest/stream` with no
 * bitrate serves the same bytes on servers (or proxies) that refuse downloads.
 * Repeating an address that two of those happen to share would only cost the
 * server another request per failure, so the plan keeps each address once.
 */
import type { Song } from '@/api/subsonic';

export type DownloadSourceKind = 'transcode' | 'download' | 'stream';

export interface DownloadSource {
  kind: DownloadSourceKind;
  url: string;
  /** Extension the bytes at this address will have on disk. */
  ext: string;
  /** Bitrate the server was asked to transcode to, absent for an original. */
  bitRate?: number;
}

/** What the download quality settings ask the server for. */
export interface DownloadQuality {
  bitRate: number;
  format: string;
}

/** The three addresses `downloadSources` chooses between. */
export interface DownloadUrls {
  transcode: string;
  download: string;
  stream: string;
}

// File extension the server returns when transcoding to each codec.
// '' = default transcoder (MP3 in Navidrome). AAC: Navidrome outputs raw
// ADTS (.aac); other servers may use MP4 container (.m4a), but it sounds
// the same (expo-audio detects by content) and only the label would vary.
const FORMAT_EXT: Record<string, string> = { '': 'mp3', mp3: 'mp3', opus: 'opus', aac: 'aac' };

/** Every address one song download should try, best quality first. */
export function downloadSources(
  song: Pick<Song, 'suffix'>,
  quality: DownloadQuality,
  urls: DownloadUrls,
): DownloadSource[] {
  // The original file keeps the server's own extension. A song that does not
  // name one predates the field or comes from a server that leaves it out;
  // MP3 is what every Subsonic server can be expected to send by default.
  const originalExt = song.suffix || 'mp3';
  const plan: DownloadSource[] = [];

  // No bitrate means the quality asked for IS the original file (including
  // "don't transcode lossy": `transcodeTarget` clears it), so asking the
  // transcode endpoint would be the same request with a made-up format.
  if (quality.bitRate > 0) {
    plan.push({
      kind: 'transcode',
      url: urls.transcode,
      ext: FORMAT_EXT[quality.format] ?? 'mp3',
      bitRate: quality.bitRate,
    });
  }

  plan.push({ kind: 'download', url: urls.download, ext: originalExt });
  plan.push({ kind: 'stream', url: urls.stream, ext: originalExt });

  const seen = new Set<string>();
  return plan.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}
