/**
 * Integration with UPnP/DLNA renderers (native module modules/upnp-cast).
 *
 * The player store remains the UI/source-of-truth queue. While connected to an
 * ordinary renderer, a native copy owns transport progression so Android can
 * continue between tracks while JS is suspended. Sonos keeps using its native
 * renderer-side queue.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { create } from 'zustand';

import { coverArtUrl as serverCoverArtUrl, streamUrl, type Song } from '@/api/backend';
import { COVER } from '@/api/data';
import { transcodeTarget } from '@/lib/audioQuality';
import { localFileUrl, publishLocalFiles, stopLocalHttp } from '@/lib/localHttp';
import { localCoverUrl } from '@/lib/localLibrary';
import { note } from '@/lib/perfLog';
import { useAuthStore } from './auth';
import { castStop } from './castMedia';
import { useSettings } from './settings';

/** Events the player registers to react to remote output (UPnP). */
export interface RemoteEvents {
  /** Session started: transfer the current track to the renderer. */
  onConnected: () => void;
  /** Session ended: return to the local player at this position. */
  onDisconnected: (lastPositionSec: number) => void;
  /**
   * The renderer went away (stopped answering) or another app took it over.
   * Said just before the disconnect that follows, so the player can tell why.
   */
  onLost?: (reason: 'unreachable' | 'replaced', deviceName: string) => void;
  /**
   * Renderer advanced to a different track in its queue. `id` is the song it
   * plays, when the native side knows it: the index alone can point at the
   * wrong song in a queue reordered since the native copy was synced.
   */
  onTrackChanged: (index: number, positionSec: number, durationSec: number, id?: string) => void;
  onProgress: (positionSec: number, durationSec: number) => void;
  onPlayingChanged: (isPlaying: boolean, isBuffering: boolean) => void;
  onRepeatChanged?: (repeat: 'off' | 'all' | 'one') => void;
  onVolumeChanged?: (volume: number) => void;
  /** Track finished naturally on the renderer. */
  onFinished: () => void;
}

export interface UpnpDevice {
  id: string;
  name: string;
  address: string;
  isTV: boolean;
  isSonos?: boolean;
  groupId?: string | null;
  coordinatorId?: string | null;
}

interface UpnpStoreState {
  connected: boolean;
  deviceId: string | null;
  /** Renderers found in the last search. */
  devices: UpnpDevice[];
  scanning: boolean;
}

export const useUpnp = create<UpnpStoreState>(() => ({
  connected: false,
  deviceId: null,
  devices: [],
  scanning: false,
}));

interface NativeState {
  playbackState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED' | 'BUFFERING' | 'ERROR';
  positionMs: number;
  durationMs: number;
  trackNumber?: number;
  playMode?: string;
  nativeQueueManaged?: boolean;
  /** Authoritative zero-based index for a native-managed ordinary renderer. */
  queueIndex?: number;
  /** The id of the song at `queueIndex`, for a native-managed ordinary renderer. */
  trackId?: string;
  volume?: number;
  /** False while the renderer is not answering (the session may yet be lost). */
  reachable?: boolean;
}

const native = requireOptionalNativeModule('UpnpCast');

export const upnpAvailable = !!native;

let events: RemoteEvents | null = null;
let stateSub: { remove: () => void } | undefined;
let lostSub: { remove: () => void } | undefined;
let noteSub: { remove: () => void } | undefined;
let lastPositionSec = 0;
let lastDurationSec = 0;
/** Prevents advancing the queue twice for the same track end. */
let finishedFired = false;
/** Ignores transient STOPPED while the renderer loads another track. */
let loading = false;
/** We have seen PLAYING since the last load/pause (to infer the end). */
let wasPlaying = false;
/** We requested the pause ourselves: a STOPPED after this is not a track end. */
let pausedByUs = false;
let lastNativeTrackNumber = 0;
let lastNativeQueueIndex = -1;
let lastNativeTrackId: string | undefined;
let lastRemoteRepeat: 'off' | 'all' | 'one' | null = null;

