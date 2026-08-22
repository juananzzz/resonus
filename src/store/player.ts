/**
 * Playback state and control over expo-audio.
 *
 * The queue lives here, in JS. Two `AudioPlayer` instances alternate: the
 * active one plays and owns the notification, the other is the reserve a
 * crossfade starts the next track on.
 *
 * Auto-advance has three paths and each leaves the others nothing to do:
 * gapless (queued in the player, reported by `trackTransition`), crossfade (on
 * the reserve player), and `didJustFinish` when neither applies.
 *
 * One MediaSession on purpose: Android Auto needs it (see `modules/car-auto`),
 * and it uses its own `JsProxyPlayer`, not this player.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioMetadata,
  type AudioPlayer,
  type AudioSource,
  type AudioStatus,
} from 'expo-audio';
import { fetch as expoFetch } from 'expo/fetch';
import { AppState } from 'react-native';
import { create } from 'zustand';

import {
  getAlbum,
  getArtist,
  getArtistInfo,
  getPlayQueue,
  getSimilarSongs,
  getTopSongs,
  reportPlayback,
  savePlayQueue,
  scrobble,
  streamUrl,
  SubsonicRequestError,
  supportsPlaybackReport,
  supportsTranscodeOffset,
  type Album,
  type PlaybackState,
  type Song,
  type SubsonicAuth,
} from '@/api/backend';
// The data layer's, not the backend's: `getRandomSongs` honours the library
// filter and asks each library for its share (the rest of the mix cannot be
// filtered, see `radioCandidates`), and `coverArtUrl` hands back the file on
// disk when the album is downloaded instead of an address on the server.
import { COVER, coverArtUrl, getRandomSongs } from '@/api/data';
import { prefetchLyrics } from '@/hooks/useLyrics';
import { tg } from '@/i18n';
import type { Remap } from '@/lib/navidromeRemap';
import { remapSong } from '@/lib/navidromeRemap';
import { beat, bump, timed } from '@/lib/perfLog';
import { queryClient } from '@/lib/query';
import { primaryUrl } from '@/lib/serverUrls';
import { getItem, setItem } from '@/lib/storage';
import { useAuthStore } from './auth';
import { checkAutoUrlNow } from './autoUrl';
import { castSetState, castSetVolumeLevel, castUpdate, initCastMedia } from './castMedia';
import { useDownloads } from './downloads';
import { useEqualizer } from './equalizer';
import {
  initJukebox,
  isJukeboxActive,
  jukeboxDisconnect,
  jukeboxLoad,
  jukeboxPause,
  jukeboxPlay,
  jukeboxSeek,
  jukeboxSetVolume,
} from './jukebox';
import { useLastPlayed } from './lastPlayed';
import { useNetworkType } from './networkType';
import { useOfflineQueue } from './offlineQueue';
import { usePlayCounts } from './playCounts';
import { usePlayHistory } from './playHistory';
import { scrobbleThresholdSec, useSettings, type TranscodeFormat } from './settings';
import { useToast } from './toast';
import {
  initUpnp,
  isUpnpConnected,
  upnpDisconnect,
  upnpPause,
  upnpPlay,
  upnpSeek,
  upnpSetCrossfade,
  upnpSetSleepTimer,
  upnpSetVolume,
  type RemoteEvents,
} from './upnp';
import {
  loadUpnpRemoteTrack,
  resetUpnpRemoteSyncState,
  syncUpnpRemoteQueue,
} from './upnpRemoteSync';

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Sentinel for origins that must be translated on the fly (they are not real
 * album/playlist names). The player header resolves them with i18n.
 */
export const SOURCE_FAVORITES = '@@favorites';
export const SOURCE_HISTORY = '@@history';

let sleepTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Expiry of the sleep timer, or null. In the store because the screen says how
 * much is left, and because `onStatus` checks it: Android freezes JS timers
 * with the screen off, which is exactly when a sleep timer runs.
 */
function sleepDeadline(): number | null {
  return usePlayerStore.getState().sleepEndsAt;
}

// ── Sleep timer fade-out ────────────────────────────────────────────────────
// The only moment this timer exists is while you are
// falling asleep, and cutting the music abruptly right then can wake you up — the
// opposite of what was asked. So the last few seconds fade
// down. The fade FINISHES at expiry, not starts then: "stop in 30
// minutes" means at 30 minutes there is silence.

const SLEEP_FADE_MS = 30_000;

let sleepFadeTimeout: ReturnType<typeof setTimeout> | null = null;
let sleepFadeTimer: ReturnType<typeof setInterval> | null = null;

/** Cuts the sleep fade in progress, if any. Volume is restored by whoever
 *  calls (`cutCrossfade`, which is the path all interventions go through). */
function clearSleepFade() {
  if (sleepFadeTimeout) clearTimeout(sleepFadeTimeout);
  sleepFadeTimeout = null;
  if (sleepFadeTimer) clearInterval(sleepFadeTimer);
  sleepFadeTimer = null;
}

/**
 * Lowers the volume to zero in `ms`. Does not capture the player or its volume:
 * reads them on each tick and applies the fade as a factor on `effectiveVolume`.
 * This way it still holds if the track changes midway (ReplayGain is per song)
 * and the new one doesn't start at full volume.
 */
function startSleepFade(ms: number) {
  if (remoteKind()) return; // the remote device's volume is not ours
  clearSleepFade();
  const t0 = Date.now();
  sleepFadeTimer = setInterval(() => {
    const x = Math.min(1, (Date.now() - t0) / ms);
    const p = activePlayer();
    if (p) {
      try {
        p.volume = effectiveVolume(currentSong(usePlayerStore.getState())) * (1 - x);
      } catch {
        // ignore
      }
    }
    if (x >= 1) clearSleepFade();
  }, 100);
}

/** Schedules the fade to finish right at expiry. */
function armSleepFade(msLeft: number) {
  clearSleepFade();
  const fadeMs = Math.min(SLEEP_FADE_MS, msLeft);
  const wait = msLeft - fadeMs;
  if (wait <= 0) startSleepFade(fadeMs);
  else sleepFadeTimeout = setTimeout(() => startSleepFade(fadeMs), wait);
}

/** Releases the fade and returns volume to normal: for when the timer is
 *  canceled with the music already at mid-fade. */
function abortSleepFade() {
  if (!sleepFadeTimer && !sleepFadeTimeout) return;
  clearSleepFade();
  const p = activePlayer();
  if (p) {
    try {
      p.volume = effectiveVolume(currentSong(usePlayerStore.getState()));
    } catch {
      // ignore
    }
  }
}

/** Pause due to expired sleep timer (from the timeout or onStatus). */
function fireSleepTimer() {
  if (sleepTimeout) clearTimeout(sleepTimeout);
  sleepTimeout = null;
  // Pause BEFORE restoring volume: the other way around, the fade just left
  // it at zero and `cutCrossfade` would bring it back to full a few
  // milliseconds before the pause — a sound burst right at falling asleep,
  // which is what we're avoiding.
  clearSleepFade();
  if (remoteKind()) remotePause();
  else activePlayer()?.pause();
  cutCrossfade();
  usePlayerStore.setState({ isPlaying: false, sleepEndsAt: null });
}

// ── Audio engine (expo-audio) ───────────────────────────────────────────────
const players: (AudioPlayer | null)[] = [null, null];
let activeIdx = 0;
let audioModeReady = false;
/** Player that registered lock screen controls (owner of the MediaSession). */
let lockOwner: AudioPlayer | null = null;

/** Active player (the one playing and driving state), if already exists. */
function activePlayer(): AudioPlayer | null {
  return players[activeIdx];
}

/** Creates (once) the AudioPlayer at `idx` and attaches its listeners. */
function ensurePlayer(idx: number): AudioPlayer {
  const existing = players[idx];
  if (existing) return existing;
  const p = createAudioPlayer(null, { updateInterval: 500 });
  // Listeners live for the whole session (players are singletons).
  // Only the active player feeds state: events from the one that is powering
  // down during a crossfade (including its didJustFinish) are ignored.
  p.addListener('playbackStatusUpdate', (status) => {
    if (activePlayer() === p) onStatus(status);
  });
  // Skip track from notification / lock screen → JS manages the queue.
  // Only the session owner emits these events; there are no double skips.
  p.addListener('remotePrevious', () => usePlayerStore.getState().previous());
  p.addListener('remoteNext', () => usePlayerStore.getState().next());
  // Dragging the bar of the notification, the lock screen or the car on a
  // stream the player cannot seek by itself. It reaches us instead of the
  // player, and `seekTo` is the one that knows how: ask the server for the
  // stream starting there (see `seekActive`).
  p.addListener('remoteSeek', ({ positionMs }) => {
    if (activePlayer() === p) usePlayerStore.getState().seekTo(positionMs / 1000);
  });
  // Gapless: the player jumped by itself to the track queued behind this one.
  p.addListener('trackTransition', () => {
    if (activePlayer() === p) onTrackTransition();
  });
  // What the source says it is playing. Only radio has anything to say here.
  p.addListener('streamMetadata', (info) => {
    if (activePlayer() === p) onStreamMetadata(info);
  });
  // Equalizer: the native effect attaches to the audio session of THIS player.
  // Since they are singletons (two alternating for crossfade), it's enough to
  // do it on creation; the saved state is applied automatically.
  useEqualizer.getState().attach(p.audioSessionId);
  players[idx] = p;
  return p;
}

/** Configures audio mode (exclusive focus) only once. */
async function ensureAudioMode() {
  if (audioModeReady) return;
  audioModeReady = true;
  try {
    // `shouldPlayInBackground` or expo-audio pauses on minimize; `doNotMix` for
    // exclusive focus, which is what ties the lock screen controls to us.
    // `playsInSilentMode` because the ringer switch is about interruptions, not
    // about the album somebody pressed play on: SDK 56 checks it inside
    // `play()`, so on a phone set to vibrate the button did nothing at all.
    await setAudioModeAsync({
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: true,
      playsInSilentMode: true,
    });
    await setIsAudioActiveAsync(true);
  } catch {
    // ignore
  }
}

/**
 * File of a downloaded song, even if the song comes from the server
 * (in server mode the API `Song` items don't carry `localUri`; downloads
 * live in the `useDownloads` map).
 */
function downloadedUri(song: Song): string | undefined {
  return useDownloads.getState().files[song.id];
}

/**
 * Can this track be played offline? Radio (own url), local library track
 * (localUri) or on-disk download. Offline, those that only exist as a server
 * stream cannot be played and must be skipped.
 */
function playableOffline(song: Song | null | undefined): boolean {
  return !!song && (!!song.url || !!song.localUri || !!downloadedUri(song));
}

/** The same song as it goes into the queue by hand: autoplay's mark comes off
 *  (it is here because you put it here, whatever it was doing before) and it
 *  takes one of its own, which is what the player announces while it plays. */
function handAdded(song: Song): Song {
  const { fromMix: _fromMix, ...rest } = song;
  return { ...rest, queued: true };
}

/** The same song with neither mark on it, for when the queue stops having the
 *  blocks they name (see `toggleShuffle`). */
function unmarked(song: Song): Song {
  if (!song.fromMix && !song.queued) return song;
  const { fromMix: _fromMix, queued: _queued, ...rest } = song;
  return rest;
}

/** Max streaming bitrate according to current network (Wi-Fi or mobile data). */
function effectiveMaxBitRate(): number {
  const s = useSettings.getState();
  return useNetworkType.getState().cellular ? s.maxBitRateCellular : s.maxBitRate;
}

/** Codec to transcode to, by network, like the bitrate above it. */
function effectiveStreamFormat(): TranscodeFormat {
  const s = useSettings.getState();
  return useNetworkType.getState().cellular ? s.streamFormatCellular : s.streamFormat;
}

/**
 * The copy of a song that already failed, this run only: `file` sends it to the
 * server, `stream` back to the disk whatever the setting says. Read by
 * `localSourceFor`. Not written down, since neither is a property of the song;
 * a file that is not there is dropped from the catalog (`forgetIfMissing`).
 */
const failedSource = new Map<string, 'file' | 'stream'>();

/** Source for expo-audio: radio (url), local (file/content) or Subsonic stream. */
/**
 * Does this song play from the file on disk, and which file?
 *
 * The download is the default, but a library kept at 128 kbps is a worse copy
 * than the server's, hence the setting (#108). Offline the question does not
 * arise. Everything asking "is this a stream?" asks this and not whether a
 * download exists: seeking, warming and the transcode offset all depend on
 * where the audio actually comes from.
 */
export function localSourceFor(song: Song): string | undefined {
  const { auth, offline } = useAuthStore.getState();
  // What the player has already tried and failed to play beats both the setting
  // and the phone's own copy: one of the two is silence, and the other one may
  // not be. See `onPlaybackError`.
  const failed = failedSource.get(song.id);
  if (failed === 'file' && auth && !offline) return undefined;
  // The phone's own library is not a download and there is nothing to stream.
  if (song.localUri) return song.localUri;
  const file = downloadedUri(song);
  if (!file) return undefined;
  if (offline || !auth) return file;
  if (failed === 'stream') return file;
  switch (useSettings.getState().preferDownloads) {
    case 'never':
      return undefined;
    case 'cellular':
      return useNetworkType.getState().cellular ? file : undefined;
    case 'original':
      // Downloaded without transcoding, so the file IS the server's copy.
      // Downloads made before the app recorded this are taken as original,
      // which is what they were unless the setting said otherwise back then.
      return useDownloads.getState().dlBitRates[song.id] ? undefined : file;
    default:
      return file;
  }
}

function sourceFor(song: Song, timeOffsetSec = 0): AudioSource {
  const metadata = itemMetadataFor(song);
  // What the media session calls this track. Without it every item goes out as
  // `MediaItem.DEFAULT_MEDIA_ID`, the empty string, so a car reading the
  // session was told the same name for the whole album (#139). The song's id
  // and not the stream URL: this reaches every connected controller, and the
  // URL carries the credentials.
  const mediaId = song.id;
  if (song.url) return { uri: song.url, metadata, mediaId };
  const local = localSourceFor(song);
  // Counted where the decision is acted on, once per install, and not inside
  // `localSourceFor`, which every render and every heartbeat asks. "Streamed
  // although downloaded" is the one that answers the report this exists for:
  // somebody with the album on the phone hearing it cut out on a bad
  // connection, which cannot happen to a file.
  if (local) {
    bump('player · played the file on disk');
    return { uri: local, metadata, mediaId };
  }
  bump(
    downloadedUri(song)
      ? 'player · streamed although downloaded'
      : 'player · streamed, nothing downloaded',
  );
  const auth = useAuthStore.getState().auth!;
  const format = effectiveStreamFormat();
  return {
    uri: streamUrl(auth, song.id, effectiveMaxBitRate(), timeOffsetSec, format),
    metadata,
    mediaId,
  };
}

// ── Seek in transcoded streams ──────────────────────────────────────────────
// A stream the server generates on the fly has no random access: native
// seek bounces or restarts. If the server announces the
// OpenSubsonic `transcodeOffset` extension, the stream is re-requested with
// `timeOffset` and the displayed position is compensated (offset + native
// player time).

/** Real second of the stream at which the player's current source starts. */
let streamOffsetSec = 0;

/**
 * Moves that offset, here and on the native player, which is where the media
 * session reads the position from: a stream re-requested at 2:00 counts from
 * zero, and the notification and the car went back to 0:00 on every seek
 * (#135). Every source install comes through here, zeros included. `p` is the
 * player the source belongs to, not always the one still playing.
 */
function setStreamOffset(sec: number, p: AudioPlayer | null = activePlayer()) {
  streamOffsetSec = sec;
  try {
    p?.setSessionPositionOffset(Math.round(sec * 1000));
  } catch {
    // Android-only, and only in a build carrying the patch.
  }
}

/**
 * Points the native `loop` at the source the player holds. `loop` repeats THE
 * SOURCE, and a stream re-requested at 3:25 is not the whole song: looping it
 * replayed its last seconds forever. Only a source starting at zero may loop;
 * the rest end and `didJustFinish` restarts the song (see `onStatus`).
 */
function applyLoop(p: AudioPlayer | null, offsetSec = streamOffsetSec) {
  if (!p) return;
  try {
    p.loop = usePlayerStore.getState().repeat === 'one' && offsetSec === 0;
  } catch {
    // ignore
  }
}

/** `transcodeOffset` support of the active server (null = unchecked). */
let transcodeOffsetSupported: boolean | null = null;
/**
 * Does the source have a known length? (null = not loaded yet)
 *
 * `isTranscoded` only knows what WE asked for, and Navidrome transcodes on its
 * own settings too: no `Content-Length`, no ranges, and a native seek restarts
 * the track. No length on a server stream is that signal, so those seeks also
 * go through `timeOffset`. Second time round it seeks fine because Navidrome
 * serves the cached transcode, with length.
 */
let sourceHasLength: boolean | null = null;

/** Is this song being transcoded (the server generates it on the fly)? */
function isTranscoded(song: Song): boolean {
  // Playing from disk: normal native seek, no timeOffset.
  if (song.url || localSourceFor(song)) return false;
  const max = effectiveMaxBitRate();
  // Without limit the server serves the original file (direct, native seek).
  // Forced codec is only sent with `maxBitRate > 0` (see streamUrl), so
  // outside that there is no transcode.
  if (max <= 0) return false;
  // Transcodes if the original exceeds the bitrate OR if an output codec is
  // forced (the server re-encodes even if the bitrate already fit). In both
  // cases the stream loses random access and native seek would restart.
  return effectiveStreamFormat() !== '' || (song.bitRate != null && song.bitRate > max);
}

/** Does seeking this song need a `timeOffset` re-request instead of a native seek? */
function needsOffsetSeek(song: Song): boolean {
  // Radio (own url), local library and downloads: real random access. And a
  // radio must NEVER be re-requested against the Subsonic stream endpoint,
  // even though its live stream has no length either.
  if (song.url || localSourceFor(song)) return false;
  // Already playing an offset segment: its native timeline starts at
  // `streamOffsetSec`, so a native seek would land that much further ahead.
  // From here on, every seek is another re-request.
  if (streamOffsetSec > 0) return true;
  return isTranscoded(song) || sourceHasLength === false;
}

/** The answer while it is still being fetched, so two callers ask once. */
let transcodeOffsetAsking: Promise<boolean> | null = null;

