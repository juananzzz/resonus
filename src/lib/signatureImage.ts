import { Image, type ImageRef } from 'expo-image';

import type { ArtistSignature } from './artistSignatures';
import { hasVisibleSignatureInk } from './signatureInk';

export type LoadedArtistSignature = ArtistSignature & { image: ImageRef };

/** Validate actual decoded pixels, then display that same image without a refetch. */
export async function loadSignatureImage(signature: ArtistSignature, offline: boolean, tintColor = '#ffffff'): Promise<LoadedArtistSignature | null> {
  const path = offline ? await Image.getCachePathAsync(signature.imageUrl) : null;
  if (offline && !path) return null;
  const uri = path ? `file://${path.replace(/^file:\/\//, '')}` : signature.imageUrl;
  // ImageRef sources must be tinted while decoding; view tint cannot recolor them.
  const image = await Image.loadAsync(uri, { maxWidth: 1000, maxHeight: 400, tintColor });
  let accepted = false;
  try {
    accepted = !image.isAnimated && await hasVisibleSignatureInk(image);
    return accepted ? { ...signature, image } : null;
  } finally {
    // Successful references belong to the query/view until garbage collection.
    if (!accepted) image.release();
  }
}