interface CachedDevice {
  device: UpnpDevice;
  expiresAtMs: number;
}

const discoveredDeviceCache = new Map<string, CachedDevice>();
const DEFAULT_DEVICE_CACHE_TTL_MS = 15_000;
let deviceCacheTtlMs = DEFAULT_DEVICE_CACHE_TTL_MS;

export function isUpnpConnected(): boolean {
  return useUpnp.getState().connected;
}

function currentUpnpDevice(): UpnpDevice | null {
  const state = useUpnp.getState();
  return state.deviceId ? state.devices.find((device) => device.id === state.deviceId) ?? null : null;
}

/** Registers player events. Call only once (from the player). */
export function initUpnp(ev: RemoteEvents): void {
  events = ev;
}

function repeatForPlayMode(playMode?: string): 'off' | 'all' | 'one' | null {
  if (!playMode) return null;
  const normalized = playMode.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.includes('REPEAT_ONE')) return 'one';
  if (normalized === 'REPEAT_ALL' || normalized === 'SHUFFLE') return 'all';
  if (normalized === 'NORMAL' || normalized === 'SHUFFLE_NOREPEAT') return 'off';
  return null;
}

function onNativeState(e: NativeState) {
  if (!isUpnpConnected()) return;
  // Not answering: the clock is not to be read, and the player shows it is
  // waiting on something. Either it comes back or the session is lost.
  if (e.reachable === false) {
    events?.onPlayingChanged(true, true);
    return;
  }
  if (e.volume != null && e.volume >= 0) {
    events?.onVolumeChanged?.(e.volume / 100);
  }
  // A queue kept natively repeats by what the app told it. The renderer's own
  // mode is not ours to follow: taken as the app's, a renderer saying REPEAT_ONE
  // held the queue on one track (#285).
  const repeat = e.nativeQueueManaged ? null : repeatForPlayMode(e.playMode);
  if (repeat != null && repeat !== lastRemoteRepeat) {
    lastRemoteRepeat = repeat;
    events?.onRepeatChanged?.(repeat);
  }
  const pos = (e.positionMs ?? 0) / 1000;
  const dur = (e.durationMs ?? 0) / 1000;
  const trackNumber = Math.floor(e.trackNumber ?? 0);
  const nativeQueueIndex = Math.floor(e.queueIndex ?? -1);
  if (pos > 0) lastPositionSec = pos;
  if (dur > 0) lastDurationSec = dur;
  if (e.nativeQueueManaged && nativeQueueIndex >= 0) {
    // Followed by the song's id when there is one: a queue reordered here
    // (shuffle) keeps the native copy's index pointing at another song until
    // the next sync, and following the index put the wrong one on screen.
    const trackId = e.trackId || undefined;
    const changed = trackId ? trackId !== lastNativeTrackId : nativeQueueIndex !== lastNativeQueueIndex;
    lastNativeQueueIndex = nativeQueueIndex;
    lastNativeTrackId = trackId;
    if (changed && !loading) {
      events?.onTrackChanged(nativeQueueIndex, pos, dur || lastDurationSec, trackId);
    }
  } else if (trackNumber > 0) {
    const changed = trackNumber !== lastNativeTrackNumber;
    lastNativeTrackNumber = trackNumber;
    if (changed && !loading) {
      events?.onTrackChanged(trackNumber - 1, pos, dur || lastDurationSec);
    }
  }
  switch (e.playbackState) {
    case 'PLAYING':
      // A change swallowed while loading (the renderer moving on by itself
      // just then) is looked at again with the next event; the player
      // ignores it when it is the song already on screen.
      if (loading) lastNativeTrackId = undefined;
      loading = false;
      finishedFired = false;
      wasPlaying = true;
      pausedByUs = false;
      events?.onProgress(pos, dur || lastDurationSec);
      events?.onPlayingChanged(true, false);
      break;
    case 'BUFFERING':
      events?.onPlayingChanged(true, true);
      break;
    case 'PAUSED':
      wasPlaying = false;
      events?.onProgress(pos, dur || lastDurationSec);
      events?.onPlayingChanged(false, false);
      break;
    case 'STOPPED':
    case 'IDLE':
      // The native queue only says STOPPED once it has made up its mind: a
      // stop halfway by nobody here, or the end of the queue. Between tracks
      // it says BUFFERING. Shown as paused, so the screen is not left playing
      // a clock that has stopped (#285); Play picks it up again.
      if (e.nativeQueueManaged) {
        if (!loading) events?.onPlayingChanged(false, false);
        break;
      }
      // UPnP doesn't distinguish "ended" from "stopped": we infer a natural end
      // from a STOPPED that arrives after having been playing (not a pause we
      // requested). Wide window towards the end (10% of track, min 5 s):
      // polling is 1 s and some renderers stop reporting position in the last
      // seconds, so a fixed 3 s threshold was too tight and the queue wouldn't
      // advance. Without known duration, we trust we were playing (better to
      // advance than to get stuck).
      if (!e.nativeQueueManaged && !finishedFired && !loading && wasPlaying && !pausedByUs) {
        const window = Math.max(5, lastDurationSec * 0.1);
        const nearEnd = lastDurationSec <= 0 || lastPositionSec >= lastDurationSec - window;
        if (nearEnd) {
          finishedFired = true;
          wasPlaying = false;
          events?.onFinished();
        }
      }
      break;
    default:
      break;
  }
}

