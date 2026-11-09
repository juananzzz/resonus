/**
 * Subsonic Jukebox mode: the server plays through its own hardware audio
 * (speakers/DAC) and the app acts as a remote control. Nothing is streamed
 * to the phone; only `jukeboxControl` commands are sent to the server.
 *
 * Reuses the player's remote machinery (the same `RemoteEvents` as
 * UPnP): the queue still lives in the player store, so autoplay,
 * mixes, shuffle and reordering work the same. The server is handed the
 * current track and the next few after it (`set`), and moves on to them by
 * itself: polling is a JS `setInterval`, which Android freezes in the
 * background, so a queue advanced by the app stopped after one song with the
 * screen off (#333). The poll follows the server's index, and a change to the
 * queue rewrites what comes after the current track (`jukeboxSyncUpcoming`).
 * The end of the last one is inferred from a "stopped near the end", as in
 * UPnP, and the app loads what comes next.
 *
 * Only Subsonic servers with the jukebox role enabled by the admin.
 */
import { create } from 'zustand';

import { type Song } from '@/api/backend';
import {
  hasJukeboxRole,
  jukeboxAdd,
  jukeboxRemove,
  jukeboxSet,
  jukeboxSetGain,
  jukeboxSkip,
  jukeboxStart,
  jukeboxStatus,
  jukeboxStop,
  type SubsonicAuth,
} from '@/api/subsonic';
import { useAuthStore } from './auth';
import { castStop } from './castMedia';
import type { RemoteEvents } from './upnp';

interface JukeboxStoreState {
  /** Active jukebox session (the server is the active output). */
  active: boolean;
  /** The server supports jukebox for this user (role enabled). */
  available: boolean;
}

export const useJukebox = create<JukeboxStoreState>(() => ({
  active: false,
  available: false,
}));

const POLL_MS = 1000;
/** How many songs after the current one the server is handed. */
const UPCOMING = 20;

let events: RemoteEvents | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPositionSec = 0;
let lastDurationSec = 0;
/** Prevents advancing the queue twice for the same track end. */
let finishedFired = false;
/** Ignores the "stopped" state while loading another track. */
let loading = false;
/** Distinguishes a user pause from a natural track end. */
let intendedPlaying = false;
/** Only emit onPlayingChanged when it actually changes (polling is continuous). */
let lastPlaying: boolean | null = null;
/** The server's playlist, in its order, and where it is in it. */
let serverSongs: Song[] = [];
let serverIndex = 0;
/** Bumped whenever the server's playlist changes: a poll sent before is stale. */
let generation = 0;
let syncing = false;

/** The server only plays by id from its own library: no radios, no local files. */
const playsOnServer = (s: Song) => !s.url && !s.localUri;

/**
 * The run of songs the server can play on its own after the current one. Stops
 * at the first it cannot, and at a repeat: the server finds the current track
 * by id, and a second copy would move it.
 */