/** Checks (once per profile) if the server can start a stream partway in. */
async function ensureTranscodeOffsetSupport(): Promise<boolean> {
  if (transcodeOffsetSupported != null) return transcodeOffsetSupported;
  // Caching the answer is not enough when two callers arrive before the first
  // one has it: the second saw `null` and asked again. It happens on the very
  // first track, which is where this costs a round trip on the way to playing.
  if (transcodeOffsetAsking) return transcodeOffsetAsking;
  const auth = useAuthStore.getState().auth;
  if (!auth) return false; // no session yet: don't cache, re-check later
  transcodeOffsetAsking = (async () => {
    try {
      transcodeOffsetSupported = await supportsTranscodeOffset(auth);
      return transcodeOffsetSupported;
    } catch {
      // Transient network failure: do NOT cache as "not supported", or a single
      // hiccup would leave all seeks in native mode (restart) for the rest of the
      // session. Retried on the next seek.
      return false;
    } finally {
      // Only the answer is kept, never the asking: a failure that cached itself
      // here would be the same hiccup lasting the whole session by another
      // route.
      transcodeOffsetAsking = null;
    }
  })();
  return transcodeOffsetAsking;
}

/**
 * Seek on the active player: native seek, or a `timeOffset` re-request when the
 * stream has no random access. Shared by the user's seek and by every path that
 * restores a saved position, which used to restart those streams from zero too.
 */
function seekActive(sec: number) {
  const state = usePlayerStore.getState();
  const song = currentSong(state);
  pendingSeek = { sec, at: Date.now() };
  usePlayerStore.setState({ positionSec: sec });
  // Which of the three ways out this seek took, and whether anybody was
  // looking. A seek from the car happens with the app in the background, where
  // half of what this function can do is not certain to run, and the report is
  // the only place those tell each other apart afterwards: a count of "offset
  // asked" that the matching "offset answered" never catches up to is the
  // server round trip below never coming back out there.
  if (AppState.currentState !== 'active') bump('seek · away');
  if (!song || !needsOffsetSeek(song)) {
    bump(activePlayer() ? 'seek · native' : 'seek · no player');
    const p = activePlayer();
    if (p) {
      void p.seekTo(sec).then(() => {
        // Native seek completed: clear pendingSeek so onStatus picks up the
        // real currentTime from the player instead of the held value.
        if (pendingSeek?.sec === sec) {
          pendingSeek = null;
          usePlayerStore.setState({ positionSec: sec });
        }
      });
    }
    return;
  }
  // A stream generated on the fly has no random access: native seek
  // restarts. It must be re-requested with `timeOffset`, but only if the
  // server supports it. That answer is warmed asynchronously on track load,
  // so here we RESOLVE it (don't read a variable that, on a seek right after
  // loading, would still be unchecked and send us to native seek → restart).
  // The position and pendingSeek are already set so the slider doesn't bounce
  // while it decides.
  bump('seek · offset asked');
  void ensureTranscodeOffsetSupport().then((supported) => {
    bump('seek · offset answered');
    // If the track changed while resolving, don't touch the new player.
    if (currentSong(usePlayerStore.getState()) !== song) return;
    const p = activePlayer();
    if (!p) return;
    pendingSeek = { sec, at: Date.now() }; // refreshes the wait window
    if (supported) {
      setStreamOffset(sec, p);
      try {
        replaceSource(p, sourceFor(song, sec));
        applyLoop(p); // a segment is not the song: it must end to be repeated
        p.volume = effectiveVolume(song);
        if (usePlayerStore.getState().isPlaying) p.play();
        // The new source came with an empty tail: re-queue what comes next.
        // Nothing in the store changed here, so nobody else would.
        scheduleNextSource();
      } catch {
        // ignore
      }
    } else {
      // No offset support: native seek as best effort.
      p.seekTo(sec);
    }
    usePlayerStore.setState({ positionSec: sec });
  });
}

/**
 * Cover art for the notification and the media session, resolved like every
 * screen resolves it: that path hands back the file on disk, which is the only
 * place a cover comes from with no connection.
 */
function artworkUrlFor(song: Song): string | undefined {
  // A radio has no album to fall back to, but the server may hold an image for
  // the station, and one picked on the device arrives as a file:// path.
  return coverArtUrl(song.coverArt ?? (song.url ? undefined : song.albumId), COVER.card);
}

/**
 * What the media session says this track is. Bluetooth, the car and the
 * system's controls read this, not the notification, and it beats the stream's
 * tags, which a transcode strips (#78).
 *
 * A radio goes without title or artist on purpose: the stream fills those in
 * track by track (`onStreamMetadata`) and anything here would outrank it.
 *
 * The duration goes with it because a transcode cannot report one, and without
 * it the system's controls show no times and no progress bar (#116). Only a
 * fallback: a source with a length still speaks for itself.
 */
function itemMetadataFor(song: Song): AudioMetadata {
  const artworkUrl = artworkUrlFor(song);
  if (song.url) return { artworkUrl };
  return {
    title: song.title,
    artist: song.artist ?? undefined,
    albumTitle: song.album ?? undefined,
    artworkUrl,
    durationMs: song.duration && song.duration > 0 ? Math.round(song.duration * 1000) : undefined,
  };
}

function metadataFor(song: Song): AudioMetadata {
  // A radio that says what it is playing says it here too. Only in the two
  // lines every song has: the station is not an album and does not go in the
  // album's place.
  const live = liveInfo(song);
  return {
    title: live?.title ?? song.title,
    artist: live?.artist ?? song.artist ?? undefined,
    albumTitle: song.album ?? undefined,
    artworkUrl: artworkUrlFor(song),
  };
}

/**
 * Applies metadata to lock screen. If `p` is not yet the session owner, it
 * registers it in its name (first time, or transfer to the other player in
 * crossfade: the native service moves the notification and MediaSession to
 * the new player).
 */
function applyLockScreen(p: AudioPlayer, song: Song) {
  const meta = metadataFor(song);
  if (lockOwner === p) {
    p.updateLockScreenMetadata(meta);
    return;
  }
  lockOwner = p;
  p.setActiveForLockScreen(true, meta, {
    showSeekForward: false,
    showSeekBackward: false,
    showSkipPrevious: true,
    showSkipNext: true,
  });
}

// ── What a radio says it is playing ─────────────────────────────────────────
// A station is one item in the queue and stays there for hours, so the queue
// cannot say what is on. The stream can: it announces every track as it starts
// (ICY metadata, which ExoPlayer asks for by itself and hands over as it
// arrives). Not every stream sends it, and the one that does keeps sending it
// while the same station plays.

/** What the stream playing `song` says is on, or null if it says nothing. */
function liveInfo(song: Song | null | undefined): StreamInfo | null {
  return song?.url ? usePlayerStore.getState().streamInfo : null;
}

/**
 * ICY carries a single line, and what everyone puts in it is "Artist - Title".
 * It is a habit rather than a rule, so a stream that fills the artist in on its
 * own is believed over the split. Nothing to show gives null.
 */
function parseStreamInfo(info: { title?: string; artist?: string }): StreamInfo | null {
  const raw = info.title?.trim();
  if (!raw) return null;
  const artist = info.artist?.trim();
  if (artist) return { title: raw, artist };
  const sep = raw.indexOf(' - ');
  if (sep <= 0) return { title: raw };
  return { title: raw.slice(sep + 3).trim(), artist: raw.slice(0, sep).trim() };
}

/**
 * Reads what the source announced. Only radio uses it: everything else comes
 * with the server's tags, which beat whatever the decoder scrapes out of a
 * file, and a download would suddenly rename itself to whatever is inside it.
 */
function onStreamMetadata(info: { title?: string; artist?: string }) {
  const song = currentSong(usePlayerStore.getState());
  // Between two tracks a stream can go quiet, and that is not a reason to keep
  // showing the one before, so an empty announcement is applied like any other.
  const next = song?.url ? parseStreamInfo(info) : null;
  const prev = usePlayerStore.getState().streamInfo;
  if (prev?.title === next?.title && prev?.artist === next?.artist) return;
  usePlayerStore.setState({ streamInfo: next });
  // The notification and the car read the same thing, and this is the only
  // moment they get to hear about it.
  const p = activePlayer();
  if (song && p && lockOwner === p) applyLockScreen(p, song);
}

/** Removes lock screen controls (profile change or remote output). */
function clearLockScreen() {
  if (!lockOwner) return;
  try {
    lockOwner.clearLockScreenControls();
  } catch {
    // ignore
  }
  lockOwner = null;
}

// ── Salida remota (renderer UPnP/DLNA) ─────────────────────────────────────

/** Active remote output, if any. */
function remoteKind(): 'upnp' | 'jukebox' | null {
  if (isUpnpConnected()) return 'upnp';
  if (isJukeboxActive()) return 'jukebox';
  return null;
}

function remotePlay() {
  if (isJukeboxActive()) void jukeboxPlay();
  else void upnpPlay();
}

function remotePause() {
  if (isJukeboxActive()) void jukeboxPause();
  else void upnpPause();
}

function remoteSeek(sec: number) {
  if (isJukeboxActive()) void jukeboxSeek(sec);
  else void upnpSeek(sec);
}

function remoteSetVolume(volume: number) {
  if (isJukeboxActive()) jukeboxSetVolume(volume);
  else {
    upnpSetVolume(volume);
    // Reflect the exact value back in the system volume overlay (UPnP casts
    // through the CastMedia session; Jukebox plays on the server, no overlay).
    castSetVolumeLevel(volume);
  }
}

/**
 * Syncs the casting media session (lock screen notification + volume buttons)
 * with the current track/state. Only for UPnP: Jukebox plays on the server
 * itself and doesn't need a local session on the phone.
 */
function syncCastMedia(): void {
  if (!isUpnpConnected()) return;
  const st = usePlayerStore.getState();
  const song = currentSong(st);
  if (!song) return;
  castUpdate({
    title: song.title,
    artist: song.artist ?? undefined,
    album: song.album ?? undefined,
    artworkUrl: artworkUrlFor(song),
    durationMs: (song.duration ?? st.durationSec) * 1000,
    positionMs: st.positionSec * 1000,
    isPlaying: st.isPlaying,
  });
  // Seed the system volume overlay with the current level (otherwise it shows
  // the provider's initial 50% until the first hardware button press).
  castSetVolumeLevel(st.volume);
}

/** Loads the track at `index` into the remote output and syncs state. */
async function remoteLoadIndex(index: number, autoplay: boolean, startSec = 0) {
  const state = usePlayerStore.getState();
  const song = state.queue[index];
  if (!song) return;
  scrobbledThisTrack = false;
  const ok = isJukeboxActive()
    ? await jukeboxLoad(song, autoplay, startSec)
    : await loadUpnpRemoteTrack(
        {
          queue: state.queue,
          index,
          positionSec: startSec,
          isPlaying: autoplay,
          shuffle: state.shuffle,
          repeat: state.repeat,
        },
        autoplay,
      );
  if (!ok) {
    useToast.getState().show(tg("This song can't be cast"));
    usePlayerStore.setState({ index, isPlaying: false, isBuffering: false });
    return;
  }
  usePlayerStore.setState({
    index,
    positionSec: startSec,
    durationSec: song.duration ?? 0,
    isPlaying: autoplay,
    isBuffering: autoplay,
  });
  onTrackChanged(song);
}

/**
 * Maintains the "queued" block (manually added songs, contiguous after the
 * current one) on track change: advancing to the next consumes one; jumping to
 * any other position dissolves the block (becomes a normal queue).
 */
function consumeQueuedOnIndexChange(next: number) {
  const { index, queuedCount } = usePlayerStore.getState();
  if (next === index || queuedCount === 0) return;
  usePlayerStore.setState({
    queuedCount: next === index + 1 ? queuedCount - 1 : 0,
  });
}

/** Which load is in charge, so an older one can tell it has been overtaken. */
let loadToken = 0;

/**
 * Loads the track at `index` and (optionally) plays it.
 *
 * False means nothing was installed and what was playing still is, so a caller
 * can put its queue back. Anything failing AFTER the source is in the player
 * says true: showing one song while another sounds is the one thing this must
 * never do.
 */
async function loadIndex(index: number, autoplay: boolean): Promise<boolean> {
  const token = ++loadToken;
  // Anything asked to play is the app in use, whoever asked: the button, the
  // notification, the car, a headset. The window is only for the track the
  // saved queue brings back on its own.
  if (autoplay) endBootQuiet();
  // Offline, a stream-only track cannot play: skip to the next one that can
  // rather than get stuck. `nextIndex` already avoids this during a normal
  // advance, so this covers the rest (previous, taps, queue restore).
  if (useAuthStore.getState().offline) {
    const q = usePlayerStore.getState().queue;
    if (q[index] && !playableOffline(q[index])) {
      let target = -1;
      for (let i = index + 1; i < q.length; i++) {
        if (playableOffline(q[i])) {
          target = i;
          break;
        }
      }
      if (target === -1) {
        usePlayerStore.setState({ isPlaying: false });
        // Only when playing was actually asked for. Restoring the saved queue
        // on a cold start also comes through here, and answering a tap nobody
        // gave is how the toast ended up greeting people who open the app
        // offline.
        if (autoplay) useToast.getState().show(tg('Nothing here is downloaded'));
        return false;
      }
      index = target;
    }
  }
  cutCrossfade();
  pendingSeek = null;
  setStreamOffset(0);
  sourceHasLength = null; // unknown until the new source is loaded
  scrobbledThisTrack = false;
  consumeQueuedOnIndexChange(index);
  if (remoteKind()) {
    await remoteLoadIndex(index, autoplay);
    return true;
  }
  await ensureAudioMode();
  // Loading waits, and a queue can be rewritten while it does: another tap,
  // the mix filling itself in, the shuffle being dealt again. Reading the song
  // before the wait and installing it after handed the player a song from the
  // queue that no longer exists, while the screen went on describing the one
  // that does — the report was tapping a song and being shown a different one,
  // with the right audio. Whoever came last owns playback; this one is done.
  if (token !== loadToken) return true;
  const song = usePlayerStore.getState().queue[index];
  if (!song) return false;
  const p = ensurePlayer(activeIdx);
  // The player may have just been created, so the reset above had nothing to
  // reach: this source starts at the beginning either way.
  setStreamOffset(0, p);
  // Equalizer re-attachment: when creating the player the audio session may not
  // be assigned yet. It's idempotent (native ignores duplicate sessions and id 0),
  // so it's cheap to ensure it here.
  useEqualizer.getState().attach(p.audioSessionId);
  try {
    replaceSource(p, sourceFor(song));
  } catch (e) {
    // Counted apart from the failures the player reports on its own: this one
    // never got as far as the player, and the two look identical from the
    // outside: the same toast over a song that does not start. A report of one
    // is unanswerable without knowing which it was (see `onPlaybackError`).
    bump(`player · could not install the source (${errorTag(String(e))})`);
    useToast.getState().show(tg("Couldn't play the song"));
    return false;
  }
  // The player is holding this song now and whatever it held before is gone,
  // so the screen follows it here and not one line later: everything below can
  // fail, and none of it can put the old song back.
  usePlayerStore.setState({
    index,
    positionSec: 0,
    durationSec: song.duration ?? 0,
    isPlaying: autoplay,
    isBuffering: autoplay,
  });
  try {
    applyLoop(p);
    // Effective volume of THIS song (user × ReplayGain).
    p.volume = effectiveVolume(song);
    applySpeed(p, song);
    if (autoplay) p.play();
    applyLockScreen(p, song);
    onTrackChanged(song);
    // `playQueue` installs the queue before this player/source exists, so the
    // store subscription's first attempt to enqueue the following track has
    // nothing to act on. Queue it again now that `replace()` has installed the
    // current media item. Without this, the first album transition still falls
    // back to didJustFinish → replace(), leaving an audible gap.
    // Both of these reach the server, and neither is needed before the first
    // play, so on the way in they wait for the boot window to close.
    if (!bootQuiet) {
      scheduleNextSource();
      // Warms up the "does it support timeOffset?" answer so the first seek
      // on a transcoded stream already has the answer cached. For ANY server
      // stream: the transcode may be the server's decision, and we only find
      // out when the source loads without a length (see `sourceHasLength`).
      if (!song.url && !localSourceFor(song)) {
        void ensureTranscodeOffsetSupport();
      }
    }
  } catch (e) {
    // The song is in the player: say so, whatever went wrong on the way to
    // making it sound. Answering false here is what left the screen describing
    // the song before it while this one played.
    bump(`player · loaded but did not start (${errorTag(String(e))})`);
    useToast.getState().show(tg("Couldn't play the song"));
  }
  return true;
}

// ── "Back" history, Spotify-style ────────────────────────────────────────────
// Stack of already-played contexts so the previous button/gesture returns to
// the prior song even if it comes from a different playlist or album (not the
// previous track of the current context). Pushed on each advance/skip forward
// and popped in previous(). Entries share the `queue` reference within the
// same context, so they only weigh what changes between skips.
type HistoryEntry = {
  queue: Song[];
  index: number;
  source: string | null;
  sourceHref: string | null;
  originalQueue: Song[] | null;
  shuffle: boolean;
  queueDealt: boolean;
};
const HISTORY_MAX = 100;
let playedHistory: HistoryEntry[] = [];

/**
 * Why the queue is moving, which decides whether paused stays paused.
 *
 * `skip` is stepping through: ⏭, ⏮ and the swipe across the player's cover.
 * `pick` is choosing one, out of the queue or the car's list, and that is an
 * instruction to play it whatever the setting says.
 */
export type JumpKind = 'pick' | 'skip';

/**
 * Whether a skip should start playback. `true` until the setting is on:
 * skipping has started the music here since the first version, media3 does the
 * opposite, and the muscle memory is ours. With it on, the paused state carries
 * across the skip, which is what somebody stepping past a track wants (#110).
 */
function skipAutoplay(playing: boolean): boolean {
  return useSettings.getState().keepPausedOnSkip ? playing : true;
}

/** Pushes the current context before advancing or skipping to another track. */
function pushHistory() {
  const { queue, index, source, sourceHref, originalQueue, shuffle, queueDealt } =
    usePlayerStore.getState();
  if (!queue[index]) return;
  playedHistory.push({ queue, index, source, sourceHref, originalQueue, shuffle, queueDealt });
  if (playedHistory.length > HISTORY_MAX) playedHistory.shift();
}

/** What tells one playing context from another: the screen it came from, and
 *  its name when it has no screen (the library shuffle, a mix). */
function contextKey(source: string | null, sourceHref: string | null) {
  return sourceHref ?? source ?? null;
}

/**
 * Forgets the back history of a list being started again: its entries point
 * into the queue about to be replaced, so ⏮ walked back into the discarded one
 * (#100). Other lists keep theirs.
 */
function forgetHistoryOf(key: string) {
  playedHistory = playedHistory.filter((e) => contextKey(e.source, e.sourceHref) !== key);
}