/**
 * Searches for renderers on the network (~5 s) and refreshes the visible list.
 *
 * Devices that are seen are updated immediately. Devices that are missed on one
 * round stay visible until the cache TTL expires, which smooths over SSDP loss
 * while still eventually removing stale entries.
 */
/** A name the library made up out of the address, not the device's own. */
function looksRaw(name: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}\b/.test(name.trim());
}

/**
 * One row per address, keeping the friendliest name.
 *
 * Sonos answers discovery more than once and the library names each answer
 * differently: the room ("Schlafzimmer") in one, "<ip> - Sonos Play:1 -
 * RINCON…" in another. That's two rows for one speaker, and the unreadable one
 * is as likely to be tapped as the good one.
 */
function dedupeDevices(devices: UpnpDevice[]): UpnpDevice[] {
  const byAddress = new Map<string, UpnpDevice>();
  for (const d of devices) {
    const key = d.address || d.id;
    const kept = byAddress.get(key);
    if (!kept || (looksRaw(kept.name) && !looksRaw(d.name))) byAddress.set(key, d);
  }
  return Array.from(byAddress.values());
}

export async function upnpSearch(): Promise<void> {
  if (!native || useUpnp.getState().scanning) return;
  useUpnp.setState({ scanning: true });
  try {
    const now = Date.now();
    const found = dedupeDevices((await native.search(5000)) as UpnpDevice[]);
    const seen = new Set<string>();

    for (const device of found) {
      seen.add(device.id);
      discoveredDeviceCache.set(device.id, {
        device,
        expiresAtMs: now + deviceCacheTtlMs,
      });
    }

    for (const [id, cached] of discoveredDeviceCache) {
      if (!seen.has(id) && cached.expiresAtMs <= now) discoveredDeviceCache.delete(id);
    }

    const visible = dedupeDevices(Array.from(discoveredDeviceCache.values()).map((v) => v.device));
    useUpnp.setState({
      devices: visible,
    });
  } catch {
    // keep the previous list
  } finally {
    useUpnp.setState({ scanning: false });
  }
}

