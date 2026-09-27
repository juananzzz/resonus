/**
 * Minimal Subsonic API client (the API exposed by Navidrome).
 *
 * Token-based authentication: each request sends the username (u), a random
 * salt (s), and the token (t = md5(password + salt)). This way the password
 * is never sent in the clear. See https://www.subsonic.org/pages/api.jsp
 */
import * as Crypto from 'expo-crypto';
// Not the global `fetch`. React Native's stops delivering answers once the app
// is in the background: measured at eleven requests sent and none resolved or
// rejected, which is a promise that never settles and a worker that waits for
// it forever. That is the normal state while a song plays with the screen off.
// This one answers there, and honours `AbortSignal` properly with it.
import { fetch } from 'expo/fetch';

import { markAbsentCovers, omitsAbsentCovers } from '@/lib/absentCovers';
import { wordsFromCues } from '@/lib/lyricWords';
import { canonicalId, idWouldChange } from '@/lib/navidromeIds';
import { netTally, timed } from '@/lib/perfLog';
import { assertCanRequest } from './netGate';

export const CLIENT_NAME = 'Resonus';
const API_VERSION = '1.16.1';

export interface SubsonicAuth {
  serverUrl: string;
  username: string;
  /**
   * Candidate URLs for the same server/account (local, domain, Tailscale…),
   * in the order they were added. `serverUrl` is the one currently active. If
   * missing, it defaults to `[serverUrl]`. See `store/autoUrl.ts` for automatic
   * switching.
   */
  urls?: string[];
  /**
   * What this profile is filed under, everywhere it owns something: settings,
   * downloads, queue, history. It is an address because that is what named a
   * profile before addresses could be edited, and it stays whatever it was so
   * that renaming one doesn't hide everything the profile had. Absent on
   * profiles whose addresses were never touched, where `urls[0]` still answers
   * for it. Always read it through `primaryUrl()`.
   */
  scopeUrl?: string;
  /**
   * Switch `serverUrl` alone to the first reachable URL when the network
   * changes (e.g. leaving home: local IP stops responding → Tailscale/domain).
   */
  autoUrl?: boolean;
  /** md5(password + salt) in hexadecimal */
  token: string;
  /** random salt used to generate the token */
  salt: string;
  /** Server type (to show its logo); navidrome/opensubsonic/ampache. */
  serverType?: string;
  /**
   * Cleartext password. Sent as `p=enc:<hex>` (classic Subsonic method)
   * instead of token + salt. Stored when the server doesn't validate token
   * auth properly (Ampache) or when the user forces cleartext auth
   * (`plainAuth`, e.g. proxies/SSO that validate against an external
   * backend). Otherwise not stored (token + salt is used).
   */
  password?: string;
  /**
   * User forced cleartext auth (`p=enc:`) in the profile, for setups
   * (reverse-proxy/LDAP/SSO) that can't validate the salted hash against an
   * external backend. Purely informational; sending in cleartext is decided
   * by `password`.
   */
  plainAuth?: boolean;
  /**
   * Password for the native Navidrome API (JWT), which needs username and
   * cleartext password. Only stored in Navidrome profiles; Subsonic auth
   * still uses token + salt (hence it doesn't reuse `password`).
   */
  ndPassword?: string;
  /**
   * Jellyfin (own API, see `jellyfin.ts`): session token, user id and device
   * id. In these profiles `token`/`salt` are empty.
   */
  jfToken?: string;
  jfUserId?: string;
  jfDeviceId?: string;
}

export interface Song {
  id: string;
  title: string;
  album?: string;
  artist?: string;
  albumId?: string;
  artistId?: string;
  /**
   * List of song artists (OpenSubsonic extension; Navidrome sends it).
   * Allows choosing which artist to navigate to when there are collaborations.
   */
  artists?: { id: string; name: string }[];
  /** Album artist list (OpenSubsonic extension; Navidrome sends it). */
  albumArtists?: { id: string; name: string }[];
  coverArt?: string;
  duration?: number;
  track?: number;
  /** Disc number in multi-disc albums (tracks repeat per disc). */
  discNumber?: number;
  /** Timestamp of when it was starred; absent if not a favorite. */
  starred?: string;
  /** Play count reported by the server (OpenSubsonic). */
  playCount?: number;
  /** User rating (1-5); absent or 0 if not rated. */
  userRating?: number;
  /** Direct streaming URL (used for radio; avoids generating Subsonic URL). */
  url?: string;
  /**
   * That `url` is a finished recording rather than a live stream, so this can be
   * played at another speed. A station arrives in real time and stalls if asked
   * to hurry, but a podcast episode is a file behind an HTTP address: it has a
   * duration and it buffers. Set by `episodeToSong`; absent for radio, which is
   * the one case that must stay at 1×.
   */
  vod?: boolean;
  /** Song genre (sent by Subsonic and Jellyfin). Used by radio so it doesn't
   *  die when similar artist tracks run out. */
  genre?: string;
  /**
   * The file's comment tag (OpenSubsonic; Navidrome sends it). Nothing in the
   * app reads it except the song information sheet, and people keep real notes
   * in there: where a recording came from, why this rip and not the other one.
   * Locally it is read off the file (`id3.ts`), which is the only source a
   * profile with no server has. Asked for in #59.
   */
  comment?: string;
  /** Every genre of the song, where `genre` only carries the first one
   *  (OpenSubsonic; the album has had this for a while). */
  genres?: { name: string }[];
  /** Beats per minute, if the file says so (OpenSubsonic). */
  bpm?: number;
  /** 1 mono, 2 stereo… (OpenSubsonic). */
  channelCount?: number;
  /** MusicBrainz recording id (OpenSubsonic). */
  musicBrainzId?: string;
  /** Recording identifier, the one the industry uses (OpenSubsonic). */
  isrc?: string[];
  /** Moods the server has tagged it with (OpenSubsonic). */
  moods?: string[];
  /**
   * Parental advisory (OpenSubsonic): `"explicit"`, `"clean"` or empty when
   * nothing tagged the file. Navidrome fills it from `ITUNESADVISORY`/`rtng`
   * since 0.54; other servers may not send it at all, which is why the type is
   * a plain string and every reader compares against the value it cares about
   * instead of trusting a union nobody validates.
   */
  explicitStatus?: string;
  /** File format (mp3, flac, aac…). */
  suffix?: string;
  /** Bitrate in kbps. */
  bitRate?: number;
  /** Bitrate (kbps) at which Resonus transcoded on DOWNLOAD, if applicable.
   *  Only set on downloaded transcoded tracks; powers the quality tag
   *  (the on-disk file doesn't carry this info readily). */
  dlBitRate?: number;
  /** Bit depth (16, 24…). */
  bitDepth?: number;
  /** Sample rate in Hz (44100, 48000, 96000…). */
  samplingRate?: number;
  /** Embedded cover art in base64 (offline mode). */
  coverBase64?: string;
  /** MIME type of the embedded cover art (image/jpeg, image/png…). */
  coverMime?: string;
  /**
   * Only during local scanning: the file has an embedded cover but it hasn't
   * been read yet. Discarded when building the catalog.
   */
  hasCover?: boolean;
  /** Local file URI (offline mode); if present, playback happens without server. */
  localUri?: string;
  /** Size on disk of that file, written when it is downloaded. Storage used
   *  adds these up instead of asking the file system once per file. */
  dlBytes?: number;
  /**
   * Marked as unavailable offline: appears in the list (mirror of the server
   * library) but is not downloaded, so it is shown grayed out and cannot be
   * played. Only populated in offline server mode.
   */
  unavailable?: boolean;
  /**
   * Set by the app, never by a server: autoplay put this song in the queue to
   * keep it going after the album or playlist ran out. The player reads it to
   * stop announcing a source that stopped being true (#65). Marked song by
   * song, not as a position, so it survives reordering and comes back with the
   * locally saved queue.
   */
  fromMix?: boolean;
  /**
   * Set by the app, never by a server: this song is in the queue because
   * someone put it there ("add to queue" / "play next"), not because the album
   * or playlist brought it. Marked the same way as `fromMix` and read for the
   * same reason, except that this one is announced only while it plays: what
   * follows still comes from the source, so the source comes back after it.
   */
  queued?: boolean;
  /** Song year (from ID3, offline mode). */
  year?: number;
  /** File modification timestamp in ms (offline mode). */
  addedAt?: number;
  /**
   * ReplayGain tags from the file (OpenSubsonic extension; Navidrome sends
   * them if present). Gains in dB (negative = attenuates), peaks linear.
   */
  replayGain?: {
    trackGain?: number;
    albumGain?: number;
    trackPeak?: number;
    albumPeak?: number;
  };
}