// ── Honest scrobble ──────────────────────────────────────────────────────────
// Starting a track only announces it; the listen is sent on crossing the
// threshold in the settings (50% or 4 minutes by default), so skipping does not
// inflate anybody's history. The offline counter and the outbox follow the same
// rule.
let scrobbledThisTrack = false;

// ── What the server's Now Playing panel shows ────────────────────────────────
// The announcement ("now playing") is one message at the start of a track and
// there is no second one: the server gives the entry the rest of the track to
// live and hears nothing after that, so pausing, emptying the queue or closing
// the app all left the song running in Navidrome's panel until it would have
// ended. Servers with the OpenSubsonic `playbackReport` extension take
// the state instead, so those get told about the pause and the stop as well.
// The rest keep the announcement, which is all the classic API can say.

/** Support for `playbackReport`, per profile (`reset` clears it). */
let playbackReportSupported: boolean | null = null;

/** The answer while it is still being fetched. See the one above it. */
let playbackReportAsking: Promise<boolean> | null = null;

/** Checks (once per profile) whether the server takes playback state. */
async function ensurePlaybackReportSupport(auth: SubsonicAuth): Promise<boolean> {
  if (playbackReportSupported != null) return playbackReportSupported;
  if (playbackReportAsking) return playbackReportAsking;
  playbackReportAsking = (async () => {
    try {
      playbackReportSupported = await supportsPlaybackReport(auth);
      return playbackReportSupported;
    } catch (e) {
      // A server that refuses the question has answered it: an old Subsonic
      // doesn't know the method, and remembering that keeps every pause from
      // asking again. A network failure is not an answer, and caching it would
      // leave the whole session on the announcement over one hiccup, so that one
      // is asked again on the next change.
      if (e instanceof SubsonicRequestError && !e.network) playbackReportSupported = false;
      return false;
    } finally {
      playbackReportAsking = null;
    }
  })();
  return playbackReportAsking;
}

/**
 * Tells the server what playback is doing. Best effort in every sense: it is
 * about this moment, so one that didn't arrive is stale by the time anyone
 * could retry it. The listen (`maybeScrobbleThreshold`) is the one that is kept.
 *
 * A song is only reported when the server is the one it came from: radio has
 * no id there, and a local profile has no server to tell.
 */
function reportState(state: PlaybackState, song: Song | undefined, positionSec: number): void {
  if (!song || song.url) return;
  const { auth, offline } = useAuthStore.getState();
  if (!auth || offline) return;
  void ensurePlaybackReportSupport(auth).then((supported) => {
    // The account may have gone, or gone offline, while it was being asked.
    const now = useAuthStore.getState();
    if (now.auth !== auth || now.offline) return;
    if (!supported) {
      // The classic API only knows how to say "this started", so the rest is
      // nothing it could carry.
      if (state === 'starting') void scrobble(auth, song.id, false).catch(() => {});
      return;
    }
    void reportPlayback(auth, song.id, state, positionSec).catch(() => {});
  });
}

/**
 * A list in a new order, without touching the one handed in. Fisher-Yates,
 * shared by the shuffle button and by starting a list while shuffle is already
 * on, because those two have to deal the same way: the second used to turn
 * shuffle off instead of dealing at all.
 */
function dealt<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Sends the real scrobble once per track when crossing the threshold. */
function maybeScrobbleThreshold(positionSec: number) {
  if (scrobbledThisTrack) return;
  const st = usePlayerStore.getState();
  const song = st.queue[st.index];
  if (!song || song.url) return; // radios are not scrobbled
  const duration = st.durationSec || song.duration || 0;
  const { scrobblePercent, scrobbleSeconds } = useSettings.getState();
  const threshold = scrobbleThresholdSec(duration, scrobblePercent, scrobbleSeconds);
  // Both rules off: nothing is ever reported, here or to the outbox, which is
  // what somebody who turned both off asked for.
  if (threshold === null || positionSec < threshold) return;
  scrobbledThisTrack = true;
  const at = Date.now();
  const { auth, offline } = useAuthStore.getState();
  // The listen is remembered locally whatever happens to the server: it feeds
  // "Most played" on this phone, which is nobody else's business.
  if (offline) {
    usePlayCounts.getState().bump(song.id);
    bump(auth ? 'scrobble · to outbox' : 'scrobble · local profile');
    if (auth) useOfflineQueue.getState().addPlay(song.id, at);
    return;
  }
  if (!auth) return; // a local profile has no server to tell
  // Online, so it goes straight up. But "online" is only what the mode says,
  // and the mode is a guess that takes two failed probes to change its mind:
  // there is a window on the way out of the house, and a whole trip if
  // nothing was downloaded to fall back to, where the app is still calling
  // itself online and the server is not there. Every listen in it used to be
  // handed to a promise nobody was waiting on, and lost the moment it failed
  // (#126). A refusal from the network puts it in the same outbox an offline
  // one goes to, dated, so it goes up on the next reconnection either way.
  bump('scrobble · sent');
  scrobble(auth, song.id, true).catch((e) => {
    if (!(e instanceof SubsonicRequestError) || !e.network) {
      bump('scrobble · server refused');
      return;
    }
    bump('scrobble · to outbox (no network)');
    usePlayCounts.getState().bump(song.id);
    useOfflineQueue.getState().addPlay(song.id, at);
  });
}

/** Waiting to warm the next song's lyrics (see `onTrackChanged`). */
let nextLyricsTimer: ReturnType<typeof setTimeout> | null = null;
const NEXT_LYRICS_DELAY_MS = 5000;

// ── The first seconds of the app ────────────────────────────────────────────
// Restoring the queue loads its track, and everything that follows a track
// change goes with it: Now Playing, lyrics, the warming, the transcode probe
// and the queued source. Seven requests in the instant the app is painting
// itself, worth a second of opening on a song from the server.
//
// So they wait for the first sign the app is in use, or for the window below.
// The track does NOT wait: held back, it left a queue on screen with no player
// behind it, and Play from the notification or the car found none.

const BOOT_QUIET_MS = 5000;

/** Whether the app is still opening, and speculative work stays out of it. */
let bootQuiet = false;
let bootQuietTimer: ReturnType<typeof setTimeout> | null = null;

/** Opens the window. Called where the saved queue is restored. */
function startBootQuiet() {
  bootQuiet = true;
  if (bootQuietTimer) clearTimeout(bootQuietTimer);
  bootQuietTimer = setTimeout(() => endBootQuiet(true), BOOT_QUIET_MS);
}

/**
 * Closes the window. Idempotent, and called by whatever comes first: the timer,
 * or the app being used.
 *
 * `catchUp` is for the two cases that leave the track where it is: the window
 * running out on its own, and Play being pressed on what was restored. Anything
 * that loads another track says no, because installing it does this again for
 * the song that is actually going to be heard, and doing it here would be
 * warming up the one being left behind.
 */
function endBootQuiet(catchUp = false) {
  if (!bootQuiet) return;
  bootQuiet = false;
  if (bootQuietTimer) clearTimeout(bootQuietTimer);
  bootQuietTimer = null;
  if (!catchUp) return;
  const song = currentSong(usePlayerStore.getState());
  if (!song) return;
  if (!song.url && !localSourceFor(song)) void ensureTranscodeOffsetSupport();
  scheduleNextSource();
  prefetchLyrics(song);
  warmUpcoming();
}

/** Now playing / history + syncs the queue on track change. */
function onTrackChanged(song: Song) {
  // Whatever the last stream announced was about the last stream. The
  // notification was built from it moments ago (this runs right after
  // `applyLockScreen`), so it has to be told again, or a station with nothing
  // to say would keep showing the previous one's track.
  if (usePlayerStore.getState().streamInfo) {
    usePlayerStore.setState({ streamInfo: null });
    const p = activePlayer();
    if (p && lockOwner === p) applyLockScreen(p, song);
  }
  // Only "I'm listening to this"; playback counts only when crossing the
  // threshold. Nothing is sent offline: a server account with no connection has
  // no one to tell. A track can also be loaded without playing (the queue
  // restored on reopen, the undo of a stop), and that is not a listen starting.
  const st = usePlayerStore.getState();
  // Not while the app is still opening: the queue coming back is not somebody
  // listening, and this is a request to the server (see the block above).
  if (!bootQuiet) reportState(st.isPlaying ? 'starting' : 'paused', song, st.positionSec);
  usePlayHistory.getState().record(song);
  // Warm up lyrics for what is playing. The next song's are warmed too, so
  // swiping in the player shows its card instantly, but a few seconds later:
  // a track change is the busiest moment there is, and the phone only holds a
  // handful of connections to the server at once, so speculative requests sent
  // right then put themselves in front of what the screens are waiting for
  // (#50). Nobody swipes to the next lyrics in the first five seconds.
  if (!bootQuiet) prefetchLyrics(song);
  if (nextLyricsTimer) clearTimeout(nextLyricsTimer);
  nextLyricsTimer = setTimeout(() => {
    const { queue, index } = usePlayerStore.getState();
    if (queue.length > 1) prefetchLyrics(queue[(index + 1) % queue.length]);
  }, NEXT_LYRICS_DELAY_MS);
  scheduleSync();
  warmUpcoming();
  // The mix only grows when the queue is running out under somebody who is
  // listening, and asking the server for it is not work for the cold start.
  if (!bootQuiet) void maybeQueueAutoplay();
  // Casting: reflect the new track in the media session (lock/volume).
  syncCastMedia();
}

// ── Preload upcoming tracks (warms up the stream in advance) ──────────────────
// For proxies like Octo Fiesta that fetch the track on demand: asking for the
// next few in advance leaves them cached before playback arrives. Off by
// default; a normal server only gets extra transcodes out of it.
//
// Reaching the server is not enough. The request has to be held open until it
// answers, or Octo Fiesta cancels the download and throws away what it wrote
// (see `WARM_TIMEOUT_MS`).
//
// And the window also moves when a song is put next, not only on a track
// change: warming only on the change left the song somebody had just asked for
// as the one nobody warmed (#137). The queue is watched for that at the bottom
// of this file.
const PRELOAD_AHEAD = 5;
/** Already-warmed ids: as the window slides only the new one entering is warmed
 *  (~1 request per advance), not all five each time. Cleared on queue change
 *  (playQueue). */
const warmedIds = new Set<string>();

function resetWarmed() {
  warmedIds.clear();
}

function warmUpcoming() {
  if (bootQuiet) return; // see the boot window: nothing speculative on the way in
  if (!useSettings.getState().preloadUpcoming) return;
  const auth = useAuthStore.getState().auth;
  if (!auth || useAuthStore.getState().offline) return;
  const { queue, index, repeat } = usePlayerStore.getState();
  if (queue.length <= 1) return;
  for (let i = 1; i <= PRELOAD_AHEAD; i++) {
    // 'one' doesn't change tracks; with 'all' the queue wraps around, if not cut.
    const ni = repeat === 'all' ? (index + i) % queue.length : index + i;
    if (repeat !== 'all' && ni >= queue.length) break;
    const song = queue[ni];
    // What plays from disk, and radio, don't go through the server: nothing
    // to warm.
    if (!song || song.url || localSourceFor(song)) continue;
    if (warmedIds.has(song.id)) continue;
    warmedIds.add(song.id);
    // Without `maxBitRate`: we warm the ORIGIN, not the transcoding. On an
    // Octo Fiesta-like proxy this still triggers the provider download (which is
    // the slow part), but does NOT lock in the transcoded session that playback
    // later uses, thus preserving seek (with the identical stream URL, that
    // first request would make it non-seekable and dragging would restart the
    // track). On a normal server, it also avoids extra transcodes.
    warmStream(song.id, streamUrl(auth, song.id));
  }
}

/**
 * How long a warm may sit waiting for the first byte. It used to be four
 * seconds, which is what made all of this do nothing on the proxy it was
 * written for (#137): Octo Fiesta's `/rest/stream` only answers once it has
 * pulled the whole track from the provider, and it hands the download the
 * request's own cancellation token. Hanging up at four seconds cancelled the
 * download and deleted the half-written file, so nothing was cached and the
 * track was fetched from scratch when playback reached it. Waiting costs
 * nothing: until those headers arrive the server has sent no bytes.
 */
const WARM_TIMEOUT_MS = 120_000;

/**
 * Single warming point, and only one at a time.
 *
 * The request is what matters, not the answer: on a proxy that fetches from a
 * provider, being asked for the track is what makes it go and get it. `Range`
 * keeps the reply to two bytes on a server that honours it, and the body is
 * never read on any server, so this stays cheap in data however long it waits.
 *
 * Serial because of what waiting means now. The phone holds a handful of
 * connections to the server at once, and five speculative requests each able
 * to hold one for two minutes would sit in front of the covers and the lists
 * the screens are waiting for, which is the very thing #50 was about. One at a
 * time, in window order, so the song coming next is the one warming.
 */
let warmChain: Promise<void> = Promise.resolve();

function warmStream(id: string, url: string) {
  warmChain = warmChain.then(() => warmRequest(id, url));
}

async function warmRequest(id: string, url: string) {
  // Nothing is warmed offline: there is no stream to fetch, and the request
  // would be one more thing reaching the network behind someone's back.
  if (useAuthStore.getState().offline) return;
  bump('preload · asked the server');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WARM_TIMEOUT_MS);
  try {
    // `expoFetch`, not the global one: this runs while a song is playing, which
    // is exactly when the app is in the background and React Native's stops
    // answering. See the note in `src/api/subsonic.ts`.
    await expoFetch(url, { headers: { Range: 'bytes=0-1' }, signal: ctrl.signal });
    // Headers back: whatever the server had to do to have this track ready is
    // done, and the file it wrote outlives the connection. `expo/fetch` hands
    // the body over as a stream nobody reads, so hanging up here is what keeps
    // a server that ignores `Range` from streaming a whole track at us.
    ctrl.abort();
    bump('preload · server ready');
  } catch {
    // Best-effort, but not forgotten: a warm that timed out left the server
    // with nothing cached (it deletes what it had half-written), so the id goes
    // back in the hat and the next time the window moves it is tried again.
    bump('preload · no answer');
    warmedIds.delete(id);
  } finally {
    clearTimeout(timer);
  }
}

// ── Autoplay: when nearing the end of the queue, enqueue similar songs ──────
// (Spotify-like). Online only, with the setting enabled (or in radio mode) and
// without repeating request for the same last song.
let autoplayFetchedFor: string | null = null;
/**
 * The round that is fetching right now, so a second caller waits for it instead
 * of being told there is nothing.
 *
 * Starting a mix asks twice within the same tick: loading the seed sends the
 * track-change round off on its own, and `startRadio` then asks again so it can
 * report whether anything was found. The second used to see the tail already
 * marked and return empty-handed, `startRadio` measured a queue of one, and the
 * app said it had found nothing to mix with while the first round was still in
 * the air. The mix then filled in a moment later, which is what made the
 * message so obviously wrong to anybody reading it.
 */
let autoplayRound: Promise<void> | null = null;

/** Songs by the same artist that fit in one batch: what keeps a mix from
 *  turning into that artist's discography. */
const MAX_PER_ARTIST = 2;
/** Similar artists explored per batch, and songs taken from each. */
const SIMILAR_ARTISTS = 4;
const SONGS_PER_SIMILAR_ARTIST = 5;
/** Songs a batch aims for (the queue is then extended by up to 10). */
const BATCH_SIZE = 12;

/** Shuffles a copy (Fisher-Yates). */
function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Top songs by artists similar to the seed's. This is the tier that actually
 * gives a mix its range: everything else either stays on the seed's artist or
 * falls back to a whole genre.
 *
 * The similar-artist list is cached per seed because with a fixed seed (see
 * `radioSeed`) it's the same every batch and it costs a request. Servers
 * without a Last.fm agent answer nothing here, which is why the mix still needs
 * the fallback tiers below.
 */
let similarArtistsCache: { seedId: string; names: string[] } | null = null;

async function similarArtistCandidates(auth: SubsonicAuth, seed: Song): Promise<Song[]> {
  if (!seed.artistId) return [];
  if (similarArtistsCache?.seedId !== seed.id) {
    const info = await getArtistInfo(auth, seed.artistId);
    similarArtistsCache = { seedId: seed.id, names: info.similarArtists.map((a) => a.name) };
  }
  // Shuffled, not the top N: over a long mix this walks the whole list instead
  // of hammering the same four artists batch after batch.
  const names = shuffled(similarArtistsCache.names).slice(0, SIMILAR_ARTISTS);
  const lists = await Promise.all(
    names.map((n) => getTopSongs(auth, n, SONGS_PER_SIMILAR_ARTIST).catch(() => [] as Song[])),
  );
  return lists.flat();
}

/**
 * Random songs from the seed's genre. When the track carries no genre tag, the
 * one its album siblings carry: tags live per file, so an untagged track can
 * perfectly well sit inside an otherwise tagged album. Empty if neither has one.
 */
async function genreCandidates(auth: SubsonicAuth, seed: Song): Promise<Song[]> {
  let genre = seed.genre;
  if (!genre && seed.albumId) {
    const { songs } = await getAlbum(auth, seed.albumId);
    genre = songs.find((s) => s.genre)?.genre;
  }
  return genre ? getRandomSongs(20, genre) : [];
}

/**
 * Songs to extend a radio from `seed`.
 *
 * The three affinity sources are asked at once into a single pool, shuffled and
 * capped at `MAX_PER_ARTIST`: taking the first non-empty tier whole filled the
 * batch with twenty consecutive tracks by one artist. Genre and random only top
 * up what affinity left, and they are the safety net, since on Navidrome the
 * affinity tiers all go through Last.fm.
 *
 * Only the random tiers honour the library filter, because only `getRandomSongs`
 * takes a folder and a song does not say which library it came from (#39).
 */
async function radioCandidates(auth: SubsonicAuth, seed: Song, have: Set<string>): Promise<Song[]> {
  const picked: Song[] = [];
  const seen = new Set(have);
  const perArtist = new Map<string, number>();

  /** Adds what fits from a pool, in random order and respecting the cap. */
  const take = (songs: Song[]) => {
    for (const s of shuffled(songs)) {
      if (picked.length >= BATCH_SIZE) return;
      if (s.url || seen.has(s.id)) continue;
      const artist = s.artistId ?? s.artist ?? '';
      const n = perArtist.get(artist) ?? 0;
      if (n >= MAX_PER_ARTIST) continue;
      perArtist.set(artist, n + 1);
      seen.add(s.id);
      picked.push(s);
    }
  };

  const affinity = await Promise.all([
    getSimilarSongs(auth, seed.id, 30).catch(() => [] as Song[]),
    similarArtistCandidates(auth, seed).catch(() => [] as Song[]),
    seed.artist
      ? getTopSongs(auth, seed.artist, 20).catch(() => [] as Song[])
      : Promise.resolve([] as Song[]),
  ]);
  take(affinity.flat());

  for (const tier of [() => genreCandidates(auth, seed), () => getRandomSongs(50)]) {
    if (picked.length >= BATCH_SIZE) break;
    try {
      take(await tier());
    } catch {
      continue; // this tier failed; the next one might work
    }
  }
  if (picked.length > 0) return picked;

  // Nothing at all: on a library small or homogeneous enough, the per-artist
  // cap can eat every candidate there was. A batch by one artist beats the mix
  // going silent.
  const anything = await getRandomSongs(50).catch(() => [] as Song[]);
  return anything.filter((s) => !s.url && !have.has(s.id)).slice(0, BATCH_SIZE);
}