export async function upnpConnect(device: UpnpDevice): Promise<boolean> {
  if (!native) return false;
  const current = useUpnp.getState();
  // Remote-to-remote handoff: stop the previous renderer first so playback
  // doesn't continue there while the new device takes over.
  if (current.connected && current.deviceId && current.deviceId !== device.id) {
    await upnpDisconnect(true);
  }
  const ok = (await native.connect(device.id)) as boolean;
  if (!ok) return false;
  lastPositionSec = 0;
  lastDurationSec = 0;
  lastNativeTrackNumber = 0;
  lastNativeQueueIndex = -1;
  lastNativeTrackId = undefined;
  lastRemoteRepeat = null;
  finishedFired = false;
  wasPlaying = false;
  pausedByUs = false;
  stateSub?.remove();
  stateSub = native.addListener('state', onNativeState);
  lostSub?.remove();
  lostSub = native.addListener('lost', onNativeLost);
  noteSub?.remove();
  noteSub = native.addListener('note', (e: { text: string }) => note(`cast: ${e.text}`));
  useUpnp.setState({ connected: true, deviceId: device.id });
  try {
    const initialVol = (await native.getVolume()) as number;
    if (typeof initialVol === 'number' && initialVol >= 0) {
      events?.onVolumeChanged?.(initialVol / 100);
    }
  } catch {
    // ignore
  }
  events?.onConnected();
  return true;
}

/**
 * The native side gave the session up: the renderer stopped answering for long
 * enough, or another app is playing on it (#285). It has already let go of it,
 * so this only brings playback back to the phone, saying why.
 */
function onNativeLost(e: { reason: string }) {
  if (!isUpnpConnected()) return;
  const reason = e.reason === 'replaced' ? 'replaced' : 'unreachable';
  const name = currentUpnpDevice()?.name ?? '';
  note(`cast lost (${reason}) on ${name || '?'}`);
  events?.onLost?.(reason, name);
  void upnpDisconnect();
}

/** Cuts the session; with silent it doesn't notify the player (e.g. when switching to cast). */
export async function upnpDisconnect(silent = false): Promise<void> {
  if (!isUpnpConnected()) return;
  const disconnectedAtSec = lastPositionSec;
  stateSub?.remove();
  stateSub = undefined;
  lostSub?.remove();
  lostSub = undefined;
  noteSub?.remove();
  noteSub = undefined;
  // Closes the casting media session on any disconnect path
  // (including silent ones: output switch, reset), not just the normal one.
  castStop();
  // And the port with it: it is only ever open for a renderer that is listening,
  // and this is the moment there is none.
  void stopLocalHttp();
  useUpnp.setState({ connected: false, deviceId: null });
  lastNativeTrackNumber = 0;
  lastNativeQueueIndex = -1;
  lastNativeTrackId = undefined;
  lastRemoteRepeat = null;
  lastPositionSec = 0;
  lastDurationSec = 0;
  try {
    await native?.disconnect();
  } catch {
    // ignore
  }
  if (!silent) events?.onDisconnected(disconnectedAtSec);
}

function firstNonBlank(...values: (string | undefined | null)[]): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

function buildUpnpTrackInfo(song: Song) {
  const auth = useAuthStore.getState().auth;
  const listedArtists = firstNonBlank(song.artists?.map((a) => a.name).filter(Boolean).join(', '));
  const listedAlbumArtists = firstNonBlank(song.albumArtists?.map((a) => a.name).filter(Boolean).join(', '));
  // The picture comes from wherever the song does, and by the same test: a
  // cover on the server is no use to a renderer being handed a file off this
  // phone, which is what a download casts as with the server out of reach.
  // The phone's own copy goes out through the same door as the audio, and
  // `localFilesOf` opens it under exactly this condition — the two have to
  // agree or the URL points at something nobody published.
  const cover = song.albumId ?? song.coverArt;
  const artworkUrl = servedByPhone(song)
    ? localFileUrl(localCoverUrl(cover))
    : auth
      ? serverCoverArtUrl(auth, cover, COVER.card)
      : undefined;
  return {
    title: song.title,
    artist: firstNonBlank(song.artist, listedArtists, listedAlbumArtists),
    albumArtist: listedAlbumArtists,
    album: firstNonBlank(song.album),
    artworkUrl,
    durationSec: song.duration ?? 0,
  };
}

/**
 * The server's own address for a song, when the server is the one that can
 * serve it: an account, and a connection to reach it through.
 *
 * Preferred over the phone even for a song that is downloaded. The renderer
 * fetches for itself, so a URL on the server is one this phone does not have to
 * stay awake to answer.
 */
