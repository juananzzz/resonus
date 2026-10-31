import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ImageRef } from 'expo-image';

const native = requireOptionalNativeModule<{
  hasVisibleInk: (image: ImageRef) => Promise<boolean>;
}>('SignatureInk');

/** Missing native support fails safely to the normal name (e.g. Expo Go/web).
 * Callers release failed refs and never turn native errors into cached misses.
 */
export async function hasVisibleSignatureInk(image: ImageRef): Promise<boolean> {
  if (!native) throw new Error('Signature pixel validation is unavailable');
  return native.hasVisibleInk(image);
}