export interface Album {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  /** Album description from the comment tag (OpenSubsonic; Navidrome sends it). */
  comment?: string;
  /** Album artist list (OpenSubsonic extension; Navidrome sends it). */
  artists?: { id: string; name: string }[];
  coverArt?: string;
  songCount?: number;
  year?: number;
  starred?: string;
  /**
   * The day the record came out, not just its year (OpenSubsonic; Navidrome
   * sends both). `year` is all `getAlbumList2` sorts by, so everything released
   * in the same year ties and the server falls back to the album name: this is
   * what puts the newest first (see `releaseValue` in data.ts).
   */
  originalReleaseDate?: { year?: number; month?: number; day?: number };
  /** The day this particular edition came out (OpenSubsonic). Fallback for
   *  `originalReleaseDate` on a record that only carries this one. */
  releaseDate?: { year?: number; month?: number; day?: number };
  /**
   * When it was added to the server. Standard Subsonic; it's what "recently
   * added" is really sorted by, so merging several libraries into one list
   * needs it (see `mergeAlbums` in data.ts).
   */
  created?: string;
  /** Last time this user played it (OpenSubsonic; Navidrome sends it). */
  played?: string;
  /** Times this user has played it (OpenSubsonic). */
  playCount?: number;
  /** Main genre (standard Subsonic: only one). */
  genre?: string;
  /** Every genre of the album (OpenSubsonic; Navidrome sends them). */
  genres?: { name: string }[];
  /** Record labels (OpenSubsonic extension; Navidrome sends them). */
  recordLabels?: { name: string }[];
  /**
   * What kind of release this is (OpenSubsonic; Navidrome fills it from the
   * files' `RELEASETYPE` tag, which is MusicBrainz's).
   *
   * A list, not a word: MusicBrainz separates a primary type (album, single,
   * ep, broadcast, other) from secondaries that can pile on top of it (live,
   * compilation, remix, soundtrack, demo…), so a record can arrive as
   * `["album", "live"]`. Absent on servers that do not send it and on files
   * nobody tagged, and the app shows one undivided discography there rather
   * than guessing (see `lib/releaseGroups`).
   */
  releaseTypes?: string[];
  /** True if the album is a compilation (OpenSubsonic). Says on its own what a
   *  secondary release type would also say, and arrives without the tag. */
  isCompilation?: boolean;
  /**
   * Parental advisory for the record as a whole (OpenSubsonic; same values as
   * the song's). Navidrome works it out from its tracks: one explicit track
   * makes the album explicit, and it only reads as clean when nothing on it is
   * explicit and something on it says so.
   */
  explicitStatus?: string;
  /**
   * Disc titles by number (OpenSubsonic extension; optional). In multi-disc
   * albums allows showing the name of each disc (tag `discsubtitle`);
   * the fallback is "Disc N". May be missing or only include some discs.
   */
  discTitles?: { disc: number; title: string; coverArt?: string }[];
}

/**
 * Album in an artist's "Appears on". `confirmed` means the server named the
 * album's artists and ours wasn't one of them, so it's a participation for
 * certain. Without it we're only guessing from a name search, and the screen
 * falls back to trusting the discography.
 */
export interface GuestAlbum extends Album {
  confirmed: boolean;
}

export interface Artist {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
  starred?: string;
  /**
   * 1-5, absent if never rated. `getArtist` passes the artist element through
   * as it comes, so this only needs declaring to be read: a server that rates
   * artists (Navidrome keeps an annotation per artist, same as for a song)
   * already sends it, and one that does not leaves it undefined and the stars
   * come up empty.
   */
  userRating?: number;
}

export interface Playlist {
  id: string;
  name: string;
  songCount?: number;
  coverArt?: string;
  /** Playlist description. */
  comment?: string;
  /** Visible to other server users. */
  public?: boolean;
  /** Playlist owner ("System" for Ampache stock smartlists). */
  owner?: string;
  /** Creation date (ISO); sent by Navidrome/Subsonic and the local profile. */
  created?: string;
  /** Last modification (ISO). */
  changed?: string;
}

/** Generates a random salt in hexadecimal. */
function randomSalt(): string {
  const bytes = Crypto.getRandomBytes(8);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Ampache doesn't validate token auth properly; needs classic (`p=enc:<hex>`). */
function isAmpache(serverType?: string): boolean {
  return serverType === 'ampache';
}

/** Hex of the UTF-8 bytes of a string, for the Subsonic `enc:` parameter. */
function hexEncodeUtf8(input: string): string {
  let hex = '';
  for (const char of input) {
    const code = char.codePointAt(0)!;
    const bytes: number[] =
      code < 0x80
        ? [code]
        : code < 0x800
          ? [0xc0 | (code >> 6), 0x80 | (code & 0x3f)]
          : code < 0x10000
            ? [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)]
            : [
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
              ];
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Calculates token credentials from the password.
 * Done once at login; salt and token are then reused.
 */
export async function makeAuth(
  serverUrl: string,
  username: string,
  password: string,
  serverType?: string,
  plainAuth?: boolean,
): Promise<SubsonicAuth> {
  const salt = randomSalt();
  const token = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.MD5,
    password + salt,
  );
  // Ampache doesn't validate the token, and the user can force cleartext auth
  // (proxies/SSO): in both cases we store the password to use `p=enc:`.
  const usePlain = isAmpache(serverType) || !!plainAuth;
  return {
    serverUrl: normalizeUrl(serverUrl),
    username,
    token,
    salt,
    serverType,
    ...(usePlain ? { password } : {}),
    ...(plainAuth ? { plainAuth: true } : {}),
    // Navidrome: the native API (uploading covers) needs the password.
    ...(serverType === 'navidrome' ? { ndPassword: password } : {}),
  };
}

/** Strips trailing slash and ensures the http(s) scheme. */
export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function authParams(auth: SubsonicAuth): URLSearchParams {
  const base = { u: auth.username, v: API_VERSION, c: CLIENT_NAME, f: 'json' };
  // Classic auth for Ampache; token + salt for the rest.
  if (auth.password !== undefined) {
    return new URLSearchParams({ ...base, p: `enc:${hexEncodeUtf8(auth.password)}` });
  }
  return new URLSearchParams({ ...base, t: auth.token, s: auth.salt });
}

function buildUrl(
  auth: SubsonicAuth,
  endpoint: string,
  extra: Record<string, string | number | undefined> = {},
): string {
  const params = authParams(auth);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `${auth.serverUrl}/rest/${endpoint}?${params.toString()}`;
}

const REQUEST_TIMEOUT_MS = 15000;

/** Makes a request and unwraps the Subsonic response. */
/**
 * Subsonic request error. `network` distinguishes "server didn't respond"
 * (offline or timeout) from "responded with error" (credentials, 4xx/5xx…):
 * the former is a network issue that can fall back to offline mode; the
 * latter is a real account issue that must be shown.
 *
 * `code` is Subsonic's own error code when the server sent one. It was being
 * dropped in favour of the message, and the one that has to be told apart from
 * the rest is 70, "the requested data was not found": a wrong password and a
 * song that is not there are both "the server answered with an error", and
 * only one of them is a reason to suspect the ids have moved underneath us.
 */
export class SubsonicRequestError extends Error {
  network: boolean;
  code?: number;
  constructor(message: string, network: boolean, code?: number) {
    super(message);
    this.name = 'SubsonicRequestError';
    this.network = network;
    this.code = code;
  }
}

/** Subsonic's "the requested data was not found". */
export const ERR_NOT_FOUND = 70;

/**
 * Retries one request with the id the server would have after migrating.
 *
 * This is what makes a migration invisible. Without it the first thing that
 * happens on an upgraded server is a screen that fails, and the repair only
 * starts once something has already gone wrong in front of somebody. With it,
 * the answer arrives, one request later than usual, exactly once, and the
 * repair gets going behind it.
 *
 * `null` for anything other than a clean success, so the caller reports the
 * error it already had. An id the transform leaves alone never gets here: for
 * those, "not found" means what it says.
 *
 * The repair is imported at the point of use, not at the top. It reaches for
 * the catalog and the mirror, both of which reach back for this module, and
 * the cycle is only harmless because it is resolved at the one moment it is
 * needed rather than while the app is loading.
 */
async function retryWithCanonicalId<T>(
  auth: SubsonicAuth,
  endpoint: string,
  extra: Record<string, string | number | undefined>,
  allowOffline: boolean,
): Promise<T | null> {
  const id = extra.id;
  if (typeof id !== 'string' || !idWouldChange(id)) return null;
  const repair = await import('@/lib/navidromeRepair').catch(() => null);
  if (!repair) return null;
  let res: T;
  try {
    res = await request<T>(auth, endpoint, { ...extra, id: canonicalId(id) }, allowOffline, true);
  } catch {
    return null;
  }
  // Answering to the canonical id is the proof the probe is looking for, but
  // it is not taken as proof here: the repair asks again, properly, with its
  // own samples and its own guards. This only says it is worth looking.
  void repair.repairIfMigrated(auth).catch(() => {});
  return res;
}

async function request<T>(
  auth: SubsonicAuth,
  endpoint: string,
  extra: Record<string, string | number | undefined> = {},
  allowOffline = false,
  /** Set on the retry itself, so one failure is never retried twice. */
  retried = false,
): Promise<T> {
  // Offline mode stops here, before the socket (see netGate).
  assertCanRequest(allowOffline);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await timed(`net ${endpoint}`, () =>
      fetch(buildUrl(auth, endpoint, extra), { signal: controller.signal }),
    );
  } catch {
    // Counted too, and apart. A request that never arrives costs the radio the
    // same as one that does, and a phone talking to a server that is not there
    // is one of the two shapes this report exists to tell apart.
    netTally(`${endpoint} (no answer)`);
    if (controller.signal.aborted) {
      throw new SubsonicRequestError('Server took too long to respond', true);
    }
    throw new SubsonicRequestError('Could not connect to the server', true);
  } finally {
    clearTimeout(timer);
  }

  // Before the status is judged: an error is a request that went out and came
  // back like any other, and a storm of them is what a tally is for.
  netTally(endpoint, Number(res.headers.get('content-length')) || 0);
  if (!res.ok) throw new SubsonicRequestError(`Network error (${res.status})`, false);
  // Apart from the request: this is the part that runs on the JS thread, and
  // it grows with the size of the answer.
  //
  // In development it also says how big that answer was, and it gets there by
  // reading the body once and parsing that, rather than by cloning the
  // response: a clone taken after `json()` has read it throws "body is already
  // used", synchronously and outside the try above, which took every request
  // with it. React Native's `fetch` let that pass; a spec-abiding one does not.
  const json = await timed(`json ${endpoint}`, async () => {
    if (!__DEV__) return res.json();
    const text = await res.text();
    console.log(`[perf] size ${endpoint} · ${Math.round(text.length / 1024)} KB`);
    return JSON.parse(text);
  });
  const sub = json['subsonic-response'];
  if (!sub) throw new SubsonicRequestError('Unexpected server response', false);
  if (sub.status === 'failed') {
    const code = typeof sub.error?.code === 'number' ? sub.error.code : undefined;
    if (!retried && code === ERR_NOT_FOUND) {
      const again = await retryWithCanonicalId<T>(auth, endpoint, extra, allowOffline);
      if (again) return again;
    }
    throw new SubsonicRequestError(sub.error?.message ?? 'Subsonic error', false, code);
  }
  if (omitsAbsentCovers(sub)) markAbsentCovers(sub);
  return sub as T;
}

