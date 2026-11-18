/**
 * Whether one podcast episode is out of reach offline: offline mode is on
 * (asked for or fallen out) and no downloaded file exists for it. The
 * episode's `url` is the publisher's address, which offline mode says no to,
 * so only a file on the phone plays it — the same rule `TrackRow` works out
 * for songs and `markUnplayableOffline` marks for the queues.
 *
 * The rule is exported twice: the hook subscribes (a finished download or a
 * flip of the mode re-lights the rows), while `episodeUnavailable` is the
 * plain function for lists that already hold `offline` and the `files` map
 * under their own subscriptions — one rule, no drift.
 *
 * The hook subscribes to one episode at a time, never to the `files` map.
 * That object is replaced with every download that finishes, so reading it
 * re-ran the getter of every row on screen and each one re-rendered — on a
 * Library list of shows with auto-download on, a repaint storm. `useSongSort.tsx`
 * carries the reason for the same shape at `:81`–`:86` ("thousands of full
 * sorts (#50)"), and `PodcastRow.tsx:58` already asks this way next to it.
 */
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';

/** The rule itself, for callers holding `offline` and the downloads' `files`. */
export function episodeUnavailable(offline: boolean, files: Record<string, string>, id?: string): boolean {
  return offline && !!id && !files[id];
}

/**
 * Subscribed: a row re-lights when its own download lands or the mode flips.
 *
 * The map is read inside the subscription rather than handed out, which is
 * where it has to be to follow one episode; the rule is `episodeUnavailable`'s
 * unchanged, one step earlier. A row with no episode is not dimmed: an id
 * missing is not a file missing.
 */
export function useEpisodeUnavailable(episodeId?: string): boolean {
  const offline = useAuthStore((s) => s.offline);
  const onDisk = useDownloads((s) => Boolean(episodeId && s.files[episodeId]));
  return offline && !!episodeId && !onDisk;
}