// ── The rest of the artist ─────────────────────────────────────────────────
// A queue started from an artist screen holds their popular tracks, and those
// run out. What follows used to be either silence or a mix of other people,
// neither of which is what someone pressing play on an artist asked for (#79),
// so their own catalogue goes first: album by album, oldest on, and only once
// that is exhausted does the mix get its turn.

/** Albums still to be handed over, for the artist queue being played. */
let artistFill: { href: string; albums: Album[]; next: number } | null = null;

/** The artist a queue came from, or null if it came from anywhere else. */
function artistOfQueue(sourceHref: string | null): string | null {
  const match = sourceHref?.match(/^\/artist\/([^/]+)$/);
  return match ? match[1] : null;
}

/**
 * Adds the artist's next album to the queue. True if it added anything, which
 * is the caller's cue to leave the mix alone for now.
 *
 * One album per turn on purpose: this runs when the queue is two songs from
 * the end, so an album buys another twenty minutes and the next one is fetched
 * in that time. Pulling the whole discography at once is dozens of requests for
 * someone who may well stop after the popular tracks (#50).
 */
async function extendWithArtistCatalog(auth: SubsonicAuth, artistId: string, href: string) {
  if (artistFill?.href !== href) {
    const { albums } = await getArtist(auth, artistId);
    // Oldest first, like "Play discography": once the popular tracks are done,
    // what follows is the artist's story in order.
    artistFill = {
      href,
      albums: [...albums].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity)),
      next: 0,
    };
  }
  const fill = artistFill;
  while (fill.next < fill.albums.length) {
    const album = fill.albums[fill.next];
    fill.next += 1;
    const { songs } = await getAlbum(auth, album.id);
    const st = usePlayerStore.getState();
    // The queue may have moved on while the server answered.
    if (st.sourceHref !== href) return false;
    const have = new Set(st.queue.map((s) => s.id));
    const fresh = songs.filter((s) => !have.has(s.id) && !s.url);
    // Nothing new: the album was already in the queue (it came from "Play
    // discography", or its songs are the popular ones). On to the next.
    if (fresh.length === 0) continue;
    usePlayerStore.setState({ queue: [...st.queue, ...fresh] });
    scheduleSync();
    return true;
  }
  return false;
}

async function maybeQueueAutoplay() {
  const { queue, index, repeat, radioMode, radioSeed, sourceHref } = usePlayerStore.getState();
  // With repeat the queue never "runs out"; and if 2+ songs remain, not yet.
  if (repeat !== 'off' || index < queue.length - 2) return;
  const { auth, offline } = useAuthStore.getState();
  if (!auth || offline) return;
  // Before the mix, and before the autoplay setting has a say: this is not
  // similar music, it is the artist that was asked for. A mix is left alone,
  // since there the drift is the whole point.
  const artistId = radioMode ? null : artistOfQueue(sourceHref);
  if (artistId) {
    try {
      if (await extendWithArtistCatalog(auth, artistId, sourceHref!)) return;
    } catch {
      // The catalogue is unreachable; the mix below is still worth a try.
    }
  }
  // Radio extends even if autoplay is off: you started it manually.
  if (!useSettings.getState().autoplaySimilar && !radioMode) return;
  const last = queue[queue.length - 1];
  if (!last || last.url) return;
  // Already asked for this tail: if that round is still going, its answer is
  // the answer, so wait for it rather than reporting nothing.
  if (autoplayFetchedFor === last.id) return autoplayRound ?? undefined;
  autoplayFetchedFor = last.id;
  autoplayRound = fetchAutoplay(auth, last, radioMode, radioSeed, queue);
  return autoplayRound;
}

/** One round of it: asks the server and appends what is worth appending. */
async function fetchAutoplay(
  auth: SubsonicAuth,
  last: Song,
  radioMode: boolean,
  radioSeed: Song | null,
  queue: Song[],
): Promise<void> {
  // A mix always extends from the track it was started on. Seeding off the tail
  // (which is what plain autoplay does, and rightly so) made every batch reseed
  // on the previous batch's last track, so the mix drifted arbitrarily far from
  // the song whose name the player was still showing.
  const seed = radioMode ? (radioSeed ?? last) : last;
  let similar: Song[];
  try {
    // The backup tiers (artist, genre) only in radio: normal autoplay
    // behaves as before.
    similar = radioMode
      ? await radioCandidates(auth, seed, new Set([seed.id, ...queue.map((s) => s.id)]))
      : await getSimilarSongs(auth, last.id, 20);
  } catch {
    return; // without autoplay: playback will stop at the end, as before
  }
  const st = usePlayerStore.getState();
  // The queue may have changed while the server was responding; we only add if
  // the last song is still the same.
  if (st.queue[st.queue.length - 1]?.id !== last.id) return;
  const have = new Set(st.queue.map((s) => s.id));
  const picked = similar.filter((s) => !have.has(s.id) && !s.url).slice(0, 10);
  if (picked.length === 0) return;
  // Marked so the player can stop announcing the album or the playlist once
  // playback reaches them (`mixSeedOf`). Not in a radio: there the whole queue
  // is the mix and it already says so, and marking would have the header work
  // out a seed of its own instead of using the name the mix was started with.
  const fresh = radioMode ? picked : picked.map((s) => ({ ...s, fromMix: true }));
  usePlayerStore.setState({ queue: [...st.queue, ...fresh] });
  scheduleSync();
}

/** Next index on end/skip; null if playback should stop. */
function nextIndex(_manual: boolean): number | null {
  const { queue, index, repeat } = usePlayerStore.getState();
  // Offline, tracks without local file (stream-only) are skipped; online any is
  // fine. `ok` decides if an index is a candidate.
  const offline = useAuthStore.getState().offline;
  const ok = (i: number) => !offline || playableOffline(queue[i]);
  for (let i = index + 1; i < queue.length; i++) {
    if (ok(i)) return i;
  }
  // End of queue: with repeat 'all' it wraps around searching from the beginning
  // (includes the current index, so a single playable track repeats).
  if (repeat === 'all') {
    for (let i = 0; i <= index; i++) {
      if (ok(i)) return i;
    }
  }
  return null;
}

// ── Gapless ─────────────────────────────────────────────────────────────────
// Advancing on `didJustFinish` fetches the next track only once the previous
// one has ended, and that connection is the gap (#8). Instead it is queued
// inside the native player (`setNextSource`, in patches/expo-audio.patch),
// which buffers it and joins them themselves; the jump arrives as
// `trackTransition` and JS only follows.
//
// The join is as tight as the format allows: with no transcoding, or
// transcoding to Opus, the encoder padding is described in the file and gets
// trimmed; an MP3 or AAC generated on the fly carries no such metadata, so a
// few tens of milliseconds of encoder silence stay. The buffer gap, which is
// the audible one, goes either way.

/** Track queued in the native player, or null. The id travels along: the queue
 *  can be reordered between queueing it and getting there. */
let queuedNext: { index: number; id: string } | null = null;

/**
 * Point of entry for every source change. `replace()` installs a new media
 * source and drops whatever was queued behind it, so the memo can't outlive it.
 */
function replaceSource(p: AudioPlayer, source: AudioSource) {
  queuedNext = null;
  p.replace(source);
}

/**
 * Does queueing the next track make sense right now?
 *
 * Not a preference: nobody asks to have silence put back between their songs,
 * so there is no setting for it. Crossfade is the one that turns it off, by
 * taking the change over.
 */
function gaplessReady(): boolean {
  const settings = useSettings.getState();
  // Crossfade drives the advance itself, starting the next track early on the
  // reserve player. Both cannot own the change.
  if (settings.crossfadeSec > 0) return false;
  if (remoteKind()) return false;
  const st = usePlayerStore.getState();
  // 'one' repeats through the native `loop`, and "stop at end of song" needs
  // the track to end for real so its `didJustFinish` arrives.
  if (st.repeat === 'one' || st.sleepAtSongEnd) return false;
  const current = st.queue[st.index];
  // A radio has no end to join anything to.
  return !!current && !current.url;
}

/**
 * Queues the track that comes next in the native player, or drops the queued
 * one when it no longer applies. `force` re-queues even if it's the same track
 * (its URL changed: bitrate, format).
 */
function scheduleNextSource(force = false) {
  const p = activePlayer();
  if (!p) return;
  const st = usePlayerStore.getState();
  // Repeating one song is the native `loop`, which a source holding only part
  // of the song cannot do (see `applyLoop`). What comes after that source is
  // the same song from the beginning: queued here, the player joins them by
  // itself, so the track never ends. Letting it end instead worked, but the
  // notification showed the end of the song for the instant it took to ask for
  // it again, and the silence of that request was audible.
  // Not with "stop at end of song" pending: that one waits for the track to
  // end for real, and joining another source behind it means it never does.
  const restartSelf =
    st.repeat === 'one' && streamOffsetSec > 0 && !st.sleepAtSongEnd && !remoteKind();
  const ni = restartSelf ? st.index : gaplessReady() ? nextIndex(false) : null;
  const next = ni == null ? null : st.queue[ni];
  if (ni == null || !next || next.url) {
    if (queuedNext) {
      queuedNext = null;
      try {
        p.clearNextSource();
      } catch {
        // ignore
      }
    }
    return;
  }
  // `force` re-queues the same track anyway: same song, different URL.
  if (!force && queuedNext && queuedNext.index === ni && queuedNext.id === next.id) return;
  try {
    p.setNextSource(sourceFor(next));
    queuedNext = { index: ni, id: next.id };
  } catch {
    queuedNext = null;
  }
}

/**
 * The player moved on by itself to the queued track. Nothing is loaded here:
 * it's already playing. This is the same bookkeeping `loadIndex` does around
 * its `replace()`, without the replace.
 */
function onTrackTransition() {
  const queued = queuedNext;
  queuedNext = null;
  const p = activePlayer();
  // The player moved to a track JS had already forgotten queueing. Nothing here
  // can fix it —there is no telling which song it went to— but it is worth
  // counting: from this moment the store, the notification and the car are all
  // describing the track before the one being heard, which is what a cover from
  // a neighbouring song looks like from the outside.
  if (!queued) bump('player · transition with no memo');
  if (!queued || !p) return;
  const st = usePlayerStore.getState();
  // Follow the song, not the position: the queue may have been reordered while
  // it was waiting its turn.
  let index = queued.index;
  if (st.queue[index]?.id !== queued.id) {
    index = st.queue.findIndex((s) => s.id === queued.id);
    // It was removed from the queue while playing: there's no index to move to,
    // so the state stays put and the track end takes the normal path.
    if (index === -1) {
      bump('player · transition to a song no longer queued');
      return;
    }
  }
  const song = st.queue[index];
  // A song repeating itself is not something to walk back to: ⏮️ would have
  // spent one press per lap on the song already playing.
  if (index !== st.index) pushHistory();
  consumeQueuedOnIndexChange(index);
  pendingSeek = null;
  setStreamOffset(0, p);
  // Whole song again: from here the repeat is the native `loop`, and nothing
  // else needs queueing behind it.
  applyLoop(p);
  sourceHasLength = null; // another source: unknown until it reports
  scrobbledThisTrack = false;
  // ReplayGain is per song. Not mid-ramp (sleep fade, pause fade): setting the
  // volume here would undo it.
  if (!sleepFadeTimer && !pauseFadeTimer) p.volume = effectiveVolume(song);
  // The same player carries on with the rate it had, which is right for
  // anything gapless queues (never a station) and puts it back to 1 if this
  // song turns out to be one.
  applySpeed(p, song);
  usePlayerStore.setState({
    index,
    positionSec: 0,
    durationSec: song.duration ?? 0,
    isPlaying: true,
    isBuffering: false,
  });
  applyLockScreen(p, song);
  onTrackChanged(song);
  if (!song.url && !localSourceFor(song)) void ensureTranscodeOffsetSupport();
  scheduleNextSource();
}

// Crossfade on/off decides who owns the advance, and the stream URL of the
// queued track depends on format and bitrate: all of them have to re-evaluate
// what is (or is no longer) waiting behind the current track.
const gaplessSettingsKey = (s: ReturnType<typeof useSettings.getState>) =>
  `${s.crossfadeSec}|${s.streamFormat}|${s.streamFormatCellular}|${s.maxBitRate}|${s.maxBitRateCellular}`;
let lastGaplessSettings = gaplessSettingsKey(useSettings.getState());
useSettings.subscribe((s) => {
  const key = gaplessSettingsKey(s);
  if (key === lastGaplessSettings) return;
  lastGaplessSettings = key;
  scheduleNextSource(true);
});

// ── ReplayGain (volume normalization) ────────────────────────────────────────
// A player's effective volume is always `volume` (the user's) times the
// ReplayGain factor of ITS song. Tags come from the server (and are
// preserved in downloads); without tags or with the setting off, 1.

/** Linear ReplayGain factor for a song according to the setting mode. */
function gainFactor(song: Song | null | undefined): number {
  const settings = useSettings.getState();
  let mode = settings.replayGain;
  const rg = song?.replayGain;
  if (mode === 'off' || !rg) return 1;
  if (mode === 'auto') {
    // Like Spotify: whole album without shuffle → album gain (preserves
    // its internal dynamics); playlists, favorites or shuffle → per track.
    const st = usePlayerStore.getState();
    mode = st.sourceHref?.startsWith('/album/') && !st.shuffle ? 'album' : 'track';
  }
  // Album mode without album gain (or vice versa): use whatever is available.
  const gain = mode === 'album' ? (rg.albumGain ?? rg.trackGain) : (rg.trackGain ?? rg.albumGain);
  if (typeof gain !== 'number' || !Number.isFinite(gain)) return 1;
  // The pre-amp rides on top of the tag: it moves the target loudness the whole
  // library normalizes to, which is the point of having one (#93).
  let f = Math.pow(10, (gain + settings.replayGainPreampDb) / 20);
  // With positive gain, don't exceed the file's peak (prevents clipping).
  const peak = mode === 'album' ? (rg.albumPeak ?? rg.trackPeak) : (rg.trackPeak ?? rg.albumPeak);
  if (typeof peak === 'number' && peak > 0) f = Math.min(f, 1 / peak);
  // Safety clamp for wild tags.
  return Math.min(Math.max(f, 0.05), 4);
}

/** Effective volume (user × ReplayGain) for the given song. */
function effectiveVolume(song: Song | null | undefined): number {
  return usePlayerStore.getState().volume * gainFactor(song);
}

// When the mode or the pre-amp changes in Settings, re-apply the volume of the
// currently playing track (outside ramps: an in-progress fade only converges to
// the new value).
const replayGainKey = (s: ReturnType<typeof useSettings.getState>) =>
  `${s.replayGain}|${s.replayGainPreampDb}`;
let lastReplayGain = replayGainKey(useSettings.getState());
useSettings.subscribe((s) => {
  if (replayGainKey(s) === lastReplayGain) return;
  lastReplayGain = replayGainKey(s);
  if (fadingOut || pauseFadeTimer) return;
  const p = activePlayer();
  if (p) p.volume = effectiveVolume(currentSong(usePlayerStore.getState()));
});

// ── Playback speed ──────────────────────────────────────────────────────────
// Playing along with a record on an instrument is the reason this exists
// (#151), so the pitch does not move with the speed: media3 stretches time
// (`shouldCorrectPitch`, which expo-audio has on by default) and a song slowed
// to three quarters is still in its own key.
//
// It is a property of the player and not of the source, so every place that
// installs a source applies it: a `replace()` keeps whatever rate the player
// was running at, but the reserve player of a crossfade or a handoff is
// another player, and it starts at 1.

/** The speeds offered, in order. 1 is the normal one, and the default. */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/**
 * Rate a song should actually run at.
 *
 * A station arrives in real time: asking for it faster only drains the buffer
 * it is being fed and it stalls, so it always plays at 1. The choice is kept
 * either way and comes back with the next track that has a file behind it.
 */
function speedFor(song: Song | null | undefined): number {
  if (!song || song.url) return 1;
  return usePlayerStore.getState().speed;
}

/** Applies the speed of `song` to the player holding it. */
function applySpeed(p: AudioPlayer | null, song: Song | null | undefined) {
  if (!p) return;
  try {
    // Before the rate, not after: the pitch is worked out when the rate is
    // set, so a player told to correct it afterwards keeps the old parameters.
    p.shouldCorrectPitch = true;
    p.setPlaybackRate(speedFor(song));
  } catch {
    // ignore
  }
}

// ── Crossfade ───────────────────────────────────────────────────────────────
// When nearing the end of the track, the next one starts on the reserve player
// at volume 0 and both volumes cross (equal power curve).
// The incoming player becomes the active one from the first instant: state,
// notification and scrobble change when the fade starts, like Spotify.

let fadeTimer: ReturnType<typeof setInterval> | null = null;
/** Outgoing player while a fade is in progress. */
let fadingOut: AudioPlayer | null = null;
/**
 * Data of the in-progress crossfade (null if none). Progress is calculated by
 * wall clock (`t0`), so it doesn't matter who drives it: the foreground
 * smooth `setInterval` or the `onStatus` heartbeat. The latter is what fixes
 * crossfade in the background: Android freezes setIntervals on minimize, but
 * the native `playbackStatusUpdate` keeps beating, so the volume ramp still
 * advances and the incoming track doesn't stay silent at volume 0.
 */
let fadeState: {
  incoming: AudioPlayer;
  t0: number;
  fadeSec: number;
  outGain: number;
  inGain: number;
} | null = null;

/**
 * Aborts the in-progress fade, if any: silences and stops the outgoing and
 * leaves the active one at normal volume. Called on any intervention (manual
 * track change, seek, pause, reset, remote output…) so the rest of the
 * engine operates as if there were no crossfade.
 */