/** Verifies that the credentials are valid. */
/** The one question allowed while offline: it is how the app learns the server
 *  is back, and what the "test" button in Settings asks. */
export async function ping(auth: SubsonicAuth): Promise<void> {
  const res = await request<{ serverVersion?: string; version?: string }>(
    auth,
    'ping.view',
    {},
    true,
  );
  // Navidrome's own version when it sends it, the Subsonic API level
  // otherwise. Only ever compared with the last one seen, so which of the two
  // it is does not matter as long as it is the same one each time.
  const version = res.serverVersion ?? res.version;
  if (!version) return;

  // Compared in memory first, and this is not a micro-optimisation. `ping` is
  // how the app decides it is online: it runs at launch, on coming back to the
  // foreground, on every network change, and `backend.ts` fires it at several
  // candidate URLs at once while working out which one answers. Everything past
  // this line reads SecureStore, which is an encrypted read off disk, so doing
  // it per ping would put a Keystore round trip into the middle of the offline
  // detection (#122). A version that has not changed since the last ping costs
  // one map lookup and nothing else.
  const key = `${auth.username}|${auth.serverUrl}`;
  if (lastVersionSeen.get(key) === version) return;
  lastVersionSeen.set(key, version);

  void import('@/lib/navidromeRepair')
    .then((m) => m.noteServerVersion(auth, version))
    .catch(() => {});
}

/** Last version each profile answered with, this session. Only ever avoids
 *  work: a miss costs one comparison that was going to happen anyway. */
const lastVersionSeen = new Map<string, string>();

/**
 * Whether the server this profile talks to is at least `major.minor`.
 *
 * `undefined` for "no idea", which is every case that is not a plain answer:
 * before the first `ping`, and for any version string that does not start with
 * two numbers (a develop build carrying a git sha, a fork with its own
 * scheme, a proxy rewriting it).
 *
 * Worth being clear about what this may and may not be used for. It gates
 * whether a feature is *offered*, where being wrong costs a button that is
 * there or is not; the repair of the ids deliberately refuses to trust it for
 * anything else, and says why at length (`navidromeRepair.noteServerVersion`).
 * The three-valued answer is the whole point: a caller has to decide what to
 * do about not knowing, and for a feature the answer is to leave it out.
 *
 * Only meaningful next to a `serverType` check, since what the string means
 * depends on who sent it: on Navidrome it is Navidrome's own version, and on a
 * server that sends no `serverVersion` at all it is the Subsonic API level,
 * where 1.16 has nothing to do with anybody's release.
 */
export function serverAtLeast(
  auth: SubsonicAuth,
  major: number,
  minor: number,
): boolean | undefined {
  const seen = lastVersionSeen.get(`${auth.username}|${auth.serverUrl}`);
  const parts = /^(\d+)\.(\d+)/.exec(seen ?? '');
  if (!parts) return undefined;
  const [seenMajor, seenMinor] = [Number(parts[1]), Number(parts[2])];
  return seenMajor !== major ? seenMajor > major : seenMinor >= minor;
}

/** Which way round an order is read. It goes into the request, so it lives
 *  here with the rest of what a request can say. */
export type SortDirection = 'asc' | 'desc';

export type AlbumListType =
  | 'newest'
  | 'recent'
  | 'frequent'
  | 'random'
  | 'byYear'
  | 'alphabeticalByName'
  | 'alphabeticalByArtist'
  | 'starred';

/**
 * Ordering for the Songs screen. Not every server can do all of them, which is
 * why the screen asks `songListSorts` (in `data.ts`) instead of offering the
 * lot: a chip that quietly does nothing is worse than a chip that isn't there.
 * `server` is "however this one keeps them", the only listing Subsonic itself
 * can give.
 */
export type SongListSort =
  | 'server'
  | 'recent'
  | 'added'
  | 'alpha'
  | 'frequent'
  | 'random';

/**
 * How far back `byYear` reaches. It is not a filter anybody asked for: the list
 * is meant to be the library by release date, and the endpoint only takes a
 * range, so this is the floor of it.
 */
const FIRST_YEAR = 1900;

export async function getAlbumList(
  auth: SubsonicAuth,
  type: AlbumListType = 'newest',
  size = 20,
  offset = 0,
  musicFolderId?: string,
): Promise<Album[]> {
  const res = await request<{ albumList2?: { album?: Album[] } }>(
    auth,
    'getAlbumList2.view',
    {
      type,
      size,
      offset,
      // `byYear` is the one type that takes a range, and the range is also what
      // says which way round it is read: later to earlier is newest first.
      ...(type === 'byYear'
        ? { fromYear: new Date().getFullYear(), toYear: FIRST_YEAR }
        : {}),
      ...(musicFolderId ? { musicFolderId } : {}),
    },
  );
  return res.albumList2?.album ?? [];
}

/** A server library (Navidrome exposes each "library" as a folder). */
export interface MusicFolder {
  id: string;
  name: string;
}

/** Root libraries/folders accessible to the user. */
export async function getMusicFolders(auth: SubsonicAuth): Promise<MusicFolder[]> {
  const res = await request<{
    musicFolders?: { musicFolder?: { id: string | number; name?: string }[] };
  }>(auth, 'getMusicFolders.view');
  return (res.musicFolders?.musicFolder ?? []).map((f) => ({
    id: String(f.id),
    name: f.name ?? String(f.id),
  }));
}

