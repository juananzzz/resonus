/**
 * Whether a file whose tags are already known has to be read again on a forced
 * rescan: only when its date moved since it was read last time. A date that
 * cannot be read (0) keeps the stored tags, which is the point of the change,
 * since SAF does not always hand its date over with the listing (#338).
 */
export function songNeedsReread(known: { addedAt?: number }, mtime: number): boolean {
  return mtime > 0 && mtime !== (known.addedAt ?? 0);
}
