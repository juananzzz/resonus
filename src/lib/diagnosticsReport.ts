/**
 * The diagnostics report as text: what Settings › Diagnostics shows and what
 * About shares for a bug report, built in one place so the two never disagree.
 *
 * English on purpose, in every language: it ends up in GitHub issues, read by
 * people who don't speak every language we ship.
 */
import Constants from 'expo-constants';

import { COVER, songCoverUrl, songListSorts } from '@/api/data';
import { widgetStatus } from '@/lib/homeWidget';
import { coverSourceOf, mirrorCoverState } from '@/lib/mirrorCovers';
import { repairStatus } from '@/lib/navidromeRepair';
import { formatMs, pastEvents, perfEnabled, perfEvents, perfReport, perfTime } from '@/lib/perfLog';
import { useAuthStore } from '@/store/auth';
import { anyDownloads, useDownloads } from '@/store/downloads';
import { useJukebox } from '@/store/jukebox';
import { enabledFolderIds } from '@/store/libraries';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useUpnp } from '@/store/upnp';

/** Stamped in by the workflow that builds the APK; empty when run locally. */
const COMMIT = (process.env.EXPO_PUBLIC_COMMIT ?? '').slice(0, 7);

/** What the profile is, in the terms the code asks about it. Half the reports
 *  that start with "this doesn't show up for me" end here. */
export function profileLines(): string[] {
  const { auth, offline } = useAuthStore.getState();
  const folderFilter = enabledFolderIds(auth);
  const st = useSettings.getState();
  // The switches that cost something while nobody is looking. Half of what a
  // battery report blames on a version turns out to be a setting somebody
  // turned on, and asking about them one at a time is three round trips on an
  // issue.
  const costly = [
    st.preloadUpcoming && 'preload',
    st.crossfadeSec > 0 && `crossfade ${st.crossfadeSec}s`,
    st.autoplaySimilar && 'autoplay',
    st.autoOfflineSwitch && 'auto offline',
    st.syncQueueFromServer && 'queue sync',
    st.animatedCoverBackground && 'animated cover',
    st.updateCheck && 'update check',
  ]
    .filter(Boolean)
    .join(', ');
  return [
    // Which build this is, since a test APK carries the same version as the
    // release it was branched from and there is otherwise no telling them
    // apart from inside the app.
    `build: ${Constants.expoConfig?.version ?? '?'}${COMMIT ? ` (${COMMIT})` : ' (local)'}`,
    `type: ${auth?.serverType ?? '—'}`,
    `native password: ${auth?.ndPassword || auth?.password ? 'yes' : 'no'}`,
    `plain auth: ${auth?.plainAuth ? 'yes' : 'no'}`,
    `library filter: ${folderFilter ? folderFilter.join(', ') : 'none'}`,
    `offline: ${offline ? 'yes' : 'no'}`,
    // Navidrome 0.64 renumbers every id and this is what repaired it. Silent
    // everywhere else, so this line is the only way to tell what it did.
    `id repair: ${repairStatus()}`,
    `song sorts: ${(auth || offline ? songListSorts() : []).join(', ') || '—'}`,
    `costly settings: ${costly || 'none'}`,
  ];
}

/**
 * How the cover of what is playing was arrived at.
 *
 * A wrong cover over the right title is not the queue being wrong, it is the
 * picture being looked up by an id that leads somewhere else. Three things can
 * happen and the app kept no record of which: the file saved under this very
 * id, a file saved under ANOTHER id that this one borrows, or nothing local and
 * the server asked directly. Only the middle one can hand back a picture that
 * belongs to something else, so the id it borrowed from is the answer.
 *
 * `coverId` is worked out the way `songCoverUrl` works it out, which is the
 * whole point: reading a different id here would describe a lookup nobody made.
 */
function coverLines(): string[] {
  const playing = currentSong(usePlayerStore.getState());
  if (!playing) return [];
  const coverId = playing.coverArt ?? (playing.url ? undefined : playing.albumId);
  const coverUrl = songCoverUrl(playing, COVER.card);
  return [
    `playing: ${playing.title}${playing.album ? ` · ${playing.album}` : ''}`,
    `cover id: ${coverId ?? '—'} (${coverSourceOf(coverId)})`,
    `cover from: ${
      coverUrl
        ? coverUrl.startsWith('file://')
          ? `file ${coverUrl.split('/').pop()}`
          : 'the server'
        : 'nothing'
    }`,
    `song ids: coverArt ${playing.coverArt ?? '—'} · album ${playing.albumId ?? '—'}`,
  ];
}

/** `screensOpen` comes from a navigation hook, which only a screen can read. */
export function stateLines(screensOpen?: number): string[] {
  const time = perfTime();
  const p = usePlayerStore.getState();
  const dl = useDownloads.getState();
  const downloads = Object.keys(dl.files).length;
  const downloading = Object.keys(dl.active).length;
  const covers = mirrorCoverState();
  return [
    // Whether the widget's half of the handover is there: the group it writes
    // into, and what was last written to it. A widget showing only its icon
    // says nothing about which side of that is missing, and this does - and
    // on a sideloaded build, which group the signing profile granted.
    `widget: ${widgetStatus()}`,
    // The denominator for every count below. A hundred of anything is one
    // story over ten minutes and another over a night, and the split says
    // which side of the screen going off it happened on.
    `on screen: ${formatMs(time.foregroundMs)} · away: ${formatMs(time.backgroundMs)} · ${time.trips} trips`,
    // Out there the JS thread should barely be run at all. If this is most of
    // the time away, something is keeping it busy with nobody watching.
    `js while away: ${formatMs(time.jsAwayMs)}`,
    // A mix grows on its own and the whole queue is pushed to the server every
    // twenty seconds, so its length is a cost rather than a curiosity.
    `queue: ${p.queue.length} · at ${p.index}${p.radioMode ? ' · mix' : ''} · repeat ${p.repeat}${p.shuffle ? ' · shuffle' : ''}`,
    `output: ${useUpnp.getState().connected ? 'upnp' : useJukebox.getState().active ? 'jukebox' : 'phone'}`,
    `downloads: ${dl.hydrated ? downloads : 'loading'}${anyDownloads(dl) && !dl.hydrated ? ' (some)' : ''}${downloading > 0 ? ` · ${downloading} running` : ''}`,
    `mirror covers: ${covers.saved} saved, ${covers.aliases} other names`,
    // How deep the stack is. Screens you left stay mounted, which is what makes
    // going back instant and what made the app slow down the more you opened
    // before they were frozen: a number here would have said so in a sentence.
    `screens open: ${screensOpen ?? '—'}`,
    ...coverLines(),
  ];
}

/** Clock time, which is what anyone pasting this remembers the problem by. */
export function eventLines(): string[] {
  const line = (at: number, text: string) => {
    const d = new Date(at);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm} ${text}`;
  };
  return [
    // What the last session wrote down going away, if it never came back:
    // the minutes before a background death, which this session never saw.
    ...pastEvents().map((e) => `${line(e.at, e.text)} · previous session`),
    ...perfEvents().map((e) => line(e.at, e.text)),
  ];
}

export function fullReport(screensOpen?: number): string {
  const events = eventLines();
  return [
    ...profileLines(),
    ...stateLines(screensOpen),
    '',
    'Recent problems:',
    ...(events.length > 0 ? events.map((e) => `  ${e}`) : ['  none']),
    '',
    // Said rather than left out, so whoever reads it knows to ask for it.
    perfEnabled() ? perfReport() : 'Measuring is off (Settings › About › Measure performance).',
  ].join('\n');
}