/** A child directory inside a folder (folder browsing). */
export interface FolderEntry {
  id: string;
  name: string;
  coverArt?: string;
  /** Only album directories carry one; artist directories don't. Shown under
   *  the folder name, which is the one piece of an album the folder view was
   *  sorting by without ever showing it (#97). */
  year?: number;
}

/** Contents of a directory: subfolders and songs. */
export interface FolderContents {
  id: string;
  name: string;
  dirs: FolderEntry[];
  songs: Song[];
}

/**
 * Root level of folder browsing: alphabetical index of top-level directories
 * (usually artists) from a library. Their `id` values serve as the directory
 * for `getMusicDirectory`.
 */
export async function getIndexes(
  auth: SubsonicAuth,
  musicFolderId?: string,
): Promise<FolderEntry[]> {
  const res = await request<{
    indexes?: { index?: { artist?: { id: string; name: string; coverArt?: string }[] }[] };
  }>(auth, 'getIndexes.view', musicFolderId ? { musicFolderId } : undefined);
  return (res.indexes?.index ?? []).flatMap((i) => i.artist ?? []);
}

/** Contents of a specific directory: subfolders + songs. */
export async function getMusicDirectory(
  auth: SubsonicAuth,
  id: string,
): Promise<FolderContents> {
  const res = await request<{
    directory?: {
      id?: string;
      name?: string;
      child?: (Song & { isDir?: boolean; name?: string })[];
    };
  }>(auth, 'getMusicDirectory.view', { id });
  const dir = res.directory ?? {};
  const children = dir.child ?? [];
  const dirs: FolderEntry[] = children
    .filter((c) => c.isDir)
    .map((c) => ({
      id: c.id,
      name: c.name ?? c.title ?? '',
      coverArt: c.coverArt,
      // Servers send 0 when they have no year for the album.
      year: c.year || undefined,
    }));
  const songs = children.filter((c) => !c.isDir) as Song[];
  return { id: dir.id ?? id, name: dir.name ?? '', dirs, songs };
}

export interface Genre {
  value: string;
  songCount?: number;
  albumCount?: number;
}

export async function getGenres(auth: SubsonicAuth): Promise<Genre[]> {
  const res = await request<{ genres?: { genre?: Genre[] } }>(auth, 'getGenres.view');
  return (res.genres?.genre ?? []).filter((g) => g.value);
}

export async function getAlbumsByGenre(
  auth: SubsonicAuth,
  genre: string,
  size = 30,
  offset = 0,
  musicFolderId?: string,
): Promise<Album[]> {
  const res = await request<{ albumList2?: { album?: Album[] } }>(
    auth,
    'getAlbumList2.view',
    { type: 'byGenre', genre, size, offset, ...(musicFolderId ? { musicFolderId } : {}) },
  );
  return res.albumList2?.album ?? [];
}

/**
 * Songs tagged with a genre. Not the same as the albums of that genre: tags
 * live per file, so a genre's songs can sit inside albums tagged as something
 * else, and vice versa.
 */
/**
 * One song, or null if the server says it has no such thing.
 *
 * Only the migration probe asks this, which is why it swallows "not found"
 * into a null and lets everything else through: the probe has to tell "the
 * server does not know this id" apart from "the server could not be reached",
 * and treating a bad moment as a definite no is how a repair runs when it
 * should not.
 */
export async function getSong(auth: SubsonicAuth, id: string): Promise<Song | null> {
  try {
    const res = await request<{ song?: Song }>(auth, 'getSong.view', { id });
    return res.song ?? null;
  } catch (e) {
    if (e instanceof SubsonicRequestError && e.code === ERR_NOT_FOUND) return null;
    throw e;
  }
}

export async function getSongsByGenre(
  auth: SubsonicAuth,
  genre: string,
  count = 50,
  offset = 0,
  musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<{ songsByGenre?: { song?: Song[] } }>(
    auth,
    'getSongsByGenre.view',
    { genre, count, offset, ...(musicFolderId ? { musicFolderId } : {}) },
  );
  return res.songsByGenre?.song ?? [];
}

export async function getAlbum(
  auth: SubsonicAuth,
  id: string,
): Promise<{ album: Album; songs: Song[] }> {
  const res = await request<{ album: Album & { song?: Song[] } }>(
    auth,
    'getAlbum.view',
    { id },
  );
  const { song, ...album } = res.album;
  return { album, songs: song ?? [] };
}

export async function getPlaylists(auth: SubsonicAuth): Promise<Playlist[]> {
  const res = await request<{ playlists?: { playlist?: Playlist[] } }>(
    auth,
    'getPlaylists.view',
  );
  const lists = res.playlists?.playlist ?? [];
  // Ampache mixes its stock smartlists (owner "System": "Album 1*"…) with
  // the user's lists; they're hidden because they aren't editable from the app.
  return isAmpache(auth.serverType) ? lists.filter((p) => p.owner !== 'System') : lists;
}

export async function getPlaylist(
  auth: SubsonicAuth,
  id: string,
): Promise<{ playlist: Playlist; songs: Song[] }> {
  type Node = Playlist & { entry?: Song[] };
  const res = await request<{ playlist: Node | Node[] }>(
    auth,
    'getPlaylist.view',
    { id },
  );
  // Ampache 6 returns `playlist` as a one-element array (out of spec).
  const { entry, ...playlist } = Array.isArray(res.playlist) ? res.playlist[0] : res.playlist;
  return { playlist, songs: entry ?? [] };
}

/** Adds a song to an existing playlist. */
export async function addToPlaylist(
  auth: SubsonicAuth,
  playlistId: string,
  songId: string,
): Promise<void> {
  await request(auth, 'updatePlaylist.view', {
    playlistId,
    songIdToAdd: songId,
  });
}

/** Creates an empty playlist and returns its id. */
export async function createPlaylist(
  auth: SubsonicAuth,
  name: string,
): Promise<string> {
  const res = await request<{ playlist?: { id: string } | { id: string }[] }>(
    auth,
    'createPlaylist.view',
    { name },
  );
  // Ampache 6 returns `playlist` as a one-element array (out of spec).
  const node = Array.isArray(res.playlist) ? res.playlist[0] : res.playlist;
  if (node?.id) return node.id;
  // Some servers don't return the created playlist: look it up by name.
  const lists = await getPlaylists(auth);
  const created = lists.find((p) => p.name === name);
  if (!created) throw new Error('Created playlist not found');
  return created.id;
}

/** Deletes a playlist. */
export async function deletePlaylist(
  auth: SubsonicAuth,
  id: string,
): Promise<void> {
  await request(auth, 'deletePlaylist.view', { id });
}

/** Edits playlist metadata: name, description and visibility. */
export async function updatePlaylist(
  auth: SubsonicAuth,
  id: string,
  changes: { name?: string; comment?: string; public?: boolean },
): Promise<void> {
  await request(auth, 'updatePlaylist.view', {
    playlistId: id,
    name: changes.name,
    comment: changes.comment,
    public: changes.public === undefined ? undefined : String(changes.public),
  });
}

/**
 * Rewrites the full order of a playlist. Subsonic has no "move": the playlist
 * is recreated with `createPlaylist` passing its `playlistId` and all
 * `songId`s in the new order (replaces entries). POST to avoid generating
 * huge URLs with long lists.
 */
export async function reorderPlaylist(
  auth: SubsonicAuth,
  id: string,
  songIds: string[],
): Promise<void> {
  const params = authParams(auth);
  params.set('playlistId', id);
  for (const sid of songIds) params.append('songId', sid);
  assertCanRequest();
  netTally('createPlaylist.view', params.toString().length);
  const res = await fetch(`${auth.serverUrl}/rest/createPlaylist.view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Error de red (${res.status})`);
  const json = await res.json();
  const sub = json['subsonic-response'];
  if (sub?.status === 'failed') throw new Error(sub.error?.message ?? 'Error de Subsonic');
}

/** Removes a song from a playlist by its index (position in the list). */
export async function removeFromPlaylist(
  auth: SubsonicAuth,
  id: string,
  index: number,
): Promise<void> {
  await request(auth, 'updatePlaylist.view', {
    playlistId: id,
    songIndexToRemove: index,
  });
}

export interface SearchResult {
  artists: Artist[];
  albums: Album[];
  songs: Song[];
}