function serverStreamUrl(song: Song): string | undefined {
  const { auth, offline } = useAuthStore.getState();
  if (!auth || offline || song.url) return undefined;
  const { bitRate, format } = castTarget(song);
  return streamUrl(auth, song.id, bitRate, 0, format);
}

/** The Wi-Fi quality settings, which are the ones a renderer on the LAN uses. */
function castTarget(song: Song): { bitRate: number; format: string } {
  const s = useSettings.getState();
  return transcodeTarget(song, s.maxBitRate, s.streamFormat, s.streamLosslessOnly);
}

/**
 * Is this phone the one that will be answering for this song?
 *
 * The same question `buildUpnpTrackUrl` ends up asking, in one place because
 * two things depend on the answer and they must not drift: what gets published
 * to the network, and whether the cover named in the DIDL is the phone's or the
 * server's. A station brings its own address and its own picture, and neither
 * is anything to do with this.
 */
function servedByPhone(song: Song): boolean {
  return !song.url && !!song.localUri && !serverStreamUrl(song);
}

/**
 * Where the renderer should go for this song.
 *
 * A radio brings its own address. A server account online hands over the
 * server's. What is left is a file on this phone — the local profile's music,
 * or a download with the server out of reach — and that is what the phone's own
 * server is for.
 *
 * It used to end here, at `undefined`, for anything with a `localUri`. And one
 * uncastable track was not one silent track: the queue payload is all or
 * nothing (see `buildUpnpQueuePayload`), so a single downloaded song in the
 * queue was a Sonos that played none of it.
 */
function buildUpnpTrackUrl(song: Song): string | undefined {
  if (song.url) return song.url;
  return serverStreamUrl(song) ?? localFileUrl(song.localUri);
}