function cutCrossfade() {
  // An in-progress server handoff also uses the reserve player and is also
  // an operation that any intervention (track change, seek, pause,
  // reset…) must abort: goes through here, which is the common path.
  cancelHandoff();
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  fadeState = null;
  if (pauseFadeTimer) {
    clearInterval(pauseFadeTimer);
    pauseFadeTimer = null;
  }
  // And where that ramp was headed, which is the half that was being left
  // behind. `settleFade` finishes whatever is still noted here the next time
  // the app goes to the background, so a ramp this call abandoned came back
  // minutes later and landed on whatever was playing by then: the volume put
  // to zero, and if it had been a pause, the pause with it. What an
  // intervention cancels does not get to happen afterwards.
  pendingFade = null;
  // The sleep fade is also an in-progress ramp: if the user touches anything
  // (pause, seek, track change) it must be released, or it would keep lowering
  // the volume of whatever plays now. The expiry still stands and `onStatus`
  // re-arms it if still within the window.
  clearSleepFade();
  const volume = usePlayerStore.getState().volume;
  if (fadingOut) {
    try {
      fadingOut.pause();
      fadingOut.volume = volume;
    } catch {
      // ignore
    }
    fadingOut = null;
  }
  const p = activePlayer();
  if (p) p.volume = effectiveVolume(currentSong(usePlayerStore.getState()));
}

// ── Seamless server handoff ──────────────────────────────────────────────────
// On a server switch the playing track points at the old host, which may be
// dead. Reloading it on the active player leaves an audible hole while the new
// host buffers, so the new stream starts on the reserve player at volume 0,
// and once it is really playing it is aligned with the old position and takes
// over. No fade on purpose: it's the same song, and crossing two nearly equal
// positions would cause phase issues.
//
// It's driven by the NATIVE event of the reserve player itself (not a timer), so
// it survives background, which is where the automatic switch happens. It's
// aborted by `cutCrossfade` (track change, seek, pause, reset…) and, if the new
// host doesn't start on time, falls back to abrupt reload: never worse than before.
let handoffToken = 0;
let handoffReserve: AudioPlayer | null = null;
let handoffSub: { remove: () => void } | null = null;

/** Aborts an in-progress handoff and releases the reserve player. */
function cancelHandoff() {
  if (!handoffSub && !handoffReserve) return;
  handoffToken++;
  if (handoffSub) {
    try {
      handoffSub.remove();
    } catch {
      // ignore
    }
    handoffSub = null;
  }
  if (handoffReserve) {
    try {
      handoffReserve.pause();
      handoffReserve.volume = usePlayerStore.getState().volume;
    } catch {
      // ignore
    }
    handoffReserve = null;
  }
}

/** Reloads the current track abruptly against the active URL and returns to its
 *  position (classic behavior; handoff fallback and the path for paused case). */
function hardReload(index: number, sec: number, autoplay: boolean) {
  void (async () => {
    await loadIndex(index, autoplay);
    if (sec > 0) seekActive(sec);
  })();
}

/** Seamless handoff of the current track to the active host (see block above). */
function handoffToNewSource(index: number, song: Song, sec: number) {
  cutCrossfade(); // releases the reserve player and cancels any previous handoff
  const oldP = activePlayer();
  if (!oldP) {
    hardReload(index, sec, true);
    return;
  }
  // With transcoded stream and timeOffset support, the new one starts right at
  // `sec` (native seek doesn't work on a real-time transcode). If not, from 0
  // and we seek: normal random access.
  const useOffset = needsOffsetSeek(song) && transcodeOffsetSupported === true;
  const startAt = useOffset ? sec : 0;
  const r = ensurePlayer(1 - activeIdx);
  const token = ++handoffToken;
  handoffReserve = r;
  try {
    replaceSource(r, sourceFor(song, startAt));
    applyLoop(r, startAt);
    applySpeed(r, song);
    r.volume = 0; // inaudible until the switch; the old one keeps playing from its buffer
    r.play();
    if (!useOffset && sec > 0) r.seekTo(sec);
  } catch {
    handoffReserve = null;
    hardReload(index, sec, true);
    return;
  }
  let ticks = 0;
  let aligned = false;
  handoffSub = r.addListener('playbackStatusUpdate', (st: AudioStatus) => {
    if (token !== handoffToken) return; // already canceled
    ticks += 1;
    const ready = st.playing && st.isLoaded && !st.isBuffering && (st.currentTime ?? 0) > 0;
    if (!ready) {
      // ~6 s (12 ticks of 500 ms): the new host doesn't start → abrupt reload.
      if (ticks > 12) {
        cancelHandoff();
        hardReload(index, sec, true);
      }
      return;
    }
    // First instant the new one is playing: bring it to where the old one is NOW
    // (it advanced while loading) and wait one tick for it to arrive, to avoid
    // repeating or skipping audio. With offset the start already matches: no re-request.
    if (!aligned && !useOffset) {
      aligned = true;
      try {
        r.seekTo(oldP.currentTime ?? sec);
      } catch {
        // ignore
      }
      return;
    }
    // Ready and aligned: instant switch. First flip the active so the new one
    // already feeds state; this way the old one's pause (which emits
    // playing=false) is ignored and the play button doesn't flicker.
    handoffSub?.remove();
    handoffSub = null;
    handoffReserve = null;
    handoffToken += 1;
    try {
      r.volume = effectiveVolume(song);
    } catch {
      // ignore
    }
    activeIdx = 1 - activeIdx;
    setStreamOffset(useOffset ? startAt : 0, r);
    try {
      oldP.pause();
      oldP.volume = usePlayerStore.getState().volume;
    } catch {
      // ignore
    }
    usePlayerStore.setState({ isBuffering: false });
    applyLockScreen(r, song);
  });
}

/** If it's time (setting active and ≤ N seconds left), starts the crossfade. */
function maybeStartCrossfade(status: AudioStatus) {
  const fadeSec = useSettings.getState().crossfadeSec;
  // `handoffReserve`: a server handoff is using the reserve player.
  if (fadeSec <= 0 || fadingOut || handoffReserve || !status.playing) return;
  const st = usePlayerStore.getState();
  // Same cases excluded by normal advance, plus those with no predictable end
  // (radio) or where a fade makes no sense (very short tracks).
  if (st.repeat === 'one' || st.sleepAtSongEnd) return;
  // Nor during sleep fade: two ramps on the same volume, and the crossfade
  // would start the incoming at full volume on the way to silence.
  if (sleepFadeTimer) return;
  const current = st.queue[st.index];
  const duration = st.durationSec;
  if (!current || current.url || duration < fadeSec + 5) return;
  // What is left of the track measured in seconds of clock, which is what the
  // fade is made of: at 1.5× the last nine seconds of music are six of ramp,
  // and comparing the two straight started the fade while there was still a
  // third of it left to play.
  const remaining =
    (duration - (streamOffsetSec + (status.currentTime ?? 0))) / speedFor(current);
  if (remaining <= 0 || remaining > fadeSec) return;
  const ni = nextIndex(false);
  if (ni == null) return;
  const next = st.queue[ni];
  if (!next || next.url) return;
  startCrossfade(ni, Math.min(fadeSec, remaining));
}

function startCrossfade(index: number, fadeSec: number) {
  const st = usePlayerStore.getState();
  const song = st.queue[index];
  if (!song) return;
  const outgoingSong = st.queue[st.index];
  const out = activePlayer();
  const p = ensurePlayer(1 - activeIdx);
  try {
    replaceSource(p, sourceFor(song));
    p.loop = false;
    p.volume = 0;
    applySpeed(p, song);
    p.play();
  } catch {
    return; // no crossfade: the normal track end will do the change
  }
  pushHistory();
  consumeQueuedOnIndexChange(index);
  fadingOut = out;
  activeIdx = 1 - activeIdx;
  setStreamOffset(0, p); // the incoming track starts from the beginning
  sourceHasLength = null; // and it's another source: unknown until it loads
  scrobbledThisTrack = false;
  usePlayerStore.setState({
    index,
    positionSec: 0,
    durationSec: song.duration ?? 0,
    isPlaying: true,
  });
  applyLockScreen(p, song);
  onTrackChanged(song);
  // Each end of the fade points to the effective volume of ITS song
  // (ReplayGain per track); the user volume is read live on each tick.
  runFade(p, fadeSec, gainFactor(outgoingSong), gainFactor(song));
}

/**
 * Advances the crossfade one step according to elapsed time: crosses the
 * volumes (equal power curve, the sum is perceived as constant) and, at the
 * end, shuts off the outgoing and closes the fade. It's idempotent and without
 * its own state, so both the foreground `setInterval` and the `onStatus`
 * backup can call it without stepping on each other.
 */
function tickFade() {
  if (!fadeState) return;
  const { incoming, t0, fadeSec, outGain, inGain } = fadeState;
  const x = Math.min(1, (Date.now() - t0) / (fadeSec * 1000));
  const volume = usePlayerStore.getState().volume;
  const out = fadingOut;
  try {
    if (out) out.volume = volume * outGain * Math.cos((x * Math.PI) / 2);
    incoming.volume = volume * inGain * Math.sin((x * Math.PI) / 2);
  } catch {
    // ignore
  }
  if (x >= 1) {
    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
    if (out) {
      try {
        out.pause();
        out.volume = volume;
      } catch {
        // ignore
      }
    }
    if (fadingOut === out) fadingOut = null;
    fadeState = null;
  }
}

/**
 * Starts the fade: `fadingOut` was already set by `startCrossfade`. The 200 ms
 * `setInterval` drives the smooth ramp in foreground; in background it freezes
 * and the `onStatus` heartbeat takes over (see `fadeState`).
 */
function runFade(
  incoming: AudioPlayer,
  fadeSec: number,
  outGain: number,
  inGain: number,
) {
  if (fadeTimer) clearInterval(fadeTimer);
  fadeState = { incoming, t0: Date.now(), fadeSec, outGain, inGain };
  fadeTimer = setInterval(tickFade, 200);
}

// ── Short fade on pause/resume (only in-app controls) ────────────────────────
// System play/pause (notification, lock screen, Android Auto, headphones)
// go through native and stay instant, which is expected there.

const PAUSE_FADE_MS = 180;
let pauseFadeTimer: ReturnType<typeof setInterval> | null = null;

/** The ramp in flight, so it can be closed out before its timer stops running. */
let pendingFade: { p: AudioPlayer; to: number; onDone?: () => void } | null = null;

/**
 * Whether a volume ramp can be run at all.
 *
 * It is a `setInterval`, and JS timers do not run reliably once Android has put
 * the app in the background. A ramp that stalls half way through is not a
 * cosmetic loss: what pauses the player lives in its completion, so the
 * speakers keep playing while everything on screen says paused, and on the way
 * back in the volume stays at zero, so the song runs silently with its progress
 * bar moving (#140). Backgrounded, the change is made outright.
 */
function canFade(): boolean {
  return AppState.currentState === 'active';
}

/** Ends the ramp in flight where it was headed, and runs what was waiting on
 *  it. For the moment the app leaves the foreground: whatever is left of a ramp
 *  from then on may never run. */
function settleFade() {
  const fade = pendingFade;
  if (!fade) return;
  if (pauseFadeTimer) {
    clearInterval(pauseFadeTimer);
    pauseFadeTimer = null;
  }
  pendingFade = null;
  try {
    fade.p.volume = fade.to;
  } catch {
    // ignore
  }
  fade.onDone?.();
}

/** Linear ramp of `p`'s volume from `from` to `to` in PAUSE_FADE_MS; when done
 *  calls `onDone`. Cancels any previous pause/resume ramp. */
function fadeVolume(p: AudioPlayer, from: number, to: number, onDone?: () => void) {
  if (pauseFadeTimer) {
    clearInterval(pauseFadeTimer);
    pauseFadeTimer = null;
  }
  pendingFade = { p, to, onDone };
  const t0 = Date.now();
  pauseFadeTimer = setInterval(() => {
    const x = Math.min(1, (Date.now() - t0) / PAUSE_FADE_MS);
    try {
      p.volume = from + (to - from) * x;
    } catch {
      // ignore
    }
    if (x >= 1) {
      if (pauseFadeTimer) clearInterval(pauseFadeTimer);
      pauseFadeTimer = null;
      pendingFade = null;
      onDone?.();
    }
  }, 25);
}

// After a seek, the native player keeps emitting states with the old position
// until the seek completes; if allowed through, the UI (slider, karaoke lyrics)
// would bounce to the old position and jump back. While the seek is pending, the
// requested position is held and crossfade is not evaluated (an old state near
// the end would falsely trigger it).
let pendingSeek: { sec: number; at: number } | null = null;

/** expo-audio state listener: progress, play/pause and track end. */
// ── Server-down detection during playback ───────────────────────────────────
// autoUrl reacts to the network changing and to Home failing, so a server going
// down mid-track goes unnoticed. A stall says it: a stream stuck buffering with
// the position not moving asks for a probe.
//
// It is also the shape a bad connection takes when it does not fail outright,
// the socket open and nothing arriving, so past `STALL_FALLBACK_MS` the
// downloaded file takes over (see `onPlaybackError` for the failing case).
const STALL_PROBE_MS = 6000;
const STALL_FALLBACK_MS = 15000;
let stallSince = 0;
let stallPos = -1;
let stallProbed = false;
let stallFellBack = false;

function maybeDetectStall(intendPlay: boolean, buffering: boolean, positionSec: number): void {
  const st = usePlayerStore.getState();
  const song = st.queue[st.index];
  // Only applies online and to tracks coming from the server via streaming
  // (what plays from disk does not depend on the server).
  const streamed = !!song && !song.url && !localSourceFor(song);
  if (useAuthStore.getState().offline || !intendPlay || !streamed || !buffering) {
    stallSince = 0;
    stallProbed = false;
    stallFellBack = false;
    stallPos = positionSec;
    return;
  }
  // If the position advances, it's a normal rebuffer, not a stall.
  if (Math.abs(positionSec - stallPos) > 0.5) {
    stallSince = 0;
    stallProbed = false;
    stallFellBack = false;
    stallPos = positionSec;
    return;
  }
  const now = Date.now();
  if (stallSince === 0) {
    stallSince = now;
    return;
  }
  if (!stallProbed && now - stallSince >= STALL_PROBE_MS) {
    stallProbed = true; // once per stall; autoUrl already retries
    checkAutoUrlNow();
  }
  // Fifteen seconds of a stream that is not arriving, with the song sitting on
  // the disk: play that instead, from where it stopped. Only once per stall, and
  // only for a song that has a file. For the rest there is nothing to move to,
  // and the probe above is already asking whether the server is there at all.
  if (!stallFellBack && now - stallSince >= STALL_FALLBACK_MS && song && downloadedUri(song)) {
    stallFellBack = true;
    bump('player · fell back to the file after a stall');
    failedSource.set(song.id, 'stream');
    void reloadCurrent(positionSec, true);
  }
}

// ── When the player cannot play what it was given ────────────────────────────
// media3 reports it (`error` on the status), and nothing here used to read it:
// the app kept its playing state, the position stopped moving, and that was the
// whole of it. A stream cut off by a bad connection and a downloaded file that
// is no longer readable both ended the same way, as silence waiting for
// somebody to press the next track.

/** Which track the attempts below belong to, and how many it has had. */
let errorTrackId: string | null = null;
let errorAttempts = 0;
/** Two: enough to ride out a hiccup, few enough not to retry a dead source. */
const MAX_ERROR_ATTEMPTS = 2;

/**
 * The error in its own words, with anything that looks like an address taken
 * out: this is counted, and counts are what the Diagnostics report is made of.
 * A stream URL carries the credentials, so none of them can go in it.
 */
function errorTag(message: string): string {
  const clean = message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, 'url')
    .replace(/\/[\w./-]{16,}/g, 'path')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 80 ? `${clean.slice(0, 80)}…` : clean;
}

/**
 * Answers a playback failure: the other copy of the song if it has one, a
 * second go at the same one if it does not, and the truth if neither sounds.
 *
 * Deliberately not the next track. A failure that skips walks a whole album in
 * silence, and the one thing the person watching needs to know is that this
 * song is not playing, which a toast says and an advancing queue hides.
 */
function onPlaybackError(message: string, wasPlaying: boolean): void {
  const st = usePlayerStore.getState();
  const song = st.queue[st.index];
  bump(`player · playback error (${errorTag(message)})`);
  if (!song) return;
  if (errorTrackId !== song.id) {
    errorTrackId = song.id;
    errorAttempts = 0;
  }
  if (errorAttempts >= MAX_ERROR_ATTEMPTS) {
    bump('player · gave up on the track');
    usePlayerStore.setState({ isPlaying: false, isBuffering: false });
    useToast.getState().show(tg("Couldn't play the song"));
    return;
  }
  errorAttempts++;
  // The other copy, and only the first time round: once it is marked, what just
  // failed IS the other copy, and swapping back would be a loop.
  if (!failedSource.has(song.id) && !song.url) {
    const { auth, offline } = useAuthStore.getState();
    if (localSourceFor(song)) {
      // The phone's own library has no stream behind it, and neither has a
      // download with no connection: the mark is only worth putting on when
      // there is somewhere else to play from. A song of the phone's own is the
      // one with a `localUri` and no download: the mark of a download built
      // offline is that same field (see `markUnplayableOffline`), and behind
      // that one there is a server.
      const phoneOnly = !!song.localUri && !downloadedUri(song);
      if (!phoneOnly && auth && !offline) failedSource.set(song.id, 'file');
      // And a download whose file is not there at all should stop being
      // promised, by its badge and by the catalog behind it.
      void useDownloads.getState().forgetIfMissing(song.id);
    } else if (downloadedUri(song)) {
      failedSource.set(song.id, 'stream');
    }
  }
  void reloadCurrent(st.positionSec, wasPlaying);
}

/** Installs the current track again, at the second it had got to. */
async function reloadCurrent(atSec: number, autoplay: boolean): Promise<void> {
  const { index, queue } = usePlayerStore.getState();
  const song = queue[index];
  if (!song) return;
  if (!(await loadIndex(index, autoplay))) return;
  // `loadIndex` starts the song at zero, which is right for everything else
  // that calls it: what failed here was in the middle of one. And only if it is
  // still the same song, since anything the person did while this loaded owns
  // the player now.
  const now = usePlayerStore.getState();
  if (now.queue[now.index]?.id !== song.id) return;
  if (atSec > 0) {
    seekActive(atSec);
    usePlayerStore.setState({ positionSec: atSec });
  }
}