export async function search(
  auth: SubsonicAuth,
  query: string,
  musicFolderId?: string,
): Promise<SearchResult> {
  const res = await request<{
    searchResult3?: { artist?: Artist[]; album?: Album[]; song?: Song[] };
  }>(auth, 'search3.view', {
    query,
    songCount: 20,
    albumCount: 20,
    artistCount: 20,
    ...(musicFolderId ? { musicFolderId } : {}),
  });
  const r = res.searchResult3 ?? {};
  return {
    artists: r.artist ?? [],
    albums: r.album ?? [],
    songs: r.song ?? [],
  };
}

/**
 * Album-only search. Separate from `search` on purpose: that one requests
 * artists and songs that album filtering discards, and is capped at 20.
 */
export async function searchAlbums(
  auth: SubsonicAuth,
  query: string,
  count = 50,
  musicFolderId?: string,
): Promise<Album[]> {
  const res = await request<{ searchResult3?: { album?: Album[] } }>(auth, 'search3.view', {
    query,
    albumCount: count,
    // Set to 0 so the server doesn't search or send what isn't rendered.
    songCount: 0,
    artistCount: 0,
    ...(musicFolderId ? { musicFolderId } : {}),
  });
  return res.searchResult3?.album ?? [];
}

/** Songs matching the text, and only songs (browsing songs searches with this). */
export async function searchSongs(
  auth: SubsonicAuth,
  query: string,
  count = 50,
  musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<{ searchResult3?: { song?: Song[] } }>(auth, 'search3.view', {
    query,
    songCount: count,
    // Set to 0 so the server doesn't search or send what isn't rendered.
    albumCount: 0,
    artistCount: 0,
    ...(musicFolderId ? { musicFolderId } : {}),
  });
  return res.searchResult3?.song ?? [];
}

export async function getArtists(auth: SubsonicAuth, musicFolderId?: string): Promise<Artist[]> {
  const res = await request<{
    artists?: { index?: { artist?: Artist[] }[] };
  }>(auth, 'getArtists.view', musicFolderId ? { musicFolderId } : undefined);
  // The response groups artists by initial letter; flatten them.
  return (res.artists?.index ?? []).flatMap((i) => i.artist ?? []);
}

export async function getArtist(
  auth: SubsonicAuth,
  id: string,
): Promise<{ artist: Artist; albums: Album[] }> {
  const res = await request<{ artist: Artist & { album?: Album[] } }>(
    auth,
    'getArtist.view',
    { id },
  );
  const { album, ...artist } = res.artist;
  return { artist, albums: album ?? [] };
}

/**
 * Albums by other artists where this one appears ("Appears On"). Subsonic
 * has no endpoint for this, so it's approximated with search3: songs that
 * match the name, filtered to those where the artist participates and whose
 * album is not theirs.
 *
 * `confirmed` says whether the server actually told us the album's artists
 * (OpenSubsonic `albumArtists`) and ours wasn't among them. That distinction
 * matters: some servers list participation albums inside `getArtist` too, so
 * the screen can't just assume "already in the discography = own album".
 */
export async function getAppearsOn(
  auth: SubsonicAuth,
  artistId: string,
  artistName: string,
  musicFolderId?: string,
): Promise<GuestAlbum[]> {
  const res = await request<{ searchResult3?: { song?: Song[] } }>(auth, 'search3.view', {
    query: artistName,
    songCount: 200,
    albumCount: 0,
    artistCount: 0,
    ...(musicFolderId ? { musicFolderId } : {}),
  });
  const byAlbum = new Map<string, GuestAlbum>();
  for (const s of res.searchResult3?.song ?? []) {
    if (!s.albumId || byAlbum.has(s.albumId)) continue;
    const participates = s.artists
      ? s.artists.some((a) => a.id === artistId)
      : s.artistId === artistId;
    if (!participates) continue;
    if (s.albumArtists?.some((a) => a.id === artistId)) continue;
    byAlbum.set(s.albumId, {
      id: s.albumId,
      name: s.album ?? '',
      artist: s.albumArtists?.map((a) => a.name).join(', ') || undefined,
      coverArt: s.coverArt,
      year: s.year,
      // We got the album's artist list and ours isn't in it: this is a
      // participation for certain, whatever the discography says.
      confirmed: !!s.albumArtists?.length,
    });
  }
  return [...byAlbum.values()];
}

/**
 * Most played songs. Subsonic has no global endpoint for songs by play count,
 * so it's composed: "frequent" albums (those from Home) → their songs →
 * sorted by the `playCount` sent by OpenSubsonic. If the server doesn't send
 * per-song playCount, they keep the order of frequent albums (which is
 * already a good approximation).
 */
export async function getMostPlayedSongs(
  auth: SubsonicAuth,
  size = 50,
  musicFolderId?: string,
): Promise<Song[]> {
  const albums = await getAlbumList(auth, 'frequent', 15, 0, musicFolderId);
  const details = await Promise.all(
    albums.map((al) => getAlbum(auth, al.id).catch(() => ({ album: al, songs: [] as Song[] }))),
  );
  const songs = details.flatMap((d) => d.songs);
  if (!songs.some((s) => (s.playCount ?? 0) > 0)) return songs.slice(0, size);
  return songs
    .filter((s) => (s.playCount ?? 0) > 0)
    .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
    .slice(0, size);
}

/**
 * Random songs from the whole library (the Home shuffle).
 *
 * `size` is not arbitrary: the endpoint caps around 500, so this doesn't
 * shuffle the entire library but a sample. In practice that's what we want;
 * nobody browses a 20,000-song queue.
 *
 * Accepts `genre` because that's what a "genre radio" would need without
 * duplicating any of this.
 */
export async function getRandomSongs(
  auth: SubsonicAuth,
  size = 200,
  genre?: string,
  musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<{ randomSongs?: { song?: Song[] } }>(
    auth,
    'getRandomSongs.view',
    { size, ...(genre ? { genre } : {}), ...(musicFolderId ? { musicFolderId } : {}) },
  );
  return res.randomSongs?.song ?? [];
}

/**
 * The library's songs, a page at a time.
 *
 * Subsonic has no endpoint that lists songs, so this is `search3` with an empty
 * query, which is the agreed way to ask for everything (OpenSubsonic says as
 * much and Navidrome answers with all of them, paginated). What it cannot do is
 * order them: an empty search comes back in the server's own order, whatever
 * that is, so this is the only listing the Songs screen can offer here. Sorting
 * would mean pulling the whole library down to sort it on the phone, which on a
 * six-figure library is not a thing to do.
 */
export async function getSongList(
  auth: SubsonicAuth,
  sort: SongListSort = 'server',
  count = 50,
  offset = 0,
  musicFolderId?: string,
): Promise<Song[]> {
  // The one order Subsonic does have, and it doesn't paginate: a page of new
  // random songs is what "more" means here. The orders it has no endpoint for
  // are built a layer up, out of the albums it can sort (see `data.ts`).
  if (sort === 'random') return getRandomSongs(auth, count, undefined, musicFolderId);
  const res = await request<{ searchResult3?: { song?: Song[] } }>(auth, 'search3.view', {
    query: '',
    songCount: count,
    songOffset: offset,
    albumCount: 0,
    artistCount: 0,
    ...(musicFolderId ? { musicFolderId } : {}),
  });
  return res.searchResult3?.song ?? [];
}

/**
 * Most popular songs by an artist.
 *
 * Both the name and the id go up, and which one the server uses is the
 * server's business. Navidrome 0.64 takes `id` and announces it as the
 * `topSongsByArtistId` extension; it looks the artist up by id first and falls
 * back to the name if that finds nothing (`core/external.findArtist`). Older
 * servers, and every other Subsonic implementation, ignore the parameter they
 * do not know and answer by name exactly as before.
 *
 * So no extension check: asking `getOpenSubsonicExtensions` would spend a
 * request to learn something that changes nothing about what we send. What the
 * id buys is the case the name cannot express: two artists with the same name,
 * where matching by name is `LIKE artist.name` with a limit of one and so
 * returns whichever of them the database reaches first.
 */
export async function getTopSongs(
  auth: SubsonicAuth,
  artist: string,
  count = 10,
  artistId?: string,
): Promise<Song[]> {
  const res = await request<{ topSongs?: { song?: Song[] } }>(
    auth,
    'getTopSongs.view',
    { artist, count, id: artistId },
  );
  return res.topSongs?.song ?? [];
}

/** Songs similar to a given one (getSimilarSongs2): autoplay / radio. */
export async function getSimilarSongs(
  auth: SubsonicAuth,
  id: string,
  count = 20,
): Promise<Song[]> {
  const res = await request<{ similarSongs2?: { song?: Song[] } }>(
    auth,
    'getSimilarSongs2.view',
    { id, count },
  );
  return res.similarSongs2?.song ?? [];
}