/** The image mime of a cover this phone wrote, which it named for its format. */
function coverMime(uri: string): string {
  return uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/**
 * The files these songs would need served from the phone: the ones no server
 * can be asked for, and the covers that go with them.
 *
 * Nothing else is published. A renderer can only ask for what is in here, so
 * this is also the whole of what the network can reach.
 */
function localFilesOf(songs: Song[]): { uri: string; mime: string }[] {
  const files: { uri: string; mime: string }[] = [];
  const seen = new Set<string>();
  const add = (uri: string | undefined, mime: string) => {
    if (!uri || seen.has(uri)) return;
    seen.add(uri);
    files.push({ uri, mime });
  };
  for (const song of songs) {
    if (!servedByPhone(song)) continue;
    add(song.localUri, castMime(song));
    const cover = localCoverUrl(song.albumId ?? song.coverArt);
    if (cover) add(cover, coverMime(cover));
  }
  return files;
}

/**
 * Opens the phone's server and publishes what this load will need, before any
 * URL is built: `localFileUrl` answers out of what has been published, so the
 * order is the whole of it.
 */
async function ensureLocalFilesServed(songs: Song[]): Promise<void> {
  const files = localFilesOf(songs);
  if (files.length === 0) return;
  await publishLocalFiles(files);
}

function buildUpnpQueuePayload(queue: Song[]) {
  const tracks = queue.map((song) => {
    const url = buildUpnpTrackUrl(song);
    if (!url) return null;
    const info = buildUpnpTrackInfo(song);
    return { id: song.id, url, mime: castMime(song, transcodedTo(song)), ...info };
  });
  if (tracks.some((track) => track == null)) return null;
  return tracks as (ReturnType<typeof buildUpnpTrackInfo> & { id: string; url: string; mime: string })[];
}

/**
 * What the file will have been turned into by the time it arrives, which is
 * only ever something the SERVER does on the way out.
 *
 * A file coming off this phone is served exactly as it lies on disk, so the
 * transcoding settings have nothing to do with it. Reading them anyway
 * announced a local FLAC as whatever codec the server had been told to send —
 * the type in the DIDL disagreeing with the type the phone then served it as,
 * which is the one thing a renderer is entitled to give up over.
 */
function transcodedTo(song: Song): string | undefined {
  if (!serverStreamUrl(song)) return undefined;
  const { bitRate, format } = castTarget(song);
  return bitRate > 0 ? format : undefined;
}

/**
 * The format of a file on the phone, which is written down nowhere but its own
 * name: the local catalog has no `suffix`, since nothing asked it for one until
 * a speaker did. Without this every local file went out announced as MP3, and a
 * renderer handed a FLAC under that name is entitled to refuse it — which is
 * the same mistake as #70, from the other end.
 */
function localSuffix(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  let path = uri.split('?')[0];
  try {
    // A SAF document id carries the file name percent-encoded inside it.
    path = decodeURIComponent(path);
  } catch {
    // Malformed escapes: the raw form still ends in the extension.
  }
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : undefined;
}

/**
 * What to tell the renderer this track is.
 *
 * A DLNA renderer decides whether it can play something from the type it is
 * handed, and a speaker refuses anything that isn't audio. The stream URL says
 * nothing about the file (`/rest/stream.view?…`), so the type has to come from
 * what we know about the song: what the server was asked to transcode to, or
 * failing that the file's own format — or, for a file on the phone, the only
 * place that ever said (see `localSuffix`).
 */
function castMime(song: Song, transcodedTo?: string): string {
  const suffix = (transcodedTo || song.suffix || localSuffix(song.localUri) || '').toLowerCase();
  switch (suffix) {
    case 'mp3':
      return 'audio/mpeg';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg';
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'wma':
      return 'audio/x-ms-wma';
    case 'aif':
    case 'aiff':
      return 'audio/aiff';
    default:
      // Unknown is still audio, and saying so beats letting it be guessed:
      // guessing is what announced every song as a video and left speakers
      // refusing all of them (#70).
      return 'audio/mpeg';
  }
}

/**
 * Loads a track on the renderer. Returns false if there is no session or the song
 * is not castable (local files: the renderer cannot reach them).
 */
export async function upnpLoad(
  queue: Song[],
  index: number,
  autoplay: boolean,
  startTimeSec = 0,
  playMode: string,
): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  const current = queue[index];
  if (!current) return false;
  loading = true;
  finishedFired = false;
  wasPlaying = false;
  pausedByUs = false;
  lastPositionSec = startTimeSec;
  lastDurationSec = current.duration ?? 0;
  try {
    // Both renderer-side Sonos queues and native-managed ordinary queues need
    // every phone-served URL to remain reachable after JS is suspended.
    const sonos = currentUpnpDevice()?.isSonos;
    await ensureLocalFilesServed(queue);
    const ok = sonos
      ? await loadSonosQueue(queue, index, autoplay, startTimeSec, playMode)
      : await loadGenericUpnpQueue(queue, index, autoplay, startTimeSec, playMode);
    if (ok && startTimeSec > 0) void native.seek(startTimeSec * 1000);
    // Not every renderer starts on its own after being handed a URI: Sonos
    // waits for an explicit Play and otherwise sits silent while the app
    // believes it's playing. Sending it always is harmless — one that already
    // started ignores it — and skipping it left whole devices mute.
    if (ok && autoplay) void native.play();
    // The ones that DO start on their own have to be stopped when we didn't
    // want playback yet.
    if (ok && !autoplay) void native.pause();
    if (!ok) loading = false;
    return ok;
  } catch {
    loading = false;
    return false;
  }
}

export async function upnpSyncQueue(
  queue: Song[],
  index: number,
  startTimeSec = 0,
  playMode: string,
): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  await ensureLocalFilesServed(queue);
  const payload = buildUpnpQueuePayload(queue);
  if (!payload) return false;
  try {
    return (await native.syncQueue(
      JSON.stringify({
        tracks: payload,
        currentIndex: index,
        positionMs: startTimeSec * 1000,
        playMode,
      }),
    )) as boolean;
  } catch {
    return false;
  }
}

export async function upnpSetPlayMode(playMode: string): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  try {
    return (await native.setPlayMode(playMode)) as boolean;
  } catch {
    return false;
  }
}

export async function upnpSetCrossfade(enabled: boolean): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  if (!currentUpnpDevice()?.isSonos) return true;
  try {
    return (await native.setCrossfadeMode(enabled)) as boolean;
  } catch {
    return false;
  }
}

