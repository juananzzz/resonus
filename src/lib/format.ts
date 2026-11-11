/** Converts seconds to "m:ss" (or "h:mm:ss" if over an hour). */
export function formatDuration(totalSeconds: number | undefined): string {
  if (!totalSeconds || totalSeconds < 0 || !Number.isFinite(totalSeconds)) {
    return '0:00';
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Human-readable total duration for a list/album: "45 min", "1 h 30 min",
 * "2 h", "1 d 3 h 20 min". Shows hours from 60 min and days from
 * 24 h. Abbreviations (d/h/min) are conventional in both languages.
 */
export function formatTotalDuration(totalSeconds: number | undefined): string {
  const s = totalSeconds && Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} d`);
  if (hours > 0) parts.push(`${hours} h`);
  // Minutes: if present, or if nothing else (duration under 1 min).
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(' ');
}

/**
 * How long ago a moment was, in the one unit that still says something: "42 min",
 *  "2 h", "5 d". A coarse step rather than a real one because the place it is
 *  read in is a choice: the ⋯ sheet puts it in the refresh action's label, so it
 *  says what is behind the tap, and nobody decides that from "5 h 12 min 3 s".
 *  The unit words are the ones `formatTotalDuration` already draws, so nothing
 *  here needs translating, and past a month it keeps counting days — a bigger
 *  unit would need a word no language has been given. A moment in the future
 *  (a clock that went backwards) reads 0.
 */
export function formatAge(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts)) return '';
  const ms = Date.now() - ts;
  if (ms < 60_000) return ms > 0 ? '< 1 min' : '0 min';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function formatGroupedDeviceLabel(names: string[]): string {
  const unique = Array.from(
    new Set(
      names
        .map((name) => name.trim())
        .filter((name) => !!name),
    ),
  );

  if (unique.length === 0) return '';
  if (unique.length <= 2) return unique.join(' + ');
  return `${unique.slice(0, 2).join(' + ')} + ${unique.length - 2}`;
}

export function normalizeOutputDisplayName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * An episode's publish date, short and in the app's language ("Jun 12, 2024").
 * The language code doubles as the locale (they are all valid BCP-47 tags:
 * `en`, `de`, `zh-CN`, `pt-BR`…), so the date reads the way the rest of the
 * screen does. The year is always shown: an episode can be years old, and
 * unlike a play history there is no "this year" default to lean on.
 */
export function formatEpisodeDate(ts: number | undefined, lang: string): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(lang, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** A count with the language's own thousands separator ("167,275"). */
export function formatCount(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { useGrouping: true }).format(n);
  } catch {
    return String(n);
  }
}

/** A moment as a short date and time ("11 Nov 2026, 14:02"). */
export function formatDateTime(ms: number, lang: string): string {
  const date = new Date(ms);
  try {
    return date.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toLocaleString();
  }
}

/** Bytes in the appropriate unit ("1.2 GB", "340 MB"). */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