export interface ArtistInfo {
  biography?: string;
  imageUrl?: string;
  similarArtists: Artist[];
}

/** Extended artist info (bio, photo and similars) from getArtistInfo2. */
export async function getArtistInfo(
  auth: SubsonicAuth,
  id: string,
): Promise<ArtistInfo> {
  const res = await request<{
    artistInfo2?: {
      biography?: string;
      largeImageUrl?: string;
      similarArtist?: Artist[];
    };
  }>(auth, 'getArtistInfo2.view', { id });
  const info = res.artistInfo2 ?? {};
  // The biography usually comes with HTML (link to Last.fm); strip it.
  const biography = info.biography?.replace(/<[^>]+>/g, '').trim() || undefined;
  // The server may repeat a similar (same id) → duplicate keys in React.
  const seen = new Set<string>();
  const similarArtists = (info.similarArtist ?? []).filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  return {
    biography,
    imageUrl: info.largeImageUrl || undefined,
    similarArtists,
  };
}

export interface Starred {
  songs: Song[];
  albums: Album[];
  artists: Artist[];
}

export async function getStarred(auth: SubsonicAuth, musicFolderId?: string): Promise<Starred> {
  const res = await request<{
    starred2?: { song?: Song[]; album?: Album[]; artist?: Artist[] };
  }>(auth, 'getStarred2.view', musicFolderId ? { musicFolderId } : undefined);
  const s = res.starred2 ?? {};
  return {
    songs: s.song ?? [],
    albums: s.album ?? [],
    artists: s.artist ?? [],
  };
}

/**
 * What a favourite can be about.
 *
 * `playlist` is Navidrome 0.64 and up only, and it is not in Subsonic at all.
 * Starring one is written the same way a song is, with the plain `id`
 * parameter, and the server works out what the id belongs to
 * (`GetEntityByID`, navidrome/navidrome#5749). What it is *not* is readable
 * that way: the same PR keeps annotations out of the Subsonic playlist
 * responses on purpose, so `getStarred` will never mention a playlist and the
 * state has to be read through the native API (`listStarredPlaylistIds`).
 *
 * On an older Navidrome the plain id falls through to `media_file`, matches
 * nothing, and the server answers a cheerful OK having done nothing at all,
 * which is why the heart is only offered where that read path exists (see
 * `usePlaylistStars`): if we cannot read the state back, we do not pretend to
 * write it.
 */
export type StarType = 'song' | 'album' | 'artist' | 'playlist';

function starParam(id: string, type: StarType): Record<string, string> {
  // Subsonic uses a different parameter depending on the element type.
  if (type === 'album') return { albumId: id };
  if (type === 'artist') return { artistId: id };
  // Songs, and playlists on Navidrome, which resolves the id itself.
  return { id };
}

/** Marks an item as favorite. */
export async function star(
  auth: SubsonicAuth,
  id: string,
  type: StarType = 'song',
): Promise<void> {
  await request(auth, 'star.view', starParam(id, type));
}

/** Removes an item from favorites. */
export async function unstar(
  auth: SubsonicAuth,
  id: string,
  type: StarType = 'song',
): Promise<void> {
  await request(auth, 'unstar.view', starParam(id, type));
}

/** Rates a song from 1 to 5 stars; 0 removes the rating. */
export async function setRating(auth: SubsonicAuth, id: string, rating: number): Promise<void> {
  await request(auth, 'setRating.view', { id, rating: String(rating) });
}

export interface ScanStatus {
  scanning: boolean;
  count: number;
}

/** Status of the server library scan. */
export async function getScanStatus(auth: SubsonicAuth): Promise<ScanStatus> {
  const res = await request<{ scanStatus?: { scanning?: boolean; count?: number } }>(
    auth,
    'getScanStatus.view',
  );
  return {
    scanning: res.scanStatus?.scanning ?? false,
    count: res.scanStatus?.count ?? 0,
  };
}

/** Starts a new library scan on the server. */
export async function startScan(auth: SubsonicAuth): Promise<ScanStatus> {
  const res = await request<{ scanStatus?: { scanning?: boolean; count?: number } }>(
    auth,
    'startScan.view',
  );
  return {
    scanning: res.scanStatus?.scanning ?? false,
    count: res.scanStatus?.count ?? 0,
  };
}

/** Gets the lyrics for a song (may come back empty if none). */
export async function getLyrics(
  auth: SubsonicAuth,
  artist: string,
  title: string,
): Promise<string> {
  const res = await request<{ lyrics?: { value?: string } }>(
    auth,
    'getLyrics.view',
    { artist, title },
  );
  return res.lyrics?.value?.trim() ?? '';
}

/** A word or a syllable of a synced line, and when it is sung. */
export interface LyricWord {
  /** Milliseconds from the start of the track. */
  start: number;
  end?: number;
  /** Its text, with whatever follows it up to the next word (a space, often). */
  value: string;
}

export interface LyricLine {
  /** Milliseconds from the start of the track; only in synced lyrics. */
  start?: number;
  value: string;
  /**
   * Word by word, when the lyrics were timed that finely (#165). Put back
   * together they are `value`, spaces included.
   */
  words?: LyricWord[];
}

export interface SongLyrics {
  synced: boolean;
  lines: LyricLine[];
}

/**
 * Structured lyrics by song id (OpenSubsonic extension `songLyrics`,
 * supported by Navidrome and Ampache 7): lines with timestamps if the lyrics
 * are synced. Throws on servers without the extension; null if no lyrics.
 *
 * Asked with `enhanced`, which version 2 of the extension answers with each
 * line's words and when they are sung (`cueLine`): Navidrome 0.63 reads those
 * out of TTML, enhanced LRC, SRT and YAML files (#165). A server without it
 * ignores the parameter and answers as before.
 */
export async function getLyricsBySongId(
  auth: SubsonicAuth,
  id: string,
): Promise<SongLyrics | null> {
  interface CueLine {
    /** The `line` it times. */
    index?: number;
    value?: string;
    cue?: { start: number; end?: number; value?: string; byteStart?: number }[];
  }
  interface StructuredLyrics {
    /** Only with `enhanced`: `main`, `translation` or `pronunciation`. */
    kind?: string;
    synced?: boolean;
    /** Global offset in ms; positive = lyrics should appear earlier. */
    offset?: number;
    line?: { start?: number; value?: string }[];
    cueLine?: CueLine[];
  }
  const res = await request<{ lyricsList?: { structuredLyrics?: StructuredLyrics[] } }>(
    auth,
    'getLyricsBySongId.view',
    { id, enhanced: 'true' },
  );
  // `enhanced` brings the translations and the pronunciations too, as entries
  // of their own, and those are not the song's lyrics.
  const all = (res.lyricsList?.structuredLyrics ?? []).filter((l) => !l.kind || l.kind === 'main');
  const pick = all.find((l) => l.synced && l.line?.length) ?? all.find((l) => l.line?.length);
  if (!pick?.line?.length) return null;
  const synced = !!pick.synced;
  const offset = pick.offset ?? 0;
  // The first cue line of each index: the spec puts the main voice ahead of
  // the backing ones that share its line.
  const cues = new Map<number, CueLine>();
  if (synced) {
    pick.cueLine?.forEach((cl, i) => {
      const at = cl.index ?? i;
      if (!cues.has(at)) cues.set(at, cl);
    });
  }
  return {
    synced,
    lines: pick.line.map((ln, i) => {
      const text = cues.get(i)?.value;
      const cue = cues.get(i)?.cue;
      const words = text && cue?.length ? wordsFromCues(text, cue, offset) : undefined;
      return {
        // The cue line's own text when it has words, since they are cut out of
        // it, and `line` may carry the backing vocals alongside.
        value: words && text ? text : (ln.value ?? ''),
        ...(synced && ln.start !== undefined
          ? { start: Math.max(0, ln.start - offset) }
          : {}),
        ...(words ? { words } : {}),
      };
    }),
  };
}

export interface SavedQueue {
  entries: Song[];
  current?: string;
  /** Position in the current track, in milliseconds. */
  position: number;
  /**
   * When the server's copy was last written, by its own clock, and by whom.
   *
   * `changedBy` is the client name whoever saved it last sent (ours is
   * `CLIENT_NAME`), which is how a queue left on another player is told from
   * the last thing this phone pushed. Both are standard Subsonic and both are
   * optional: a server that sends neither simply never looks newer.
   */
  changed?: number;
  changedBy?: string;
}