export async function upnpSetSleepTimer(durationSec: number | null): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  if (!currentUpnpDevice()?.isSonos) return true;
  const seconds = Math.max(0, Math.round(durationSec ?? 0));
  try {
    return (await native.setSleepTimer(seconds)) as boolean;
  } catch {
    return false;
  }
}

async function loadSonosQueue(
  queue: Song[],
  index: number,
  autoplay: boolean,
  startTimeSec: number,
  playMode: string,
): Promise<boolean> {
  const payload = buildUpnpQueuePayload(queue);
  if (!payload) return false;
  return (await native.loadQueue(
    JSON.stringify({
      tracks: payload,
      currentIndex: index,
      autoplay,
      positionMs: startTimeSec * 1000,
      playMode,
    }),
  )) as boolean;
}

/** Bitrate for the MP3 fallback below when streaming at original quality: a
 *  lossless track has no bitrate to inherit, and 320 is as good as MP3 gets. */
const CAST_MP3_BITRATE = 320;

async function loadGenericUpnpQueue(
  queue: Song[],
  index: number,
  autoplay: boolean,
  startTimeSec: number,
  playMode: string,
): Promise<boolean> {
  const payload = buildUpnpQueuePayload(queue);
  if (!payload) return false;
  const load = (tracks: typeof payload) => native.loadQueue(JSON.stringify({
    tracks,
    currentIndex: index,
    autoplay,
    positionMs: startTimeSec * 1000,
    playMode,
  })) as Promise<boolean>;
  let ok = await load(payload);
  // Preserve the existing format fallback without throwing away the native
  // queue: replace only the selected URI and submit the complete queue again.
  if (!ok) {
    const mp3Url = mp3StreamUrl(queue[index]);
    if (mp3Url && mp3Url !== payload[index]?.url) {
      const fallback = [...payload];
      fallback[index] = { ...fallback[index], url: mp3Url, mime: 'audio/mpeg' };
      ok = await load(fallback);
    }
  }
  return ok;
}

/** The same song asked for as MP3, or undefined when the server isn't the one
 *  serving it — a file coming off this phone, or a URL of its own. Asked the
 *  same way `serverStreamUrl` asks it, since this is the second attempt at
 *  exactly that URL. */
function mp3StreamUrl(song: Song): string | undefined {
  const { auth, offline } = useAuthStore.getState();
  if (!auth || offline || song.url || !serverStreamUrl(song)) return undefined;
  const { bitRate } = castTarget(song);
  return streamUrl(
    auth,
    song.id,
    bitRate > 0 ? bitRate : CAST_MP3_BITRATE,
    0,
    'mp3',
  );
}

export async function upnpJoinDevice(deviceId: string, targetDeviceId: string): Promise<boolean> {
  if (!native) return false;
  try {
    return (await native.join(deviceId, targetDeviceId)) as boolean;
  } catch {
    return false;
  }
}

export async function upnpUngroupDevice(deviceId: string): Promise<boolean> {
  if (!native) return false;
  try {
    return (await native.ungroup(deviceId)) as boolean;
  } catch {
    return false;
  }
}

export async function upnpPlay(): Promise<void> {
  pausedByUs = false;
  try {
    await native?.play();
  } catch {
    // ignore
  }
}

export async function upnpPause(): Promise<void> {
  // Marks the pause as ours: if the renderer reports STOPPED instead of
  // PAUSED, we don't confuse it with a track end (the queue wouldn't advance).
  pausedByUs = true;
  try {
    await native?.pause();
  } catch {
    // ignore
  }
}

export async function upnpSeek(sec: number): Promise<void> {
  try {
    await native?.seek(sec * 1000);
  } catch {
    // ignore
  }
}

/** Renderer volume; the app slider goes 0..1 and UPnP uses 0..100. */
export function upnpSetVolume(volume: number): void {
  try {
    void native?.setVolume(Math.round(Math.max(0, Math.min(1, volume)) * 100));
  } catch {
    // ignore
  }
}