function onStatus(status: AudioStatus) {
  // Before anything can decide not to use it. This beat is the only clock that
  // survives the app being minimized, so whether it arrives is the first thing
  // worth knowing about the minutes nobody was watching (see `beat`).
  beat(status.playing);
  // With remote output (UPnP/DLNA) the local player is paused and its
  // states should not override those coming from the remote device.
  if (remoteKind()) return;
  // Sleep timer fallback: if setTimeout got frozen in background, the
  // native player heartbeat fires it here.
  const endsAt = sleepDeadline();
  if (endsAt && Date.now() >= endsAt) {
    fireSleepTimer();
    return;
  }
  // Same fallback for the fade: if its timer got frozen, or if an
  // intervention released it and expiry is still within the window, the
  // player heartbeat re-arms it with whatever is left.
  if (endsAt && !sleepFadeTimer) {
    const left = endsAt - Date.now();
    if (left <= SLEEP_FADE_MS) startSleepFade(left);
  }
  // Crossfade fallback: its setInterval freezes in background, but
  // this native heartbeat stays alive, so the volume ramp advances anyway and
  // the incoming song stops staying silent at volume 0 on minimize.
  if (fadeState) tickFade();
  const prev = usePlayerStore.getState();
  // Buffering if we want to play but audio isn't flowing yet (initial load,
  // streaming rebuffer, seek…). If paused, it's not buffering.
  const intendPlay = status.playing || prev.isPlaying;
  // The player could not play what it was handed. Nothing below this applies:
  // the status that comes with a failure is a stopped player at a position that
  // is not going to move, and what to do about that is its own question.
  if (status.error) {
    onPlaybackError(status.error, intendPlay);
    return;
  }
  // Sound: whatever it took, this track is not the failing one any more.
  if (status.playing && errorTrackId) {
    errorTrackId = null;
    errorAttempts = 0;
  }
  const buffering =
    intendPlay && !status.didJustFinish && (status.isBuffering || !status.isLoaded);
  // Only once loaded: while buffering the duration is still unknown and would
  // pass for a stream generated on the fly (see `sourceHasLength`).
  if (status.isLoaded) sourceHasLength = (status.duration ?? 0) > 0;
  // With a stream re-requested with timeOffset, the native player counts from 0:
  // the real position is the offset plus its time.
  let positionSec = streamOffsetSec + (status.currentTime ?? 0);
  if (pendingSeek) {
    if (Math.abs(positionSec - pendingSeek.sec) < 1 || Date.now() - pendingSeek.at > 5000) {
      pendingSeek = null; // the player reached the target (or we gave up)
    } else {
      positionSec = pendingSeek.sec;
    }
  }
  const state = usePlayerStore.getState();
  const maxPos = state.durationSec > 0 ? state.durationSec : Infinity;
  positionSec = Math.max(0, Math.min(positionSec, maxPos));
  usePlayerStore.setState({
    positionSec,
    // With offset active the native reports the duration of the remaining segment,
    // not the song's: the known duration is kept.
    durationSec: streamOffsetSec > 0 ? prev.durationSec : status.duration || prev.durationSec,
    // During pause/resume fade the native player keeps playing for a few ms;
    // we keep the already-set state so the button doesn't flicker.
    isPlaying: pauseFadeTimer ? prev.isPlaying : status.playing,
    isBuffering: buffering,
  });
  maybeScrobbleThreshold(positionSec);
  maybeDetectStall(intendPlay, buffering, positionSec);
  // Queue sync with the server.
  if (status.playing) startPeriodicSync();
  else {
    stopPeriodicSync();
    if (prev.isPlaying) scheduleSync(); // just paused
  }
  if (!pendingSeek) maybeStartCrossfade(status);
  if (status.didJustFinish) {
    if (handleSleepAtSongEnd()) return;
    // Repeating one song is normally the native `loop` and never gets here. A
    // source that only holds part of the song (re-requested with `timeOffset`)
    // cannot be looped, though — it would replay that part — so it ends for
    // real and the song is asked for again from the beginning, which restores
    // the native loop for the plays after this one.
    const st = usePlayerStore.getState();
    if (st.repeat === 'one') {
      void loadIndex(st.index, true);
      return;
    }
    const ni = nextIndex(false);
    if (ni == null) {
      usePlayerStore.setState({ isPlaying: false });
    } else {
      pushHistory();
      void loadIndex(ni, true);
    }
  }
}

/**
 * "At end of song" timer: if active, stops here and leaves the next track
 * loaded but paused. Returns true if it consumed the track end.
 */
function handleSleepAtSongEnd(): boolean {
  const { sleepAtSongEnd, repeat } = usePlayerStore.getState();
  if (!sleepAtSongEnd) return false;
  usePlayerStore.setState({ sleepAtSongEnd: false, isPlaying: false });
  cutCrossfade();
  activePlayer()?.pause();
  const ni = nextIndex(false);
  if (ni != null && repeat !== 'one') void loadIndex(ni, false);
  return true;
}

// ── Local queue persistence (resume on app reopen) ──────────────────────────
// Complements server sync: works in local/offline mode too and preserves
// downloaded songs and radios, which the server doesn't accept in
// savePlayQueue.

// SecureStore only accepts keys with [A-Za-z0-9._-] (same criterion as
// playHistory); sanitize serverUrl/username.
function safeKey(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Per-profile key, or null if no active profile. */
function queueStorageKey(): string | null {
  const { auth, offline } = useAuthStore.getState();
  if (offline) return 'resonus.queue.offline';
  // The profile's own name (not the active URL): so the queue is not lost on a
  // network switch, which changes the active URL. See auth store.
  if (auth) {
    return `resonus.queue.server.${safeKey(primaryUrl(auth))}.${safeKey(auth.username)}`;
  }
  return null;
}

interface StoredQueue {
  queue: Song[];
  index: number;
  positionSec: number;
  /** The queue was a radio: when restoring it must keep extending itself. */
  radioMode?: boolean;
  /** Track the radio was started from, so it keeps extending from the same
   *  place after a restart. Absent in queues saved by older versions: those
   *  fall back to seeding off the tail. */
  radioSeed?: Song | null;
  /** Where the queue came from, for the player's "playing from" header. */
  source?: string | null;
  /** Route of that origin, so tapping the header still navigates there. */
  sourceHref?: string | null;
  /**
   * Shuffle and repeat as they were left (#102). Both are how someone listens
   * rather than something they set up once, and finding them off after every
   * cold start meant turning them on again each morning. `originalQueue` is
   * NOT saved: it would double what a queue weighs, and turning shuffle off
   * without it keeps the order that is playing instead of restoring the
   * album's, which is a fair price for a session that already ended.
   */
  shuffle?: boolean;
  repeat?: RepeatMode;
  /** The queue was dealt when it was started (see `queueDealt`). */
  dealt?: boolean;
}

/** Guards what comes back from disk: the file is ours, but an older version's
 *  (or a hand-edited one's) is not worth trusting into the player. */
function isRepeatMode(v: unknown): v is RepeatMode {
  return v === 'off' || v === 'one' || v === 'all';
}

/**
 * Something other than the position changed since the last write. Set by the
 * store subscription at the end of this file.
 *
 * The periodic sync runs every twenty seconds while playing, and rewriting up
 * to 500 whole songs into SecureStore, which encrypts them, to move one number
 * is exactly the kind of work that shows up as a dropped tap (#50). In the
 * foreground it now writes only when the queue itself moved; in the background
 * it writes as before, since the position does keep advancing there and nobody
 * is waiting on the JS thread.
 */
let queueDirty = true;

/**
 * Rewrites the ids in the queue, in memory and on disk.
 *
 * Without it, the first thing a migrated server does is a queue that will not
 * start: it is restored on launch from songs whose ids the server has
 * forgotten. Nothing is lost, and one tap on anything else gets out of it, but
 * it is the most visible thing left after a migration.
 *
 * `sourceHref` is not touched. It is a route with an id inside it, and picking
 * that apart means knowing every route shape; getting it wrong sends the
 * "playing from" header somewhere that does not exist, which is worse than the
 * header being right and its link stale.
 */
export function remapQueueIds(f: Remap) {
  const { queue, radioSeed } = usePlayerStore.getState();
  if (queue.length === 0 && !radioSeed) return;
  usePlayerStore.setState({
    queue: queue.map((s) => remapSong(s, f)),
    radioSeed: radioSeed ? remapSong(radioSeed, f) : radioSeed,
  });
  saveQueueLocal(true);
}

function saveQueueLocal(force = false) {
  const key = queueStorageKey();
  if (!key) return;
  const {
    queue,
    index,
    positionSec,
    radioMode,
    radioSeed,
    source,
    sourceHref,
    shuffle,
    queueDealt,
    repeat,
  } = usePlayerStore.getState();
  if (queue.length === 0) return;
  if (!force && !queueDirty && AppState.currentState === 'active') return;
  queueDirty = false;
  // Size cap as a precaution for SecureStore; 500 songs is more than enough.
  const payload: StoredQueue = {
    queue: queue.slice(0, 500),
    index: Math.min(index, 499),
    positionSec,
    radioMode,
    radioSeed,
    source,
    sourceHref,
    shuffle,
    dealt: queueDealt,
    repeat,
  };
  void setItem(key, JSON.stringify(payload));
}

/**
 * Forgets the active profile's saved queue (the user emptied it on purpose).
 * An empty queue is saved instead of deleting the key: it's the "tombstone"
 * that prevents restoreQueue from resurrecting the server copy on the next
 * startup (the server offers no reliable way to delete its own).
 */
function clearQueueLocal() {
  const key = queueStorageKey();
  if (!key) return;
  // The tombstone carries how the person was listening, because that is not
  // part of the queue that was emptied. Left out, shuffle and repeat were
  // written over with nothing the moment the queue was cleared, and nothing
  // put them back: `saveQueueLocal` gives up on an empty queue, so the next
  // cold start read them as off. Kept on while the app is open and gone after
  // a restart is the kind of difference nobody can explain to themselves
  // (reported by @ztx-lyghters).
  const { shuffle, repeat } = usePlayerStore.getState();
  const empty: StoredQueue = { queue: [], index: 0, positionSec: 0, shuffle, repeat };
  void setItem(key, JSON.stringify(empty));
}

// ── Queue sync with server (savePlayQueue/getPlayQueue) ─────────────────────
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let appStateAttached = false;

/** Saves the queue on this device and, if there is a session, on the server. */
function syncQueueNow(force = false, syncRemote = true) {
  saveQueueLocal(force);
  // The local copy above is the one that matters offline, and it is the only
  // one written there: the server's copy is a request, and offline mode makes
  // none. Without this the queue was pushed every twenty seconds and on every
  // trip to the background, which is a phone using data its owner said not to.
  const { auth, offline } = useAuthStore.getState();
  const { queue, index, positionSec } = usePlayerStore.getState();
  const current = queue[index];
  if (auth && !offline && current && !current.url && !current.localUri) {
    const ids = queue.filter((s) => !s.url && !s.localUri).map((s) => s.id);
    if (ids.length > 0) {
      void savePlayQueue(auth, ids, current.id, Math.floor(positionSec * 1000));
    }
  }
  if (syncRemote && remoteKind() === 'upnp') {
    void syncUpnpRemoteQueue(
      {
        queue,
        index,
        positionSec,
        isPlaying: usePlayerStore.getState().isPlaying,
        shuffle: usePlayerStore.getState().shuffle,
        repeat: usePlayerStore.getState().repeat,
      },
      force,
    );
  }
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncQueueNow, 2500);
}

function startPeriodicSync() {
  if (!syncInterval) syncInterval = setInterval(syncQueueNow, 20000);
}

function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function attachAppState() {
  if (appStateAttached) return;
  appStateAttached = true;
  AppState.addEventListener('change', (st) => {
    if (st !== 'active') {
      // A ramp started an instant ago is about to lose its timer, and with it
      // whatever was waiting on the end of it (the pause, most of all). This is
      // the last moment anything of ours is certain to run, so it is closed out
      // here rather than left hanging (#140).
      settleFade();
      // Leaving the foreground is the last chance to write down where playback
      // was, so this one is not up for skipping. For remote playback this must
      // not force a queue rewrite: minimizing the app should not touch the
      // current Sonos transport state.
      syncQueueNow(true, false);
      return;
    }
    // Back to foreground. The native `playbackStatusUpdate` heartbeat that feeds
    // `positionSec`/`durationSec` can stall while backgrounded — especially right
    // after a background auto-advance, where the freshly `replace()`d track never
    // gets a tick until a manual pause/resume. Discrete events (track metadata,
    // play/pause) still arrive, so the cover/title update but the scrubber stays
    // frozen/empty. Pull the current status once here so position and duration
    // are correct the instant the screen is shown; the heartbeat resumes on its
    // own from now on.
    const p = activePlayer();
    if (p && !remoteKind()) {
      try {
        onStatus(p.currentStatus);
      } catch {
        // A stale native player can throw on read; the next heartbeat recovers.
      }
      // And say again what is playing. The notification's metadata is only ever
      // pushed from here —nothing native refreshes it when the player moves on
      // by itself— so a push that was missed while nobody was looking stayed
      // missed, with the notification, the car and the watch describing an
      // earlier track for as long as it kept playing. Coming back is the one
      // moment we know the queue is being read again, and re-asserting it costs
      // a single call.
      const song = currentSong(usePlayerStore.getState());
      if (song && lockOwner === p) applyLockScreen(p, song);
    }
  });
}

/**
 * Attaches remote output events (UPnP/DLNA) to the queue; see
 * src/store/upnp.ts. Call once on startup.
 */
export function initRemoteIntegration() {
  const events: RemoteEvents = {
    onConnected: () => {
      // Transfers the current track to the device and silences the local player.
      const { queue, index, positionSec, isPlaying, sleepEndsAt } = usePlayerStore.getState();
      cutCrossfade();
      try {
        activePlayer()?.pause();
      } catch {
        // ignore
      }
      resetUpnpRemoteSyncState();
      clearLockScreen();
      if (sleepEndsAt) {
        const remainingSec = Math.max(0, Math.round((sleepEndsAt - Date.now()) / 1000));
        void upnpSetSleepTimer(remainingSec);
      }
      const { crossfadeSec } = useSettings.getState();
      void upnpSetCrossfade(crossfadeSec > 0);
      if (queue[index]) void remoteLoadIndex(index, isPlaying, positionSec);
    },
    onTrackChanged: (index, positionSec, durationSec) => {
      const state = usePlayerStore.getState();
      const song = state.queue[index];
      if (!song) return;
      usePlayerStore.setState({
        index,
        positionSec,
        durationSec: durationSec || song.duration || state.durationSec,
      });
      onTrackChanged(song);
    },
    onDisconnected: (lastPositionSec) => {
      // The casting media session is already closed by `upnpDisconnect` (covers
      // silent disconnects too). Here we just return to the local player.
      const { queue, index } = usePlayerStore.getState();
      resetUpnpRemoteSyncState();
      if (!queue[index]) return;
      void (async () => {
        await loadIndex(index, false);
        if (lastPositionSec > 0) seekActive(lastPositionSec);
        usePlayerStore.setState({ positionSec: lastPositionSec, isPlaying: false });
      })();
    },
    onProgress: (positionSec, durationSec) => {
      usePlayerStore.setState({
        positionSec,
        durationSec: durationSec || usePlayerStore.getState().durationSec,
      });
      const st = usePlayerStore.getState();
      maybeScrobbleThreshold(positionSec);
      // Updates the casting notification/lock screen scrubber.
      if (isUpnpConnected()) castSetState(st.isPlaying, positionSec * 1000);
    },
    onPlayingChanged: (isPlaying, isBuffering) => {
      usePlayerStore.setState({ isPlaying, isBuffering });
      if (isPlaying) startPeriodicSync();
      else {
        stopPeriodicSync();
        scheduleSync();
      }
      // Reflects play/pause in the casting media session.
      if (isUpnpConnected()) castSetState(isPlaying, usePlayerStore.getState().positionSec * 1000);
    },
    onRepeatChanged: (repeat) => {
      const current = usePlayerStore.getState().repeat;
      if (repeat === current) return;
      usePlayerStore.setState({ repeat });
      applyLoop(activePlayer());
      scheduleSync();
    },
    onFinished: () => {
      if (handleSleepAtSongEnd()) return;
      const { repeat, index } = usePlayerStore.getState();
      if (repeat === 'one') {
        void remoteLoadIndex(index, true);
        return;
      }
      const ni = nextIndex(false);
      if (ni == null) {
        usePlayerStore.setState({ isPlaying: false });
      }
      else void loadIndex(ni, true);
    },
  };
  initUpnp(events);
  initJukebox(events);
  // Sync crossfade toggle to Sonos whenever the setting changes.
  let lastCrossfadeSec = useSettings.getState().crossfadeSec;
  useSettings.subscribe((s) => {
    if (s.crossfadeSec !== lastCrossfadeSec) {
      lastCrossfadeSec = s.crossfadeSec;
      if (isUpnpConnected()) void upnpSetCrossfade(s.crossfadeSec > 0);
    }
  });
  // Controls pressed in the notification/lock screen or volume buttons during
  // casting: the store actions are already routed to the renderer (remoteKind()).
  initCastMedia((action, value) => {
    if (!isUpnpConnected()) return;
    const st = usePlayerStore.getState();
    switch (action) {
      case 'play':
        if (!st.isPlaying) st.toggle();
        break;
      case 'pause':
      case 'stop':
        if (st.isPlaying) st.toggle();
        break;
      case 'next':
        st.next();
        break;
      case 'previous':
        st.previous();
        break;
      case 'seek':
        if (value != null) st.seekTo(value / 1000);
        break;
      case 'volume':
        // The system sends +1 / -1 per press; we move volume in steps.
        st.setVolume(st.volume + (value ?? 0) * 0.05);
        break;
      default:
        break;
    }
  });
}