function upcomingFor(current: Song, upcoming: Song[]): Song[] {
  const out: Song[] = [];
  const seen = new Set([current.id]);
  for (const s of upcoming) {
    if (out.length >= UPCOMING || !playsOnServer(s) || seen.has(s.id)) break;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

export function isJukeboxActive(): boolean {
  return useJukebox.getState().active;
}

/** Registers player events. Call only once (from the player). */
export function initJukebox(ev: RemoteEvents): void {
  events = ev;
}

/** Only Subsonic has `jukeboxControl` (Jellyfin uses a different API). */
function auth(): SubsonicAuth | null {
  const a = useAuthStore.getState().auth;
  if (!a || a.serverType === 'jellyfin') return null;
  return a;
}

/** Checks if the server offers jukebox and caches it in the store. */
export async function refreshJukeboxAvailability(): Promise<void> {
  const a = auth();
  if (!a) {
    useJukebox.setState({ available: false });
    return;
  }
  const ok = await hasJukeboxRole(a);
  useJukebox.setState({ available: ok });
}

async function poll() {
  const a = auth();
  if (!a || !isJukeboxActive()) return;
  const gen = generation;
  let st;
  try {
    st = await jukeboxStatus(a);
  } catch {
    return; // a one-off network failure doesn't cut the session
  }
  if (!isJukeboxActive() || gen !== generation || loading) return;
  const pos = st.position;
  // The server went on to the next one by itself.
  const moved = serverSongs[st.currentIndex];
  if (st.currentIndex !== serverIndex && moved) {
    serverIndex = st.currentIndex;
    finishedFired = false;
    lastPositionSec = pos;
    lastDurationSec = moved.duration ?? 0;
    events?.onTrackChanged(-1, pos, lastDurationSec, moved.id);
  }
  if (pos > 0) lastPositionSec = pos;
  if (st.playing) {
    loading = false;
    finishedFired = false;
    events?.onProgress(pos, lastDurationSec);
    if (lastPlaying !== true) {
      lastPlaying = true;
      events?.onPlayingChanged(true, false);
    }
    return;
  }
  // Stopped: natural end (near the end and we intended to play) or pause.
  const atEnd = intendedPlaying && lastDurationSec > 0 && lastPositionSec >= lastDurationSec - 3;
  // Between two of its own tracks: the next poll sees the new index.
  if (atEnd && serverIndex < serverSongs.length - 1) return;
  events?.onProgress(pos, lastDurationSec);
  if (atEnd && !finishedFired) {
    finishedFired = true;
    events?.onFinished();
    return;
  }
  if (lastPlaying !== false) {
    lastPlaying = false;
    events?.onPlayingChanged(false, false);
  }
}

/** Opens the jukebox session and starts state polling. */
export async function jukeboxConnect(): Promise<boolean> {
  const a = auth();
  if (!a) return false;
  lastPositionSec = 0;
  lastDurationSec = 0;
  finishedFired = false;
  loading = false;
  intendedPlaying = false;
  lastPlaying = null;
  serverSongs = [];
  serverIndex = 0;
  useJukebox.setState({ active: true });
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void poll(), POLL_MS);
  events?.onConnected();
  return true;
}

/** Closes the session; with `silent` it doesn't notify the player (when switching output). */
export async function jukeboxDisconnect(silent = false): Promise<void> {
  if (!isJukeboxActive()) return;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  useJukebox.setState({ active: false });
  // The media session the volume buttons and the notification go through,
  // on every way out (see `syncCastMedia` in the player).
  castStop();
  const a = auth();
  try {
    if (a) await jukeboxStop(a);
  } catch {
    // ignore
  }
  if (!silent) events?.onDisconnected(lastPositionSec);
}

/**
 * Loads a track in the server's jukebox, with what follows it in the queue
 * (`upcoming`) for the server to go on to. Returns false if there is no
 * session or the track is not suitable for jukebox (radios and local files:
 * the server only plays by id from its own library).
 */
export async function jukeboxLoad(
  song: Song,
  autoplay: boolean,
  startSec = 0,
  upcoming: Song[] = [],
): Promise<boolean> {
  const a = auth();
  if (!a || !isJukeboxActive()) return false;
  if (!playsOnServer(song)) return false;
  loading = true;
  generation++;
  finishedFired = false;
  intendedPlaying = autoplay;
  lastPlaying = null;
  lastPositionSec = startSec;
  lastDurationSec = song.duration ?? 0;
  const list = [song, ...upcomingFor(song, upcoming)];
  serverSongs = list;
  serverIndex = 0;
  try {
    await jukeboxSet(a, list.map((s) => s.id));
    if (startSec > 0) await jukeboxSkip(a, 0, startSec);
    if (autoplay) await jukeboxStart(a);
    else await jukeboxStop(a);
    loading = false;
    return true;
  } catch {
    loading = false;
    return false;
  }
}

/**
 * Rewrites what the server plays after the current track to match the queue,
 * leaving the current one playing: only the entries that differ go, from the
 * end, and the new ones are appended.
 */
export async function jukeboxSyncUpcoming(current: Song, upcoming: Song[]): Promise<void> {
  const a = auth();
  if (!a || !isJukeboxActive() || loading || syncing) return;
  // The server is on another song than the app: the next load sets both.
  if (serverSongs[serverIndex]?.id !== current.id) return;
  // The server finds its current track by id after a removal, and the first
  // match would be one already played.
  if (serverSongs.slice(0, serverIndex).some((s) => s.id === current.id)) return;
  const want = upcomingFor(current, upcoming);
  const have = serverSongs.slice(serverIndex + 1);
  let same = 0;
  while (same < want.length && same < have.length && want[same].id === have[same].id) same++;
  if (same === want.length && same === have.length) return;
  // A load in the middle replaces the whole list, and this one stops.
  const gen = ++generation;
  const keep = serverIndex + 1 + same;
  syncing = true;
  try {
    for (let i = serverSongs.length - 1; i >= keep; i--) {
      await jukeboxRemove(a, i);
      if (gen !== generation) return;
      serverSongs = serverSongs.slice(0, i);
    }
    const added = want.slice(same);
    if (added.length > 0) {
      await jukeboxAdd(a, added.map((s) => s.id));
      if (gen !== generation) return;
      serverSongs = [...serverSongs, ...added];
    }
  } catch {
    // What is left on the server is still in order; the next sync goes on.
  } finally {
    syncing = false;
  }
}

export async function jukeboxPlay(): Promise<void> {
  const a = auth();
  if (!a) return;
  intendedPlaying = true;
  try {
    await jukeboxStart(a);
  } catch {
    // ignore
  }
}

export async function jukeboxPause(): Promise<void> {
  const a = auth();
  if (!a) return;
  intendedPlaying = false;
  try {
    await jukeboxStop(a);
  } catch {
    // ignore
  }
}

export async function jukeboxSeek(sec: number): Promise<void> {
  const a = auth();
  if (!a) return;
  lastPositionSec = sec;
  try {
    await jukeboxSkip(a, serverIndex, sec);
  } catch {
    // ignore
  }
}

/** Jukebox volume; the app slider goes 0..1 and Subsonic gain is the same. */
export function jukeboxSetVolume(volume: number): void {
  const a = auth();
  if (!a) return;
  try {
    void jukeboxSetGain(a, Math.max(0, Math.min(1, volume)));
  } catch {
    // ignore
  }
}
