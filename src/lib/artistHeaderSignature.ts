import { getArtistSignature } from './signatureCache';
import { getAppleArtistLogo } from './appleArtistArtCache';
import { loadSignatureImage, type LoadedArtistSignature } from './signatureImage';

/** Resolve optional sources before replacing the normal name. Provider-only
 * requests never contact Apple; enabled Apple logos have first refusal.
 */
export async function getArtistHeaderSignature(name: string, options: {
  api?: string;
  musicBrainzId?: string;
  appleLogos: boolean;
  offline: boolean;
  tintColor: string;
}): Promise<LoadedArtistSignature | null> {
  if (options.appleLogos) {
    try {
      const logo = await getAppleArtistLogo(name);
      const image = logo ? await loadSignatureImage(logo, options.offline, options.tintColor) : null;
      if (image) return image;
    } catch { /* Optional logo errors still allow the configured provider/name. */ }
  }
  return options.api ? getArtistSignature(name, options.api, options.tintColor, options.musicBrainzId) : null;
}