interface PlayerState {
  queue: Song[];
  index: number;
  /**
   * Manually-added "add to queue" songs still pending; occupy
   * positions index+1..index+queuedCount (Spotify "Next in queue"-style:
   * they play right after the current one, before the list continues).
   */
  queuedCount: number;
  isPlaying: boolean;
  /** Audio is loading/buffering and not yet playing. */
  isBuffering: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  /**
   * How fast what is playing runs, 1 being as recorded. Carries from one track
   * to the next, which is the point of it (#151): you set it once and practise
   * over a whole album.
   *
   * It does NOT survive closing the app, unlike shuffle and repeat. Those are
   * how somebody listens; this one belongs to an afternoon with an instrument,
   * and a library that quietly comes back at three quarters months later is a
   * bug report, not a preference. While it is not 1 the player says so.
   */
  speed: number;
  shuffle: boolean;
  /**
   * What is playing was dealt when it was started: the Shuffle button of an
   * album or a playlist, which hands its list over shuffled once without
   * turning the shuffle MODE on (see `playQueue`). The mode is the only thing
   * that used to be known, so that button lit nothing and looked broken to
   * whoever had just pressed it.
   */
  queueDealt: boolean;
  repeat: RepeatMode;
  originalQueue: Song[] | null;
  /** When the sleep timer expires (ms epoch), or null if none. */
  sleepEndsAt: number | null;
  /** Pause at the end of the current track ("end of song" timer). */
  sleepAtSongEnd: boolean;
  /** Where the current queue came from (album, playlist, artist…), if known. */
  source: string | null;
  /** Origin path so we can navigate to it from the player. */
  sourceHref: string | null;
  /**
   * The queue is a radio: it extends itself with similar tracks even if the
   * autoplay setting is off, because you started it manually. Turned on by
   * `startRadio`; any other queue (album, playlist…) turns it off.
   */
  radioMode: boolean;
  /**
   * The track the current mix was started from. Every extension is seeded from
   * it, so the mix stays about that song instead of drifting batch by batch.
   * Null when there's no mix (and on queues restored from the server, which has
   * nowhere to carry it).
   */
  radioSeed: Song | null;
  /**
   * Track the internet radio playing right now says it is on, or null when
   * there is no radio or the stream doesn't say. It changes on its own, without
   * the queue changing (see `onStreamMetadata`).
   */
  streamInfo: StreamInfo | null;
  playQueue: (
    songs: Song[],
    startIndex?: number,
    source?: string,
    sourceHref?: string,
    opts?: {
      /**
       * What every "Shuffle" button asks for: this list dealt once, played in
       * that order from the top (`startIndex` no longer means anything). It is
       * NOT the shuffle mode, which is left exactly as it was found: the button
       * used to turn it on, and since the mode survives restarts that made the
       * next album you pressed play on come out shuffled too.
       */
      shuffled?: boolean;
    },
  ) => Promise<boolean>;
  /**
   * Starts a radio from a song: plays it immediately and the queue keeps
   * filling itself with similar tracks, endlessly.
   *
   * Resolves once the first batch has been asked for, to whether the mix
   * actually got tracks: a mix that found nothing must not be announced as
   * started.
   */
  startRadio: (seed: Song, source: string) => Promise<boolean>;
  /** Stops extending the queue. Doesn't touch it: finishes when it finishes. */
  stopRadio: () => void;
  addToQueue: (song: Song) => void;
  playNext: (song: Song) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  /** Sets the playback speed (see `speed`). Heard right away, without
   *  reloading anything. */
  setSpeed: (v: number) => void;
  jumpTo: (index: number, kind?: JumpKind) => void;
  /** Removes the song at `index`. Returns a function that reinserts it in its
   *  place (for the "Undo" toast), except when removing the current one or
   *  emptying. */
  removeAt: (index: number) => Promise<(() => void) | undefined>;
  moveTrack: (from: number, to: number) => void;
  /** Saves the rating (1-5; 0 = unrated) in the queue copies. */
  rateSong: (id: string, rating: number) => void;
  /** Empties the queue leaving only the current song (keeps playing). Returns
   *  a function that undoes the clear (for the "Undo" toast), or nothing if
   *  there was no queue. */
  clearQueue: () => (() => void) | undefined;
  /** Real stop (long-press on play): stops and removes queue, mini player and
   *  notification. Returns a function that undoes it (queue and position back,
   *  paused), or nothing if nothing was playing. */
  stopAndClear: () => Promise<(() => void) | undefined>;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setSleepTimer: (minutes: number) => void;
  setSleepAtSongEnd: () => void;
  cancelSleepTimer: () => void;
  /** Restores the queue saved on the server (without playing). */
  restoreFromServer: () => Promise<void>;
  /** Restores the queue saved on this device (without playing).
   *  Returns true if there was a local copy (even an intentionally emptied
   *  queue): in that case the server backup should not enter. */
  restoreFromStorage: () => Promise<boolean>;
  /** Resumes the last queue: first the local copy; if none, the server's. */
  restoreQueue: () => Promise<void>;
  /** Reloads the current track against the active server URL, preserving
   *  position and playback state. Called on network URL switch (the old
   *  source stopped responding). Doesn't affect radio/local/downloaded. */
  reloadCurrent: () => void;
  /**
   * Empties the queue and lets the player go. `forProfile` is the harder
   * version, for when the account itself is changing: it also forgets shuffle
   * and repeat, which belong to the profile that is leaving.
   */
  reset: (forProfile?: boolean) => Promise<void>;
}

/** What a stream announced it is playing. Its artist is often folded into the
 *  title by the station, in which case it comes out of the split. */
export interface StreamInfo {
  title: string;
  artist?: string;
}

/** Song currently playing, or null if the queue is empty. */
export function currentSong(state: PlayerState): Song | null {
  return state.queue[state.index] ?? null;
}

/**
 * The song the mix now playing was built from, or null while what plays is
 * still the queue's own album or playlist. Once playback crosses into the block
 * autoplay appended, the header was still naming the album and linking to it
 * (#65).
 *
 * Worked out rather than stored: the block goes on the end in one piece, so the
 * song before it is the seed. That survives a restart with no field to persist,
 * and skipping back puts the album's name back. Not for radios, where the whole
 * queue is the mix.
 */
export function mixSeedOf(state: Pick<PlayerState, 'queue' | 'index'>): Song | null {
  if (!state.queue[state.index]?.fromMix) return null;
  let i = state.index;
  // Songs added by hand land in the middle of the block without belonging to
  // it, so the walk goes past them: otherwise the first one found would pass
  // for the seed and the mix would be named after a song someone queued.
  while (i > 0 && (state.queue[i - 1]?.fromMix || state.queue[i - 1]?.queued)) i--;
  return state.queue[i - 1] ?? null;
}

/**
 * The song playing was added to the queue by hand, so the header names the
 * queue instead of the source (#65). Unlike a mix this undoes itself: it is a
 * property of the song, and the next one that isn't yours puts the album back
 * along with the way into it.
 */
export function playingQueued(state: Pick<PlayerState, 'queue' | 'index'>): boolean {
  return !!state.queue[state.index]?.queued;
}

/**
 * What `song`'s stream says it is playing, for the screens that show it. Null
 * for anything that isn't a radio broadcasting metadata, and then the song's
 * own title and artist are the whole story.
 */
