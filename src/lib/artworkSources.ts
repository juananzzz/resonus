/** External artwork requests carry names only, never music-server credentials. */
export function publicHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    return url.href;
  } catch { return; }
}