/** Saves the play queue to the server (savePlayQueue). */
export async function savePlayQueue(
  auth: SubsonicAuth,
  ids: string[],
  currentId: string,
  positionMs: number,
): Promise<void> {
  if (ids.length === 0) return;
  const params = authParams(auth);
  for (const id of ids) params.append('id', id);
  if (currentId) params.set('current', currentId);
  params.set('position', String(Math.max(0, Math.floor(positionMs))));
  try {
    // POST with parameters in the body: avoids giant URLs with long queues.
    assertCanRequest();
    // Tallied by hand: this one does not go through `request`, and it is the
    // one that grows with the queue. A mix left running all night is a body of
    // thousands of ids pushed every twenty seconds, which is worth seeing.
    netTally('savePlayQueue.view', params.toString().length);
    await fetch(`${auth.serverUrl}/rest/savePlayQueue.view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch {
    // Best-effort; ignore network errors when saving the queue.
  }
}

/** Retrieves the saved queue from the server (getPlayQueue). */
export async function getPlayQueue(auth: SubsonicAuth): Promise<SavedQueue | null> {
  const res = await request<{
    playQueue?: {
      entry?: Song[];
      current?: string;
      position?: number;
      changed?: string;
      changedBy?: string;
    };
  }>(auth, 'getPlayQueue.view');
  const pq = res.playQueue;
  if (!pq?.entry || pq.entry.length === 0) return null;
  const changed = pq.changed ? Date.parse(pq.changed) : NaN;
  return {
    entries: pq.entry,
    current: pq.current,
    position: pq.position ?? 0,
    changed: Number.isFinite(changed) ? changed : undefined,
    changedBy: pq.changedBy,
  };
}

/** A song playing on one of the user's players, from `getNowPlaying`. */
export interface NowPlayingEntry {
  song: Song;
  username: string;
  minutesAgo: number;
  playerName?: string;
  /** Only with the OpenSubsonic `playbackReport` extension. */
  state?: 'starting' | 'playing' | 'paused' | 'stopped';
  /** Same: where it was at the last report, worked out by the server. */
  positionMs?: number;
}

/** What every player on the server is playing, for every user it can see. */
export async function getNowPlaying(auth: SubsonicAuth): Promise<NowPlayingEntry[]> {
  const res = await request<{
    nowPlaying?: {
      entry?: (Song & {
        username?: string;
        minutesAgo?: number;
        playerName?: string;
        state?: NowPlayingEntry['state'];
        positionMs?: number;
      })[];
    };
  }>(auth, 'getNowPlaying.view');
  return (res.nowPlaying?.entry ?? []).map(
    ({ username, minutesAgo, playerName, state, positionMs, ...song }) => ({
      song: song as Song,
      username: username ?? '',
      minutesAgo: minutesAgo ?? 0,
      playerName,
      state,
      positionMs,
    }),
  );
}

/** Notifies the server that a song has been played (scrobble). */
/**
 * `submission=false` announces "now playing" (doesn't count as play);
 * `true` registers the actual listen (counters and Last.fm/ListenBrainz).
 *
 * Errors are let through. This used to swallow every one of them, which read
 * as "scrobbling is optional" and was true of the announcement but not of the
 * listen: a listen the network refused was meant to go to the outbox and be
 * retried, and the caller could never find out that it had to (#126). Whoever
 * does not care about the answer says so at the call site.
 */
export async function scrobble(auth: SubsonicAuth, id: string, submission = true): Promise<void> {
  await request(auth, 'scrobble.view', { id, submission: submission ? 'true' : 'false' });
}

/**
 * A listen that already happened, sent with the time it happened at (ms since
 * epoch). For the offline outbox: the play is uploaded on reconnect, and
 * `time` is what keeps it in the right place in the server's history and in
 * Last.fm/ListenBrainz instead of piling every trip's music onto the minute
 * the phone found the network. Unlike `scrobble` it lets errors through, so
 * what didn't arrive stays queued.
 */
export async function submitPlay(auth: SubsonicAuth, id: string, at: number): Promise<void> {
  await request(auth, 'scrobble.view', { id, submission: 'true', time: at });
}

/** What playback is doing, for `reportPlayback`. */
export type PlaybackState = 'starting' | 'playing' | 'paused' | 'stopped';

/**
 * Tells the server what playback is doing right now (OpenSubsonic
 * `playbackReport` extension, Navidrome 0.62 and up).
 *
 * `scrobble?submission=false` can only say "this started". The server keeps the
 * entry for whatever is left of the track and never hears about a pause or a
 * stop, so its Now Playing panel runs the song to the end no matter what the
 * phone did: pausing, emptying the queue and closing the app all left it
 * playing. This endpoint carries the state and the position instead.
 *
 * `ignoreScrobble` is not optional. Without it the server registers the listen
 * itself once the track passes its own threshold, on top of the one we send,
 * and the thresholds in the settings (#126) stop meaning anything. Now Playing
 * is updated either way.
 */
export async function reportPlayback(
  auth: SubsonicAuth,
  id: string,
  state: PlaybackState,
  positionSec: number,
): Promise<void> {
  await request(auth, 'reportPlayback.view', {
    mediaId: id,
    mediaType: 'song',
    positionMs: Math.max(0, Math.round(positionSec * 1000)),
    state,
    ignoreScrobble: 'true',
  });
}

export interface RadioStation {
  id: string;
  name: string;
  streamUrl: string;
  homePageUrl?: string;
  /**
   * Station image (OpenSubsonic extension). Navidrome sends it only for
   * stations that actually have one uploaded, so it's often absent. It lives
   * on the server, so every client — and Navidrome's own UI — shows the same.
   */
  coverArt?: string;
}

/** Returns the radio stations saved on the server. */
export async function getRadioStations(
  auth: SubsonicAuth,
): Promise<RadioStation[]> {
  const res = await request<{
    internetRadioStations?: { internetRadioStation?: RadioStation[] };
  }>(auth, 'getInternetRadioStations.view');
  return res.internetRadioStations?.internetRadioStation ?? [];
}

/**
 * Creates an internet radio station on the server. Returns its id if it
 * can be determined: `createInternetRadioStation` doesn't return it (out of
 * spec), so we look up the newly created one by name + URL. Used to attach
 * cover art immediately (which is stored on the device, by id).
 */
export async function createRadioStation(
  auth: SubsonicAuth,
  name: string,
  streamUrl: string,
  homePageUrl?: string,
): Promise<string | undefined> {
  await request(auth, 'createInternetRadioStation.view', {
    name,
    streamUrl,
    homepageUrl: homePageUrl || undefined,
  });
  try {
    const stations = await getRadioStations(auth);
    // From back to front: if there are name+URL duplicates, the last one is
    // the one we just created.
    const match = [...stations].reverse().find((s) => s.name === name && s.streamUrl === streamUrl);
    return match?.id;
  } catch {
    return undefined;
  }
}

/** Edits an existing radio station. */
export async function updateRadioStation(
  auth: SubsonicAuth,
  id: string,
  name: string,
  streamUrl: string,
  homePageUrl?: string,
): Promise<void> {
  await request(auth, 'updateInternetRadioStation.view', {
    id,
    name,
    streamUrl,
    homepageUrl: homePageUrl || undefined,
  });
}

/** Deletes a radio station from the server. */
export async function deleteRadioStation(
  auth: SubsonicAuth,
  id: string,
): Promise<void> {
  await request(auth, 'deleteInternetRadioStation.view', { id });
}

/** Cover art URL. `id` can come from an album, song or playlist. */
/**
 * The sizes covers are asked for, and there are three of them on purpose.
 *
 * The same picture at a different size is a different URL, so it is a separate
 * request, a separate resize on the server, a separate decode and a separate
 * entry in the image cache. The app used to ask for eight: 100 in a row, 200
 * for the tint, 300 in a grid, 500 in an album header, 600 in the player, 1200
 * in the viewer, and 400 and 800 in one place each. One album seen across those
 * screens was six copies of itself.
 *
 * Three tiers, chosen by what they land in at three times density: a row or a
 * small circle, anything card-sized up to the player's full width, and the
 * viewer, which is the picture on its own. `thumb` is also what the palette
 * asks for, so the tint of a list comes from the file the list already has.
 */
export const COVER = { thumb: 200, card: 600, full: 1200 } as const;

export function coverArtUrl(
  auth: SubsonicAuth,
  id: string | undefined,
  size = 300,
): string | undefined {
  if (!id) return undefined;
  return buildUrl(auth, 'getCoverArt.view', { id, size });
}

/** Download URL for the original file, without transcoding. */
export function downloadUrl(auth: SubsonicAuth, id: string): string {
  return buildUrl(auth, 'download.view', { id });
}

/**
 * Song streaming URL. If `maxBitRate` > 0, the server transcodes to that
 * bitrate (kbps) to save data. `format` forces the output codec (e.g.
 * `opus`); empty leaves the server's default transcoder. Only takes effect
 * when actually transcoding (with `maxBitRate` at 0 the server serves the
 * original file and ignores it).
 */
export function streamUrl(
  auth: SubsonicAuth,
  id: string,
  maxBitRate = 0,
  timeOffset = 0,
  format = '',
): string {
  return buildUrl(auth, 'stream.view', {
    id,
    maxBitRate: maxBitRate > 0 ? maxBitRate : undefined,
    format: maxBitRate > 0 && format ? format : undefined,
    // Start transcoding at this second (OpenSubsonic `transcodeOffset`
    // extension): this enables "seeking" in transcoded streams.
    timeOffset: timeOffset > 0 ? Math.floor(timeOffset) : undefined,
  });
}

/** Names of the OpenSubsonic extensions announced by the server. */
export async function getOpenSubsonicExtensions(auth: SubsonicAuth): Promise<string[]> {
  const res = await request<{ openSubsonicExtensions?: { name: string }[] }>(
    auth,
    'getOpenSubsonicExtensions.view',
    {},
  );
  return (res.openSubsonicExtensions ?? []).map((e) => e.name);
}

// ── Jukebox ──────────────────────────────────────────────────────────────────
// Standard Subsonic API `jukeboxControl`: the server plays through its own
// audio hardware (speakers/DAC) and the app acts as a remote control; nothing
// is streamed to the phone. Only Subsonic servers with the jukebox role
// enabled by the admin (see store/jukebox.ts for integration).

export interface JukeboxStatus {
  /** Index of the current track within the server's list. */
  currentIndex: number;
  playing: boolean;
  /** Gain 0..1. */
  gain: number;
  /** Position in seconds within the current track. */
  position: number;
}

function parseJukeboxStatus(raw: unknown): JukeboxStatus {
  const s = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, def: number) => (typeof v === 'number' ? v : def);
  return {
    currentIndex: num(s.currentIndex, 0),
    playing: s.playing === true,
    gain: num(s.gain, 1),
    position: num(s.position, 0),
  };
}

/** `jukeboxControl.view`: returns the status after applying the action. */
async function jukeboxControl(
  auth: SubsonicAuth,
  action: string,
  extra: Record<string, string | number | undefined> = {},
): Promise<JukeboxStatus> {
  const res = await request<{ jukeboxStatus?: unknown; jukeboxPlaylist?: unknown }>(
    auth,
    'jukeboxControl.view',
    { action, ...extra },
  );
  // `get`/`set` respond with jukeboxPlaylist; the rest with jukeboxStatus.
  return parseJukeboxStatus(res.jukeboxStatus ?? res.jukeboxPlaylist);
}

export const jukeboxStatus = (auth: SubsonicAuth) => jukeboxControl(auth, 'status');
/** Replaces the server's playlist with a single track (library id). */
export const jukeboxSet = (auth: SubsonicAuth, id: string) => jukeboxControl(auth, 'set', { id });
export const jukeboxStart = (auth: SubsonicAuth) => jukeboxControl(auth, 'start');
export const jukeboxStop = (auth: SubsonicAuth) => jukeboxControl(auth, 'stop');
/** Skips to the given index (with optional offset in seconds within the track). */
export const jukeboxSkip = (auth: SubsonicAuth, index: number, offsetSec = 0) =>
  jukeboxControl(auth, 'skip', { index, offset: offsetSec > 0 ? Math.floor(offsetSec) : undefined });
export const jukeboxSetGain = (auth: SubsonicAuth, gain: number) =>
  jukeboxControl(auth, 'setGain', { gain: Math.max(0, Math.min(1, gain)) });

/**
 * Does the server allow jukebox mode for this user? Deduced from the
 * `jukeboxRole` returned by `getUser`. Any failure (missing endpoint,
 * non-Subsonic server, no permission) counts as "not available".
 */
export async function hasJukeboxRole(auth: SubsonicAuth): Promise<boolean> {
  try {
    const res = await request<{ user?: { jukeboxRole?: boolean } }>(auth, 'getUser.view', {
      username: auth.username,
    });
    return res.user?.jukeboxRole === true;
  } catch {
    return false;
  }
}

// ── Sharing ─────────────────────────────────────────────────────────────────

/**
 * Public link to a song, album or playlist, created on the server.
 *
 * `expiresAt` is a moment in time (ms since 1970), the only thing the API takes
 * about a share's life. Without it the server decides, which is what happened
 * for everybody until now (Navidrome: `ND_DEFAULTSHAREEXPIRATION`). Whether the
 * link allows downloading is not in the API at all: that one stays the server's
 * business.
 */
export async function createShare(
  auth: SubsonicAuth,
  id: string,
  description?: string,
  expiresAt?: number,
): Promise<{ id: string; url: string }> {
  const res = await request<{ shares?: { share?: { id: string; url?: string }[] } }>(
    auth,
    'createShare.view',
    { id, description, expires: expiresAt ? Math.round(expiresAt) : undefined },
  );
  const share = res.shares?.share?.[0];
  if (!share?.url) throw new SubsonicRequestError('The server did not return a link', false);
  // The id comes back too, and it is what lets Navidrome's own API be asked for
  // the one thing Subsonic left out (see `setShareDownloadable`).
  return { id: share.id, url: share.url };
}

/**
 * Can this user create shares? From the `shareRole` of `getUser`, the same way
 * jukebox is detected. Any failure (endpoint missing, sharing disabled on the
 * server, no permission) counts as "no": better no button than a button that
 * always fails.
 */
export async function hasShareRole(auth: SubsonicAuth): Promise<boolean> {
  try {
    const res = await request<{ user?: { shareRole?: boolean } }>(auth, 'getUser.view', {
      username: auth.username,
    });
    return res.user?.shareRole === true;
  } catch (e) {
    // A server that answered and said no is an answer, and `false` is the right
    // one. A connection that never got there is not, and answering `false` for
    // it is how the share button disappeared for a whole session: the caller
    // caches this forever, since a role does not change while the app is open,
    // and a cached "you cannot share" outlives the hiccup that caused it by
    // hours. There is a window for exactly that, between the server going away
    // and the app noticing (see #126). Thrown instead, so it is a failure that
    // can be tried again rather than a fact.
    if ((e as { network?: boolean })?.network) throw e;
    return false;
  }
}

/**
 * A podcast, the way this app has one.
 *
 * The Subsonic API defines a podcast channel too, and nothing here is
 * particular to feeds: the difference is only in where a row comes from. It
 * lives in this file, with `Song` and `Album`, because this is where the
 * shapes the rest of the app knows by name are written down, not because
 * something fetches it — see `api/podcasts.ts` for why the server is not
 * asked.
 */
export interface PodcastChannel {
  /** `hash(feed url)`. Stable, and never a server id: see `api/podcasts.ts`. */
  id: string;
  title: string;
  description?: string;
  author?: string;
  imageUrl?: string;
  /** The channel's own web page, not the feed file. */
  siteUrl?: string;
  /** The feed this was read from. Absent for a channel read another way. */
  feedUrl?: string;
  /** How many episodes are stored, which the list screen shows. */
  episodeCount?: number;
  /** When the newest stored episode was published. */
  lastPublishedAt?: number;
  /** When this channel was last read, which is the list's "updated" column. */
  refreshedAt?: number;
  /**
   * Why the last read failed, when it did. Kept on the channel rather than
   * thrown, because a feed that stopped resolving must not take the other
   * subscriptions' screens down with it, and because "this one is stale" is
   * something the channel list has to be able to say.
   */
  error?: string;
}

/** One episode of a podcast. */
export interface PodcastEpisode {
  /** Namespaced by its channel, so two feeds cannot collide on a `guid`. */
  id: string;
  channelId: string;
  title: string;
  description?: string;
  /** Publication date, in ms since the epoch. */
  publishedAt?: number;
  /** Seconds. */
  duration?: number;
  /**
   * Where the audio is, and the reason the player needed no new code: it is
   * handed to the engine as a `Song.url` stream like any other.
   */
  url?: string;
  mimeType?: string;
  size?: number;
  imageUrl?: string;
}