export function useLiveInfo(song: Song | null | undefined): StreamInfo | null {
  const info = usePlayerStore((s) => s.streamInfo);
  return song?.url ? info : null;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  queuedCount: 0,
  isPlaying: false,
  isBuffering: false,
  positionSec: 0,
  durationSec: 0,
  volume: 1,
  speed: 1,
  shuffle: false,
  queueDealt: false,
  repeat: 'off',
  originalQueue: null,
  sleepEndsAt: null,
  sleepAtSongEnd: false,
  source: null,
  sourceHref: null,
  radioMode: false,
  radioSeed: null,
  streamInfo: null,

  playQueue: async (songs, startIndex = 0, source, sourceHref, opts) => {
    if (songs.length === 0) return false;
    // Discard offline-unavailable tracks (not downloaded): they can't be
    // played. The initial index is remapped to the tapped song within the
    // already-filtered list. Online never marks `unavailable`, so it doesn't change.
    if (songs.some((s) => s.unavailable)) {
      const tapped = songs[startIndex];
      const playable = songs.filter((s) => !s.unavailable);
      if (playable.length === 0) return false;
      startIndex = tapped && !tapped.unavailable ? Math.max(0, playable.indexOf(tapped)) : 0;
      songs = playable;
    }
    // Offline, a queue with nothing downloaded in it cannot be played at all,
    // and it used to be set anyway: the mini player then showed a song that was
    // never loaded, and pressing play resumed whatever had been loaded before
    // it. Nothing is touched, so what was playing keeps playing.
    if (useAuthStore.getState().offline && !songs.some(playableOffline)) {
      useToast.getState().show(tg('Nothing here is downloaded'));
      return false;
    }
    attachAppState();
    autoplayFetchedFor = null;
    autoplayRound = null;
    // A new queue starts the artist's catalogue over, even the same artist's:
    // what was handed over before is not in this queue.
    artistFill = null;
    resetWarmed();
    // Before jumping to another list/album, save the current song in the
    // "back" history so we can return to it (Spotify-style). Starting the list
    // that is already playing is not a jump: there is nowhere to go back to,
    // and what it kept of this list is about to stop existing.
    const key = contextKey(source ?? null, sourceHref ?? null);
    if (key) forgetHistoryOf(key);
    if (!key || key !== contextKey(get().source, get().sourceHref)) pushHistory();
    // Mark the source as recently listened (Library "Recents" order, Home grid).
    // Its name travels with it: what was played is drawn from this alone when
    // no list from the server happens to include it.
    if (sourceHref) useLastPlayed.getState().touch(sourceHref, source);
    // Two different things end up shuffled here. The Shuffle button hands the
    // whole list over dealt, with no song picked, so nothing is pinned to the
    // front. Shuffle MODE, on the other hand, is a way of listening rather than
    // a property of one album: a list started while it is on keeps the song
    // that was tapped first and deals the rest, which is what the mode's own
    // button does, and turning the mode off afterwards puts the album back in
    // its order — that is what `originalQueue` is for. Asking for both deals
    // everything: there was no tapped song to keep.
    const dealAll = opts?.shuffled && songs.length > 1;
    const deal = !dealAll && get().shuffle && songs.length > 1;
    const first = songs[startIndex];
    const queued = dealAll
      ? dealt(songs)
      : deal
        ? [first, ...dealt(songs.filter((_, i) => i !== startIndex))]
        : songs;
    const at = dealAll || deal ? 0 : startIndex;
    // What is on screen right now, kept in case the new queue never manages to
    // play. The list goes in before it is loaded on purpose, since that is what
    // makes tapping a song feel immediate, but a load that fails used to leave
    // it there: the app showing one song, the speakers still on the last one,
    // and nothing to say which was which (@ztx-lyghters). Whatever is put back
    // is what is actually playing, so the two agree again.
    const before = {
      queue: get().queue,
      index: get().index,
      queuedCount: get().queuedCount,
      positionSec: get().positionSec,
      durationSec: get().durationSec,
      originalQueue: get().originalQueue,
      queueDealt: get().queueDealt,
      source: get().source,
      sourceHref: get().sourceHref,
      radioMode: get().radioMode,
      radioSeed: get().radioSeed,
    };
    set({
      queue: queued,
      index: at,
      queuedCount: 0,
      positionSec: 0,
      durationSec: 0,
      originalQueue: deal ? songs : null,
      // Both ways of dealing count: the Shuffle button of the list (`dealAll`)
      // and tapping a song with the mode already on.
      queueDealt: dealAll || deal,
      source: source ?? null,
      sourceHref: sourceHref ?? null,
      // Any normal queue turns off the radio; `startRadio` turns it back on.
      radioMode: false,
      radioSeed: null,
    });
    // Only when there was something to go back to: with nothing playing before,
    // an empty queue says less than the one that failed, and the toast has
    // already said what happened.
    const ok = await loadIndex(at, true);
    if (!ok && before.queue.length > 0) set(before);
    return ok;
  },

  startRadio: async (seed, source) => {
    const cur = currentSong(get());
    if (cur && cur.id === seed.id) {
      // Mix seeded by what's already playing: only the queue AROUND it changes,
      // so we swap the context without touching the player. Going through
      // `playQueue` would `replace()` the source and throw the track back to
      // 0:00, which is not what "start mix" means when you're already listening
      // to that song. We keep `cur` (not `seed`) in the queue: same song, but
      // the object the player is already loaded with.
      pushHistory();
      autoplayFetchedFor = null;
      autoplayRound = null;
      artistFill = null;
      resetWarmed();
      set({
        queue: [cur],
        index: 0,
        queuedCount: 0,
        shuffle: false,
        queueDealt: false,
        originalQueue: null,
        source,
        sourceHref: null,
        radioMode: true,
        radioSeed: cur,
      });
      // `loadIndex` isn't running, so nothing else is going to persist this.
      scheduleSync();
      await maybeQueueAutoplay();
      return get().queue.length > 1;
    }
    // Play the seed immediately and similar tracks are requested later: waiting
    // for the server to respond before pressing play would make "start mix" feel
    // broken. Awaiting `maybeQueueAutoplay` afterwards doesn't delay playback,
    // only the answer of whether the mix found anything.
    await get().playQueue([seed], 0, source);
    set({ radioMode: true, radioSeed: seed });
    await maybeQueueAutoplay();
    return get().queue.length > 1;
  },

  stopRadio: () => {
    set({ radioMode: false, radioSeed: null });
    saveQueueLocal();
  },

  // Spotify-style: manually added songs play right after the current one (and
  // after what was already added before), not at the end of the playing list.
  //
  // Adding one from the queue itself hands back the very object that is in it,
  // mark and all, so a song picked out of a mix would have carried the mark
  // into the middle of an album and taken the header with it (`handAdded`).
  addToQueue: (song) => {
    const { queue, index, queuedCount } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    const next = [...queue];
    next.splice(Math.min(index + queuedCount + 1, next.length), 0, handAdded(song));
    set({ queue: next, queuedCount: queuedCount + 1 });
    scheduleSync();
  },

  playNext: (song) => {
    const { queue, index, queuedCount } = get();
    if (queue.length === 0) {
      void get().playQueue([song], 0);
      return;
    }
    const next = [...queue];
    next.splice(index + 1, 0, handAdded(song));
    // It jumps to the front of the "queued" block; the block grows with it.
    set({ queue: next, queuedCount: queuedCount + 1 });
    scheduleSync();
  },

  toggle: () => {
    // The one press that does not change track: what was restored is about to
    // be heard, so what the opening held back is due now.
    endBootQuiet(true);
    if (remoteKind()) {
      if (get().isPlaying) {
        remotePause();
        set({ isPlaying: false });
      } else {
        remotePlay();
        set({ isPlaying: true });
      }
      return;
    }
    const p = activePlayer();
    if (!p) {
      // No player yet: the restored queue never got as far as loading a track,
      // which offline means none of it is on disk. Going through `loadIndex`
      // plays what can be played, and says so when nothing can.
      const { queue, index } = get();
      if (queue[index]) void loadIndex(index, true);
      return;
    }
    // Effective volume of the current track (user × ReplayGain).
    const vol = effectiveVolume(currentSong(get()));
    if (get().isPlaying) {
      // Pausing mid-fade cuts the outgoing: on resume only the current track
      // should play, at normal volume.
      cutCrossfade();
      set({ isPlaying: false });
      const stop = () => {
        try {
          p.pause();
          // Reconcile in case volume changed during the ramp; this way a later
          // play (including system/lock screen) sounds at the real volume.
          p.volume = effectiveVolume(currentSong(get()));
        } catch {
          // ignore
        }
        scheduleSync(); // the "on pause" sync that onStatus does
      };
      // Lower volume and pause when done; leaves volume restored so a later
      // play (including system/lock screen) sounds normal. Backgrounded there
      // is no ramp to wait on: the pause is what matters and it happens now.
      if (canFade()) fadeVolume(p, vol, 0, stop);
      else stop();
    } else {
      const ramp = canFade();
      // Start silent and ramp up: fade-in on resume. Backgrounded it starts at
      // its own volume instead, because nothing would raise it afterwards.
      try {
        p.volume = ramp ? 0 : vol;
      } catch {
        // ignore
      }
      p.play();
      set({ isPlaying: true });
      if (ramp) {
        fadeVolume(p, 0, vol, () => {
          try {
            p.volume = effectiveVolume(currentSong(get()));
          } catch {
            // ignore
          }
        });
      }
    }
  },

  next: () => {
    endBootQuiet();
    const ni = nextIndex(true);
    if (ni != null) {
      pushHistory();
      void loadIndex(ni, skipAutoplay(get().isPlaying));
    }
  },

  previous: () => {
    endBootQuiet();
    const { index, positionSec } = get();
    // Like Spotify: past a few seconds, "previous" restarts the song. In
    // "always" mode (YouTube-style) it always goes to the previous track, no restart.
    if (useSettings.getState().previousButtonMode !== 'always' && positionSec > 3) {
      get().seekTo(0);
      return;
    }
    // Returns to the previous song in history, even if from another list/album.
    const playing = get().isPlaying;
    const entry = playedHistory.pop();
    if (entry) {
      set({
        queue: entry.queue,
        index: entry.index,
        source: entry.source,
        sourceHref: entry.sourceHref,
        originalQueue: entry.originalQueue,
        shuffle: entry.shuffle,
        queueDealt: entry.queueDealt,
        queuedCount: 0,
        positionSec: 0,
        durationSec: 0,
      });
      void loadIndex(entry.index, skipAutoplay(playing));
      return;
    }
    if (index > 0) void loadIndex(index - 1, skipAutoplay(playing));
    else get().seekTo(0);
  },

  seekTo: (sec) => {
    // A second of this song, and nothing else. The app's own slider cannot hand
    // over anything but that, and the car can: what reaches here from there is
    // whatever media3 gave the session, which is not always a time (see the car
    // module's `handleSeek`). A position the player cannot answer is not a seek
    // that goes nowhere, it is a player that stops.
    if (!Number.isFinite(sec)) return;
    const duration = get().durationSec;
    // A radio has no length to stay inside of, and a stream still loading has
    // not said its own yet.
    const target = Math.max(0, duration > 0 ? Math.min(sec, duration) : sec);
    cutCrossfade();
    if (remoteKind()) {
      remoteSeek(target);
      set({ positionSec: target });
    } else {
      seekActive(target);
    }
    // The server works out the position between reports by letting the clock
    // run, so a jump nobody told it about leaves its panel counting from where
    // the song no longer is.
    const st = get();
    reportState(st.isPlaying ? 'playing' : 'paused', st.queue[st.index], target);
  },

  setVolume: (v) => {
    const volume = Math.max(0, Math.min(1, v));
    set({ volume });
    if (remoteKind()) remoteSetVolume(volume);
    else if (!fadingOut && !pauseFadeTimer) {
      // Mid-fade (crossfade or pause/resume) don't step on the ramp: it
      // converges on its own and volume is restored when done.
      const p = activePlayer();
      if (p) p.volume = effectiveVolume(currentSong(get()));
    }
  },

  setSpeed: (v) => {
    // The ends of what is offered. Android clamps to 0.1–2 on its own, and a
    // rate that came back clamped would leave the list showing a speed that is
    // not the one playing.
    const speed = Math.min(2, Math.max(0.5, v));
    set({ speed });
    // Only the player that is sounding: the reserve gets it when a source is
    // installed on it, and a remote renderer plays at its own pace.
    if (!remoteKind()) applySpeed(activePlayer(), currentSong(get()));
  },

  jumpTo: (index, kind = 'pick') => {
    endBootQuiet();
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    // Forward jump like any other: "previous" must be able to return.
    pushHistory();
    void loadIndex(index, kind === 'skip' ? skipAutoplay(get().isPlaying) : true);
  },

  removeAt: async (index) => {
    const { queue, index: cur, queuedCount } = get();
    if (index < 0 || index >= queue.length) return undefined;
    const removed = queue[index];
    const next = queue.filter((_, i) => i !== index);
    if (next.length === 0) {
      clearQueueLocal();
      await get().reset();
      return undefined;
    }
    if (index === cur) {
      // We remove the current one: load the song now at that position. If it was
      // the first in the "queued" block, it now plays and is consumed.
      const newIndex = Math.min(cur, next.length - 1);
      set({ queue: next, index: newIndex, queuedCount: Math.max(0, queuedCount - 1) });
      await loadIndex(newIndex, get().isPlaying);
      scheduleSync();
      return undefined;
    }
    const inQueuedBlock = index > cur && index <= cur + queuedCount;
    set({
      queue: next,
      index: index < cur ? cur - 1 : cur,
      queuedCount: inQueuedBlock ? queuedCount - 1 : queuedCount,
    });
    scheduleSync();
    return () => {
      // Only if the queue hasn't changed since then (same reference; auto-advance
      // does not replace it, so the index is adjusted).
      const st = get();
      if (st.queue !== next) return;
      const q = [...st.queue];
      q.splice(index, 0, removed);
      set({
        queue: q,
        index: st.index >= index ? st.index + 1 : st.index,
        queuedCount: inQueuedBlock ? st.queuedCount + 1 : st.queuedCount,
      });
      scheduleSync();
    };
  },

  clearQueue: () => {
    const { queue, index, queuedCount, originalQueue, radioMode, radioSeed } = get();
    const current = queue[index];
    if (!current) return undefined;
    // Clearing also turns off the radio. Otherwise it'd be zombie: autoplay only
    // triggers when STARTING a song, and after clearing none starts, so the icon
    // would say "radio active" on a radio that would never extend.
    set({
      queue: [current],
      index: 0,
      queuedCount: 0,
      originalQueue: null,
      radioMode: false,
      radioSeed: null,
    });
    scheduleSync();
    return () => {
      // Only if the queue is still as the clear left it (nothing new was put on).
      const st = get();
      if (st.queue.length !== 1 || st.queue[0]?.id !== current.id) return;
      set({ queue, index, queuedCount, originalQueue, radioMode, radioSeed });
      scheduleSync();
    };
  },

  stopAndClear: async () => {
    const {
      queue,
      index,
      positionSec,
      queuedCount,
      originalQueue,
      shuffle,
      source,
      sourceHref,
      radioMode,
      radioSeed,
    } = get();
    if (queue.length === 0) return undefined;
    // Deliberate stop: also forget the saved copy, so the queue doesn't
    // reappear on app reopen.
    clearQueueLocal();
    await get().reset();
    return () => {
      void (async () => {
        // Only if nothing new was started playing in the meantime.
        if (get().queue.length > 0) return;
        attachAppState();
        set({
          queue,
          index,
          positionSec,
          durationSec: queue[index]?.duration ?? 0,
          isPlaying: false,
          queuedCount,
          originalQueue,
          shuffle,
          source,
          sourceHref,
          radioMode,
          radioSeed,
        });
        // Like restoring the saved queue: track loaded, paused.
        await loadIndex(index, false);
        if (positionSec > 0) seekActive(positionSec);
        usePlayerStore.setState({ positionSec, isPlaying: false });
        scheduleSync();
      })();
    };
  },

  rateSong: (id, rating) => {
    const patch = (list: Song[]) =>
      list.map((s) => (s.id === id ? { ...s, userRating: rating } : s));
    const { queue, originalQueue } = get();
    set({
      queue: patch(queue),
      originalQueue: originalQueue ? patch(originalQueue) : null,
    });
    // Reflect the rating in already-loaded lists (album, playlist, favorites,
    // search): all expose `songs: Song[]`. Optimistic patch in the React Query
    // cache so the change is visible instantly without re-requesting from server.
    queryClient.setQueriesData({ predicate: () => true }, (data: unknown) => {
      if (!data || typeof data !== 'object') return data;
      const songs = (data as { songs?: Song[] }).songs;
      if (!Array.isArray(songs) || !songs.some((s) => s.id === id)) return data;
      return { ...data, songs: patch(songs) };
    });
  },

  moveTrack: async (from, to) => {
    const { queue, index, queuedCount } = get();
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= queue.length ||
      to >= queue.length
    ) {
      return;
    }
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // Re-position the current index so it keeps pointing to the same song.
    let newIndex = index;
    if (from === index) newIndex = to;
    else if (from < index && to >= index) newIndex = index - 1;
    else if (from > index && to <= index) newIndex = index + 1;
    // The "queued" block (index+1..index+queuedCount) is preserved when
    // reordering within what's coming: if a source one enters the queue zone it
    // becomes queued, and if a queued one leaves it stops being (Spotify-style).
    // Any move that touches the current song or what's already played dissolves
    // the block.
    let newQueuedCount = 0;
    if (from > index && to > index) {
      const fromQueued = from - (index + 1) < queuedCount;
      const toQueued = to - (index + 1) < queuedCount;
      newQueuedCount = Math.max(
        0,
        queuedCount + (!fromQueued && toQueued ? 1 : 0) - (fromQueued && !toQueued ? 1 : 0),
      );
    }
    set({ queue: next, index: newIndex, queuedCount: newQueuedCount });
    scheduleSync();
  },

  toggleShuffle: () => {
    const { shuffle, queue, index, originalQueue, source, sourceHref } = get();
    const current = queue[index];
    const upnpActive = remoteKind() === 'upnp';
    // Same reasoning as starting a list again (see `forgetHistoryOf`): the
    // order changes under the list being played, so where the back history had
    // you in it no longer means anything. Left in, ⏮️ restored one of those
    // positions along with the shuffle it was taken with, which turned the
    // button you had just pressed back off by itself.
    const key = contextKey(source, sourceHref);
    if (key) forgetHistoryOf(key);

    if (!shuffle) {
      const rest = dealt(queue.filter((_, i) => i !== index));
      // Both marks come off with the shuffle, the same as the "queued" block
      // does and for the same reason: they name blocks (the mix at the end, the
      // added songs after the current one) and there are no blocks left in
      // here. Left on, their songs would be scattered among the album's and the
      // header would have flipped on every track. `originalQueue` keeps the
      // marked copies, so turning shuffle off brings them back with them.
      if (upnpActive && current) {
        // While UPnP is active, keep the current track index stable and only
        // shuffle upcoming tracks. This keeps Sonos and app queue indices aligned.
        const preservedHead = queue.slice(0, index + 1);
        const shuffledTail = dealt(queue.slice(index + 1));
        set({
          shuffle: true,
          queueDealt: true,
          originalQueue: queue,
          queue: [...preservedHead, ...shuffledTail].map(unmarked),
          index,
          queuedCount: 0,
        });
      } else {
        const newQueue = (current ? [current, ...rest] : rest).map(unmarked);
        // The current song keeps playing; we only reorder and leave it at index 0.
        // Shuffling dissolves the "queued" block (the positions no longer exist).
        set({
          shuffle: true,
          queueDealt: true,
          originalQueue: queue,
          queue: newQueue,
          index: 0,
          queuedCount: 0,
        });
      }
    } else if (originalQueue && current) {
      const newIndex = Math.max(0, originalQueue.findIndex((s) => s.id === current.id));
      set({
        shuffle: false,
        queueDealt: false,
        queue: originalQueue,
        index: newIndex,
        originalQueue: null,
        queuedCount: 0,
      });
    } else {
      set({ shuffle: false, queueDealt: false, originalQueue: null, queuedCount: 0 });
    }
    scheduleSync();
  },

  cycleRepeat: () => {
    // First tap: repeat current song ('one'); second: whole queue ('all');
    // third: off. Like Feishin.
    const order: RepeatMode[] = ['off', 'one', 'all'];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat });
    applyLoop(activePlayer());
    // It travels with the queue now, so it is written down like the rest of it
    // instead of waiting for the next thing that happens to save.
    scheduleSync();
  },

  setSleepTimer: (minutes) => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = setTimeout(fireSleepTimer, minutes * 60_000);
    armSleepFade(minutes * 60_000);
    if (remoteKind() === 'upnp') void upnpSetSleepTimer(minutes * 60);
    set({ sleepEndsAt: Date.now() + minutes * 60_000, sleepAtSongEnd: false });
  },

  setSleepAtSongEnd: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    // No fade: the song ends on its own, and fading its end would ruin exactly
    // what was asked to be heard in full.
    abortSleepFade();
    if (remoteKind() === 'upnp') void upnpSetSleepTimer(null);
    set({ sleepEndsAt: null, sleepAtSongEnd: true });
  },

  cancelSleepTimer: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    abortSleepFade();
    if (remoteKind() === 'upnp') void upnpSetSleepTimer(null);
    set({ sleepEndsAt: null, sleepAtSongEnd: false });
  },

  restoreFromServer: async () => {
    const { auth, offline } = useAuthStore.getState();
    if (!auth || offline || get().queue.length > 0) return;
    let saved;
    try {
      saved = await getPlayQueue(auth);
    } catch {
      return;
    }
    if (!saved || saved.entries.length === 0) return;
    const songs = saved.entries;
    const index = saved.current
      ? Math.max(0, songs.findIndex((s) => s.id === saved.current))
      : 0;
    const positionSec = (saved.position ?? 0) / 1000;
    // If something already started playing in the meantime, don't override the queue.
    if (get().queue.length > 0) return;
    attachAppState();
    set({
      queue: songs,
      index,
      positionSec,
      durationSec: songs[index]?.duration ?? 0,
      isPlaying: false,
      source: null,
      sourceHref: null,
      // The server queue is pure Subsonic: it has no place to carry this, so
      // a radio recovered from there stops being one. The local copy does save
      // it, and it's tried first (see `restoreQueue`). Same for a queue that
      // was dealt: what comes back is an order, with nothing to say it was one.
      radioMode: false,
      radioSeed: null,
      queueDealt: false,
    });
    // Load the track (without playing) and leave the position ready.
    await loadIndex(index, false);
    // A tap that landed while this was loading owns the player now (`loadToken`
    // saw to that). What is left here belongs to the queue being restored, and
    // running it against another one would drop somebody else's song at the
    // position this one was left at, paused.
    if (get().queue !== songs) return;
    if (positionSec > 0) seekActive(positionSec);
    usePlayerStore.setState({ positionSec, isPlaying: false });
  },

  restoreFromStorage: async () => {
    const key = queueStorageKey();
    if (!key || get().queue.length > 0) return true;
    let saved: StoredQueue | null = null;
    try {
      const raw = await getItem(key);
      saved = raw ? (JSON.parse(raw) as StoredQueue) : null;
    } catch {
      return false;
    }
    if (!saved || !Array.isArray(saved.queue)) return false;
    // Saved empty queue = the user emptied it on purpose: nothing to
    // restore, but the server backup should also not enter. How they were
    // listening does come back: it outlived the queue while the app was open,
    // and there is no reason for it to stop doing so because the app was
    // closed.
    if (saved.queue.length === 0) {
      set({
        shuffle: saved.shuffle === true,
        queueDealt: false,
        repeat: isRepeatMode(saved.repeat) ? saved.repeat : 'off',
      });
      return true;
    }
    // If something already started playing in the meantime, don't override the queue.
    if (get().queue.length > 0) return true;
    const index = Math.min(Math.max(0, saved.index ?? 0), saved.queue.length - 1);
    const positionSec =
      typeof saved.positionSec === 'number' && Number.isFinite(saved.positionSec)
        ? Math.max(0, saved.positionSec)
        : 0;
    attachAppState();
    set({
      queue: saved.queue,
      index,
      positionSec,
      durationSec: saved.queue[index]?.duration ?? 0,
      isPlaying: false,
      // Restored like `radioMode`: without this the "playing from" header
      // vanished once Android killed the app in the background and the queue
      // came back from disk.
      source: typeof saved.source === 'string' ? saved.source : null,
      sourceHref: typeof saved.sourceHref === 'string' ? saved.sourceHref : null,
      // If it was a radio, it still is: closing the app should not leave it
      // silent when reaching the end of what was already queued.
      radioMode: saved.radioMode === true,
      radioSeed: saved.radioSeed ?? null,
      // The queue was saved already shuffled, so this only restores the button:
      // nothing is reordered on the way back in. `originalQueue` stays null
      // (see `StoredQueue`), which turning shuffle off handles on its own.
      shuffle: saved.shuffle === true,
      queueDealt: saved.dealt === true,
      repeat: isRepeatMode(saved.repeat) ? saved.repeat : 'off',
    });
    await loadIndex(index, false);
    // Same as the server restore above: only if this queue is still the one.
    if (get().queue !== saved.queue) return true;
    if (positionSec > 0) seekActive(positionSec);
    usePlayerStore.setState({ positionSec, isPlaying: false });
    return true;
  },

  restoreQueue: async () => {
    // Everything speculative stays out of the way until the app is up (see
    // `startBootQuiet`): what comes back here is a queue nobody has asked to
    // hear yet.
    startBootQuiet();
    // The local copy is the most faithful (includes downloads, radios and
    // offline mode); the server one is a backup for fresh sessions —
    // except when the local copy says the queue was emptied on purpose.
    //
    // Timed as one: it reads the saved queue out of SecureStore, up to five
    // hundred songs of it, and loads its track into the player. That is the
    // last thing the opening waits for.
    await timed('boot queue', async () => {
      const handled = await get().restoreFromStorage();
      if (!handled && get().queue.length === 0) await get().restoreFromServer();
    });
  },

  reloadCurrent: () => {
    const { queue, index, positionSec, isPlaying } = get();
    const song = queue[index];
    // Radio (own url) and anything playing from disk sound the same whatever
    // the server URL is, so there is nothing to reload against a new one.
    if (!song || song.url || localSourceFor(song)) return;
    // Cast (UPnP) carries its own session; don't touch it.
    if (remoteKind()) return;
    // Paused, there's no audio to preserve: abrupt reload, simpler and safer.
    // Playing, seamless handoff against the new host (see `handoffToNewSource`).
    if (isPlaying) handoffToNewSource(index, song, positionSec);
    else hardReload(index, positionSec, false);
  },

  reset: async (forProfile = false) => {
    get().cancelSleepTimer();
    autoplayFetchedFor = null;
    autoplayRound = null;
    artistFill = null;
    similarArtistsCache = null;
    stopPeriodicSync();
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    // On reset (profile change/exit) the remote output is cut without
    // resuming locally: the queue is going away anyway.
    if (remoteKind() === 'upnp') void upnpDisconnect(true);
    else if (remoteKind() === 'jukebox') void jukeboxDisconnect(true);
    cutCrossfade();
    try {
      activePlayer()?.pause();
    } catch {
      // ignore
    }
    clearLockScreen();
    playedHistory = [];
    setStreamOffset(0);
    sourceHasLength = null;
    scrobbledThisTrack = false;
    // timeOffset support is per server: re-check on change. The one in flight
    // goes with it, or the next profile would be handed this one's answer.
    transcodeOffsetSupported = null;
    transcodeOffsetAsking = null;
    // What failed to play belonged to the queue that is going away, and song
    // ids are only unique within the account that issued them.
    failedSource.clear();
    errorTrackId = null;
    errorAttempts = 0;
    set({
      queue: [],
      index: 0,
      queuedCount: 0,
      isPlaying: false,
      isBuffering: false,
      positionSec: 0,
      durationSec: 0,
      // Shuffle and repeat are how somebody listens, not something a queue
      // owns, and they already survive closing the app (#102). Emptying the
      // queue is a smaller event than that, so it cannot be the one that
      // forgets them: holding Play to clear was turning both off, and turning
      // them back on by hand afterwards is exactly the chore #102 was about.
      // Changing account is the real exception, since the mode being restored
      // belongs with the other profile's queue.
      // The speed goes with them, and for the same reason: it is about
      // listening, not about this queue. It does not outlive the run either
      // way (see `speed`).
      ...(forProfile ? { shuffle: false, repeat: 'off' as const, speed: 1 } : {}),
      // Not one of those two: this is about the queue that is going away, not
      // about how somebody listens.
      queueDealt: false,
      originalQueue: null,
      source: null,
      sourceHref: null,
      radioMode: false,
      radioSeed: null,
    });
    // After the `set`, not before: emptying the queue is what sends the
    // "stopped" from the subscription below, and it needs the answer this
    // profile already gave. Support is per server, so the next account asks
    // again.
    playbackReportSupported = null;
    playbackReportAsking = null;
  },
}));

// Gapless: what comes next changes with the queue, the position in it, the
// repeat mode and the "stop at end of song" timer. Watching the store beats
// hooking every action that touches them (add to queue, reorder, remove,
// shuffle, autoplay…), where the queued track would go stale by omission.
usePlayerStore.subscribe((st, prev) => {
  if (
    st.queue !== prev.queue ||
    st.index !== prev.index ||
    st.repeat !== prev.repeat ||
    st.sleepAtSongEnd !== prev.sleepAtSongEnd
  ) {
    scheduleNextSource();
    // What is coming has moved, so the warming window has too. Queueing the
    // next source is not this: that hands the track to the player, which
    // decides for itself when to start buffering it, and it does so near the
    // end of the one playing. This is the request that reaches the server now,
    // which is the point on a proxy that has to fetch the file from somewhere
    // else first. Cheap when nothing changed: it is off unless asked for, and
    // it remembers what it has already warmed.
    warmUpcoming();
  }
  // Pausing, resuming and stopping, told to the server (see `reportState`).
  // Watching the store is what makes this cover every way playback stops: the
  // button, the notification, the headphones, the sleep timer, the car, and the
  // long press on Play that empties the queue. Hooking the actions instead left
  // whichever one was added last reporting nothing.
  if (st.queue.length === 0 && prev.queue.length > 0) {
    // The queue emptied: that is over, not paused. Read from `prev`, since
    // there is no longer a song here to name.
    reportState('stopped', prev.queue[prev.index], prev.positionSec);
  } else if (st.isPlaying !== prev.isPlaying) {
    reportState(st.isPlaying ? 'playing' : 'paused', st.queue[st.index], st.positionSec);
  }
  // What the saved queue holds, position aside (see `queueDirty`).
  if (
    st.queue !== prev.queue ||
    st.index !== prev.index ||
    st.source !== prev.source ||
    st.sourceHref !== prev.sourceHref ||
    st.radioMode !== prev.radioMode ||
    st.radioSeed !== prev.radioSeed ||
    st.shuffle !== prev.shuffle ||
    st.repeat !== prev.repeat
  ) {
    queueDirty = true;
  }
});
