/**
 * Sharing a song, album or playlist with someone else: the server mints a
 * public link (`createShare`) and the system share sheet takes it from there.
 *
 * Subsonic only — Jellyfin has no equivalent — and only when the server allows
 * it, which is what `useCanShare` checks before showing any button.
 */
import { Share } from 'react-native';

import { createNativeShare, setShareDownloadable } from '@/api/navidrome';
import { createShare, getShareUrl } from '@/api/subsonic';
import { shareEncoding } from '@/lib/shareQuality';
import { useAuthStore } from '@/store/auth';
import type { TranscodeFormat } from '@/store/settings';

/**
 * Can this profile decide whether a link allows downloading? Only Navidrome
 * can, and only through its own API, so only a Navidrome profile that kept the
 * password for it (they all do since playlist covers; older ones may not).
 */
export function canShareDownloads(): boolean {
  const auth = useAuthStore.getState().auth;
  return auth?.serverType === 'navidrome' && !!auth.ndPassword;
}

/** Transcoding a shared link is the same native API that downloads use. */
export function canShareQuality(): boolean {
  return canShareDownloads();
}

export interface ShareResult {
  /** The link exists and was handed to the system. */
  ok: boolean;
  /** The link was made, but downloads could not be turned on for it. */
  downloadsFailed?: boolean;
}

/**
 * Creates the link and opens the share sheet. `ok` is false if the server
 * refused to create it (sharing turned off, no permission, no connection), so
 * the caller can say so; the sheet being dismissed is not a failure.
 *
 * `expiresAt` is when the link should stop working (ms since 1970); without it
 * the server's own default decides, as it always did. `downloadable` only means
 * anything where `canShareDownloads` is true, and failing at it doesn't sink
 * the share: a link that plays is still a link. `bitRate` and `format` are the
 * same: 0/served original unless `canShareQuality` is true.
 */
export async function shareItem(
  id: string,
  description?: string,
  expiresAt?: number,
  downloadable?: boolean,
  bitRate = 0,
  format: TranscodeFormat = '',
): Promise<ShareResult> {
  const auth = useAuthStore.getState().auth;
  if (!auth) return { ok: false };
  const encoding = shareEncoding(bitRate, format);
  const transcodes = encoding.maxBitRate > 0 && canShareQuality();
  let share: { id: string; url: string };
  try {
    if (transcodes) {
      // Native creation is what can write the format and the cap; Subsonic's
      // `createShare` has no field for either. Ask the server back for the URL
      // so `ND_SHAREURL` still decides what is handed out.
      const shareId = await createNativeShare(auth, id, {
        description,
        expiresAt,
        downloadable,
        format: encoding.format,
        maxBitRate: encoding.maxBitRate,
      });
      let url: string | null = null;
      try {
        url = await getShareUrl(auth, shareId);
      } catch {
        // The link exists either way; the default path is still right.
      }
      share = { id: shareId, url: url ?? `${auth.serverUrl}/share/${shareId}` };
    } else {
      share = await createShare(auth, id, description, expiresAt);
    }
  } catch {
    return { ok: false };
  }
  let downloadsFailed = false;
  if (!transcodes && downloadable && canShareDownloads()) {
    try {
      await setShareDownloadable(auth, share.id, true, description);
    } catch {
      downloadsFailed = true;
    }
  }
  try {
    // As `message` and not `url`: Android's share sheet ignores `url`, and the
    // apps people send links to (messengers, notes) all read the message.
    await Share.share({ message: share.url });
  } catch {
    // The sheet failed to open or was closed: the link exists either way.
  }
  return { ok: true, downloadsFailed };
}
