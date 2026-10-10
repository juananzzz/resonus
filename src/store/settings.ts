/** App settings (persisted): streaming quality and language. */
import { Platform } from 'react-native';
import { create } from 'zustand';

import { isLanguage, LANGUAGE_NAMES, type Language } from '@/i18n/languages';
import { pushArtworkEncodeFps } from '@/lib/artworkEncode';
import { type TabSegment } from '@/lib/tabOrigin';
import { hashKey } from '@/lib/localLibrary';
import { setPerfEnabled } from '@/lib/perfLog';
import { profileScopeGuard } from '@/lib/profileScope';
import { queryClient } from '@/lib/query';
import { getItem, setItem } from '@/lib/storage';
import {
  applyAccents,
  applyBackgroundTint,
  applyPureBlack,
  BACKGROUND_TINTS,
  applyThemePreference,
  applyThemeSchedule,
  DEFAULT_ACCENT,
  isThemePreference,
  type BackgroundTint,
  type ThemeMode,
  type ThemePreference,
} from '@/theme';
import { profileScopeId, useAuthStore } from './auth';

// The field is named `color` (not `value`) on purpose: Reanimated warns
// excessively when it sees any `.value` inside an inline style, even if it's
// not a shared value. Using `color` avoids that false positive in the Theme
// picker.
/** Selectable accent colors (same vibrant palette; green by default). */
export const ACCENT_OPTIONS: { name: string; color: string }[] = [
  // Sorted by hue (rainbow), with the default green first.
  { name: 'Green', color: DEFAULT_ACCENT },
  { name: 'Teal', color: '#1FC7B6' },
  { name: 'Cyan', color: '#2CC4E0' },
  { name: 'Blue', color: '#4E9BF5' },
  { name: 'Indigo', color: '#6C79F5' },
  { name: 'Purple', color: '#A66CFF' },
  { name: 'Magenta', color: '#D65AE0' },
  { name: 'Pink', color: '#F25D94' },
  { name: 'Red', color: '#F2555A' },
  { name: 'Orange', color: '#F58C3C' },
  { name: 'Yellow', color: '#F5C53C' },
  { name: 'Lime', color: '#A6D93C' },
  // After the rainbow, having no hue: a silver with the same touch of blue as
  // the dark greys.
  { name: 'Gray', color: '#C3C8D2' },
];

// Base settings key. Settings are PER PROFILE: each one stores under
// `resonus.settings.<profile id>`. The bare base key (`resonus.settings`)
// is the old (shared) version; it is used as a fallback/migration: a profile
// without its own settings still inherits the old ones until something changes.
const STORAGE_KEY = 'resonus.settings';
// Language is GLOBAL (app-wide, not per profile): with the reset on profile
// switch, making it per-profile would set English on every new account.
const LANG_KEY = 'resonus.language';

/** Settings key for the active profile (server, local, or none). The id is
 *  hashed: SecureStore only accepts [A-Za-z0-9._-] and the URL contains `:`, `/`, `|`. */
function settingsKey(): string {
  return `${STORAGE_KEY}.${hashKey(profileScopeId())}`;
}

/**
 * 0 = original quality (no transcoding); the rest is bitrate in kbps.
 *
 * `Original` is the only label that is a word rather than a number, so it is
 * the only one that needs translating; it stays in English here because that is
 * the translation key, and the screens run it through `t()`.
 */
export const BITRATE_OPTIONS = [
  { label: 'Original', value: 0 },
  { label: '320 kbps', value: 320 },
  { label: '256 kbps', value: 256 },
  { label: '192 kbps', value: 192 },
  { label: '160 kbps', value: 160 },
  { label: '128 kbps', value: 128 },
  { label: '96 kbps', value: 96 },
  { label: '64 kbps', value: 64 },
] as const;

/**
 * How many songs may be downloading at once. Three was what the app did before
 * anybody could choose, and on a small server transcoding each one it was too
 * much; two still overlaps one transfer with the next.
 */
export const DOWNLOAD_CONCURRENCY_OPTIONS = [1, 2, 3];

/**
 * The fps animated covers encode at for the lock screen. 30 is the default:
 * half the frames of 60 for a cover that reads the same, and half the work
 * for a phone that is already doing plenty. 60 is there for whoever wants
 * the smoother clip. The native side refuses anything above Apple's own 60.
 */
export const ANIMATED_ARTWORK_FPS_OPTIONS = [30, 60] as const;

/** How many radios Home offers. */
export const RADIO_COUNT_OPTIONS = [3, 6, 9] as const;

/**
 * Codec to request for transcoding (Subsonic `format` parameter).
 * '' = the server's default transcoder (MP3 on Navidrome). Only relevant
 * when a bitrate is selected (with "Original" the raw file is served).
 */
export type TranscodeFormat = '' | 'mp3' | 'opus' | 'aac';

/** Codec selector options. Codec labels are proper names; the "default" one
 *  is translated on each screen with `t('Server default')`. */
export const TRANSCODE_FORMATS: TranscodeFormat[] = ['', 'mp3', 'opus', 'aac'];

/** Size limits offered for the cache of played songs, in GB (#180). */
export const SONG_CACHE_LIMITS_GB = [1, 2, 4, 8, 16, 32, 64];

/** Ceilings for the two scrobble rules, so the sliders and the stored values
 *  agree on what is a number somebody could have meant. */
export const SCROBBLE_SECONDS_MAX = 600;

/** What both services call a listen, and what the app did when that was the
 *  only thing it could do. Named because three places have to agree on them:
 *  the defaults, what a stored file falls back to, and the button that puts
 *  them back. */
export const SCROBBLE_PERCENT_DEFAULT = 50;
export const SCROBBLE_SECONDS_DEFAULT = 240;

/**
 * How far into a song a listen counts, in seconds, or null for "never".
 *
 * Two rules, either of which can be off (0), and the earlier one wins: a share
 * of the song, which needs a duration to mean anything, and a flat time, which
 * does not. Off, or on with a duration nobody knows, a rule simply does not
 * apply; with neither applying there is nothing to cross and the song is not
 * scrobbled at all.
 *
 * The defaults (50% and 4 minutes) are what Last.fm and ListenBrainz call a
 * listen, and they are only defaults: neither service can check the rule from
 * its side, since what reaches them is the scrobble and never the position it
 * was sent at, so what this returns is the whole of what decides (#126).
 */
export function scrobbleThresholdSec(
  durationSec: number,
  percent: number,
  seconds: number,
): number | null {
  const rules: number[] = [];
  if (percent > 0 && durationSec > 0) rules.push((durationSec * percent) / 100);
  if (seconds > 0) rules.push(seconds);
  return rules.length ? Math.min(...rules) : null;
}

// Languages live in a single place (`src/i18n/languages.ts`): adding one is
// a single line there. Re-exported here to avoid breaking existing imports.
export { isLanguage, LANGUAGE_NAMES };
export type { Language };

/** Library sort order, Spotify style. */
export type LibrarySort = 'recent' | 'added' | 'alpha';

/** Collection layout: list (rows) or grid (cards). */
export type ListLayout = 'list' | 'grid';

/**
 * Grids whose density can be chosen, one key per screen (#109).
 *
 * Per screen and not one number for the whole app, because the app does not
 * have one grid: Library and Artists have always been three across and the
 * rest two, and a single shared setting would have had to make one half of
 * them wrong on the day it arrived. What is shared is the machinery.
 */
export type GridKey =
  | 'genres'
  | 'library'
  | 'browseArtists'
  | 'browseAlbums'
  | 'browsePlaylists'
  | 'browseSongs'
  | 'discography'
  | 'genre';

/**
 * How a grid is remembered on a big screen, which is not the same answer.
 *
 * Three columns is a comfortable phone grid and a wall of stamps across a
 * tablet, and the number that is right there is right nowhere else, so the two
 * are stored apart: the choice made on a phone survives being taken to a
 * tablet and back (#131).
 */
export type GridSizeKey = GridKey | `${GridKey}:wide`;

/** Exactly what each grid looked like before it could be chosen, so nothing
 *  moves for anybody who never opens the menu. */
export const GRID_DEFAULT_COLUMNS: Record<GridKey, number> = {
  genres: 2,
  library: 3,
  browseArtists: 3,
  browseAlbums: 2,
  browsePlaylists: 2,
  browseSongs: 2,
  discography: 2,
  genre: 2,
};

/** What the menu offers. Two is a poster, four is about as far as a cover can
 *  shrink on a phone and still be a picture of something. */
export const GRID_COLUMN_CHOICES = [2, 3, 4];

/** And on a tablet, where two columns are two covers the size of a hand. What
 *  it opens on is worked out from the width; these are the ways around it. */
export const WIDE_COLUMN_CHOICES = [3, 4, 5, 6];

/**
 * How long a shared link lives: `never`, or a span from the moment the link is
 * made. `never` is a date far enough away to mean it, because the API has no
 * way to say "no expiry" and every value it does understand that looks like one
 * (nothing, zero, a negative) is read as "use your default".
 *
 * Letting the server's own default through was an option here at first and is
 * gone: nobody but the person running the server knows what it is, and they
 * would have to remember. What the sheet offers now, it can also state.
 *
 * An exact date is not one of these: it is picked in the sheet and belongs to
 * that one link, so there is nothing worth remembering about it.
 */
export type ShareExpiry = 'hour' | 'day' | 'week' | 'month' | 'never';

/** The ones above, in the order the sheet offers them: the spans shortest
 *  first, and then the one that is not a span. */
export const SHARE_EXPIRIES: ShareExpiry[] = ['hour', 'day', 'week', 'month', 'never'];

/**
 * Maximum length of the Home custom greeting. It easily fits in one line next
 * to the right-side buttons; exceeding that would push them out. It's a sanity
 * cap, not a guarantee: the font is user-chosen and "WWWW" takes much more
 * space than "iiii", so the greeting also self-truncates (see Home).
 */
export const GREETING_MAX = 15;

/**
 * Volume normalization using ReplayGain tags from files.
 * `auto` = Spotify style: per album when listening to a full album (preserves
 * its internal dynamics) and per track in playlists/shuffle.
 */
export type ReplayGainMode = 'off' | 'auto' | 'track' | 'album';

/**
 * How far the ReplayGain pre-amp reaches, in dB either way. ReplayGain aims at
 * -18 LUFS and other players (Spotify and company) at -14, so whoever normalizes
 * ends up quieter than everything else on the phone; the pre-amp buys that
 * difference back. Ten dB is well past the four or five anyone actually needs
 * and short of the range where a slip leaves the music unusable.
 */
export const REPLAY_GAIN_PREAMP_LIMIT = 10;

/** Pre-amp inside its range, in tenths of a dB (the finest the pad moves). */
export function clampReplayGainPreamp(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const step = Math.round(db * 10) / 10;
  return Math.min(Math.max(step, -REPLAY_GAIN_PREAMP_LIMIT), REPLAY_GAIN_PREAMP_LIMIT);
}

/**
 * UI font. On Android these are system font families (no packaging or download
 * cost); on iOS the equivalent built-in families are used. `system` leaves the
 * default font (Roboto / San Francisco). `custom` loads a user-picked font
 * file at runtime.
 */
export type AppFont = 'system' | 'condensed' | 'serif' | 'monospace' | 'casual' | 'custom';

/**
 * Backdrop for the player and the lyrics screen: flat dark, tinted with the
 * cover's dominant color, or the cover art itself blurred behind everything.
 * They're mutually exclusive, which is why this replaced the old
 * `playerColorBackground` / `lyricsColorBackground` booleans.
 */
export type ScreenBackground = 'none' | 'color' | 'cover';

/**
 * Backdrop for the lyrics card under the player controls. No 'cover' here: its
 * background doubles as the solid colour the synced lyrics fade into, which an
 * image can't provide.
 */
export type CardBackground = 'none' | 'color';

/**
 * What fills the navigation bar: the page colour it has always had, or black
 * fading out at the top edge, so the bar has no edge to show against whatever
 * scrolls under it. Gradient wins over the blur, and the blur setting does
 * nothing while it is on.
 */
export type NavBarStyle = 'solid' | 'gradient';

/**
 * What tapping the cover in the player does.
 *
 * One tap and two draw from the same list. Which action belongs on which is
 * nobody's business but the listener's: wanting play/pause on the single tap
 * and the lyrics on the double is as reasonable as the other way round, and
 * splitting the lists only made half of each unreachable.
 */
export const COVER_TAP_ACTIONS = [
  'none',
  'screen',
  'inline',
  'playPause',
  'favorite',
  'album',
] as const;

/**
 * Derived from the list above rather than written out beside it, which is the
 * one thing that keeps the two from disagreeing.
 *
 * They did. The loader used to spell out which values it would accept, three
 * each and different threes, because the two settings once had separate lists
 * and those were the halves. Merging the lists left the loader with the old
 * ones, so a single tap saved as `album` was refused on the way back in and
 * came up as `screen`: pick "Go to album", reopen the app, and it says "Open
 * lyrics screen". The double tap had it worse and nobody noticed, since
 * everything but play/pause and favourite fell back to `none` and turned the
 * gesture off.
 */
export type CoverTapAction = (typeof COVER_TAP_ACTIONS)[number];

/** Whether a value off the disk is one of them. */
export function isCoverTapAction(value: unknown): value is CoverTapAction {
  return COVER_TAP_ACTIONS.includes(value as CoverTapAction);
}

/**
 * What tapping the cover twice does (#156). The same list as one tap.
 *
 * Off by default, and not only out of caution: with this on, a single tap has
 * to wait to find out whether a second one is coming, so the tap that is
 * already there gets slower for everybody who turns this on. That is a price
 * worth asking about rather than charging.
 */
export type CoverDoubleTapAction = CoverTapAction;

/**
 * Where lyrics come from:
 * - 'local':  prefer server / .lrc / USLT, fall back to LRCLIB online.
 * - 'online': prefer LRCLIB online search, fall back to local.
 * - 'off':    never search LRCLIB (local / server only).
 * 'local' and 'online' send the artist and title to an external service (LRCLIB).
 */
export type LyricsSource = 'local' | 'online' | 'off';

/** Adjustable type size shared by every lyrics surface. */
export type LyricsSize = number;
export const LYRICS_SIZE_MIN = 20;
export const LYRICS_SIZE_DEFAULT = 28;
export const LYRICS_SIZE_MAX = 40;

/** Keep imported settings and programmatic callers inside the slider's range. */
export function clampLyricsSize(value: number): LyricsSize {
  if (!Number.isFinite(value)) return LYRICS_SIZE_DEFAULT;
  return Math.min(LYRICS_SIZE_MAX, Math.max(LYRICS_SIZE_MIN, Math.round(value)));
}

/** Font weights Android and iOS can both synthesize consistently. */
export const LYRICS_WEIGHTS = ['300', '400', '500', '600', '700'] as const;
export type LyricsWeight = (typeof LYRICS_WEIGHTS)[number];
export type LyricsAlign = 'left' | 'center';
/** What sits next to play on the mini player. */
export type MiniPlayerButtons = 'favorite' | 'next' | 'previousNext' | 'none';
/** The corners of the cover art in the player. */
export type CoverCorners = 'square' | 'rounded' | 'round';

/**
 * When a song that is downloaded plays from the file instead of the server.
 *
 * 'always' is what the app always did, and what most people want: a download
 * exists so it does not have to be fetched again. The rest are for libraries
 * downloaded at a lower quality than they are served at, where the file is a
 * convenience rather than the best copy. Offline none of it applies: the file
 * is the only thing there is.
 */
export type PreferDownloads = 'always' | 'cellular' | 'original' | 'never';

/** Tab the app starts on (and returns to after being in the background for a
 *  while). Matches the `(tabs)` route names. */
export type DefaultTab = 'index' | 'search' | 'library' | 'explore';

/** "Previous" button behavior: restart the track after a few seconds (default,
 *  like Spotify) or always go to the previous track (like YouTube). */
export type PreviousButtonMode = 'restart' | 'always';

/** Action when swiping a song right in lists (customizable). */
export type SwipeAction = 'off' | 'queue' | 'next' | 'favorite' | 'menu';

/** Home section row. `recentlyPlayed` and `discover` are server-only; `discover`
 *  rediscovers albums played long ago; `randomAlbums`/`randomArtists`
 *  are purely random. `newReleases` is by the year on the tags, which is a
 *  different list from `recentlyAdded`: that one is when the server got it. */
export type HomeSectionKey =
  | 'recentlyAdded'
  | 'newReleases'
  | 'recentlyPlayed'
  | 'mostPlayed'
  | 'mostPlayedSongs'
  | 'randomSongs'
  | 'discover'
  | 'radios'
  | 'playlists'
  | 'podcasts'
  | 'randomAlbums'
  | 'randomArtists';

/** Home section with its state (order is determined by its position in the list). */
export interface HomeSection {
  key: HomeSectionKey;
  enabled: boolean;
}

const HOME_SECTION_KEYS: HomeSectionKey[] = [
  'recentlyAdded',
  'newReleases',
  'recentlyPlayed',
  'mostPlayed',
  'mostPlayedSongs',
  'randomSongs',
  'discover',
  'radios',
  'playlists',
  'podcasts',
  'randomAlbums',
  'randomArtists',
];

/**
 * Default order and state: all of them on.
 *
 * Five of these used to start off, to keep Home short. It kept them secret
 * instead: a section nobody has seen is a section nobody knows to look for in
 * the settings, and the ones held back were the discoveries (random albums and
 * artists, new releases) rather than the obvious lists. Showing everything and
 * letting Home be scrolled is the way round somebody can act on, since turning
 * one off is a switch away and turning on a row you have never heard of is not.
 *
 * A section that is off is not drawn and asks the server nothing (see Home's
 * own `if (!s.enabled) return null`), so this is nine requests on a first run
 * where it used to be four. Which is also the only cost of it.
 */
export const DEFAULT_HOME_SECTIONS: HomeSection[] = [
  { key: 'discover', enabled: true },
  // The personalised artist radios, built from this server's play counts.
  { key: 'radios', enabled: true },
  { key: 'playlists', enabled: true },
  // Draws nothing without a subscription, so it costs nobody a row.
  { key: 'podcasts', enabled: true },
  { key: 'recentlyAdded', enabled: true },
  { key: 'newReleases', enabled: true },
  { key: 'recentlyPlayed', enabled: true },
  { key: 'mostPlayed', enabled: true },
  { key: 'mostPlayedSongs', enabled: true },
  { key: 'randomSongs', enabled: true },
  { key: 'randomAlbums', enabled: true },
  { key: 'randomArtists', enabled: true },
];

/**
 * Same as the Home chips: keeps the saved order and state, drops what it does
 * not know, and appends anything a later version added.
 *
 * A string where an entry should be is the shape this setting had before it
 * had switches, and it means on: somebody who ordered their chips keeps that
 * order and loses nothing by the upgrade.
 */
function normalizeExploreSections(raw: unknown): ExploreSection[] {
  if (!Array.isArray(raw)) return DEFAULT_EXPLORE_SECTIONS.map((s) => ({ ...s }));
  const seen = new Set<ExploreSectionKey>();
  const out: ExploreSection[] = [];
  for (const item of raw) {
    const key = (typeof item === 'string' ? item : item?.key) as ExploreSectionKey;
    if (!EXPLORE_SECTION_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    const enabled = typeof item === 'string' ? true : item?.enabled;
    out.push({ key, enabled: typeof enabled === 'boolean' ? enabled : true });
  }
  for (const def of DEFAULT_EXPLORE_SECTIONS) {
    if (!seen.has(def.key)) out.push({ ...def });
  }
  return out;
}

/**
 * Sanitizes the saved list: preserves user order and state, discards unknown
 * keys, and appends new sections not present (so a future version with more
 * sections doesn't break existing config).
 */
function normalizeHomeSections(raw: unknown): HomeSection[] {
  if (!Array.isArray(raw)) return DEFAULT_HOME_SECTIONS.map((s) => ({ ...s }));
  const seen = new Set<HomeSectionKey>();
  const out: HomeSection[] = [];
  for (const item of raw) {
    const key = item?.key as HomeSectionKey;
    if (HOME_SECTION_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key);
      out.push({ key, enabled: typeof item.enabled === 'boolean' ? item.enabled : true });
    }
  }
  for (const def of DEFAULT_HOME_SECTIONS) {
    if (!seen.has(def.key)) out.push({ ...def });
  }
  return out;
}

/** One of the chips in the row at the top of Home. `genres` and `radio`
 *  are server-only; `podcasts` is the phone's own. */
export type HomeChipKey =
  | 'shuffle'
  | 'favorites'
  | 'albums'
  | 'artists'
  | 'songs'
  | 'genres'
  | 'podcasts'
  | 'radio'
  | 'history';

/** Chip with its state (order is determined by its position in the list). */
export interface HomeChip {
  key: HomeChipKey;
  enabled: boolean;
}

const HOME_CHIP_KEYS: HomeChipKey[] = [
  'shuffle',
  'favorites',
  'albums',
  'artists',
  'songs',
  'genres',
  'podcasts',
  'radio',
  'history',
];

/** Default order and state: the usual ones, all hidden until
 *  someone turns them on. */
export const DEFAULT_HOME_CHIPS: HomeChip[] = [
  { key: 'shuffle', enabled: false },
  { key: 'favorites', enabled: false },
  { key: 'history', enabled: false },
  { key: 'albums', enabled: false },
  { key: 'artists', enabled: false },
  { key: 'songs', enabled: false },
  { key: 'genres', enabled: false },
  { key: 'podcasts', enabled: false },
  { key: 'radio', enabled: false },
];

/** One of the pills at the top of Explore. `genres`, `radio` and `folders`
 *  need a server; the rest the local catalogue answers for too. */
export type ExploreSectionKey =
  | 'playlists'
  | 'albums'
  | 'artists'
  | 'songs'
  | 'genres'
  | 'radio'
  | 'podcasts'
  | 'folders';

/** A section with its state, the shape the Home chips already have (order is
 *  its position in the list). */
export interface ExploreSection {
  key: ExploreSectionKey;
  enabled: boolean;
}

const EXPLORE_SECTION_KEYS: ExploreSectionKey[] = [
  'playlists',
  'albums',
  'artists',
  'songs',
  'genres',
  'radio',
  'podcasts',
  'folders',
];

/**
 * Their order and their state, all of them on.
 *
 * This was the order and nothing else for a while, on the grounds that a
 * section turned off is a part of the catalogue with no way in. Which is true
 * and is not the whole of it: a chip for a way of browsing somebody never uses
 * is a chip in the way, and the one thing the tab is for is picking. So the
 * switches are here, and what keeps the reasoning is the floor under them,
 * since the last one cannot be turned off (see the settings screen).
 */
export const DEFAULT_EXPLORE_SECTIONS: ExploreSection[] = EXPLORE_SECTION_KEYS.map((key) => ({
  key,
  enabled: true,
}));

/**
 * The bar at the bottom: which tabs are on it and in what order.
 *
 * Same shape as the Home chips, and for the same reason — it is a list the
 * user rearranges — but with one rule they do not have: **Home cannot be
 * turned off**. The chips can all go and the row simply disappears; a bar with
 * nothing on it is an app with no way out of wherever you are standing.
 */
export interface BottomTab {
  key: TabSegment;
  enabled: boolean;
}

const BOTTOM_TAB_KEYS: TabSegment[] = ['index', 'search', 'library', 'explore', 'options'];

/**
 * The order they start in, all of them on.
 *
 * "Your library" goes last, behind Explore. It used to sit third, from when it
 * was the only way to a playlist; Explore now holds those as well as the rest
 * of the catalogue, so it is the one being reached for, and what is left over
 * there is the smaller, more personal half.
 */
export const DEFAULT_BOTTOM_TABS: BottomTab[] = [
  { key: 'index', enabled: true },
  { key: 'search', enabled: true },
  { key: 'explore', enabled: true },
  { key: 'library', enabled: true },
  // Settings, for whoever goes there often enough to want it one tap away. Off:
  // the gear on Home already leads there.
  { key: 'options', enabled: false },
];

/** The same sanitising the chips get, plus Home's exemption. */
function normalizeBottomTabs(raw: unknown): BottomTab[] {
  if (!Array.isArray(raw)) return DEFAULT_BOTTOM_TABS.map((t) => ({ ...t }));
  const seen = new Set<TabSegment>();
  const out: BottomTab[] = [];
  for (const item of raw) {
    const key = item?.key as TabSegment;
    if (BOTTOM_TAB_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key);
      out.push({
        key,
        enabled: key === 'index' ? true : typeof item.enabled === 'boolean' ? item.enabled : true,
      });
    }
  }
  // A tab added by a later version arrives on, at the end, rather than the
  // update quietly hiding something new.
  for (const def of DEFAULT_BOTTOM_TABS) {
    if (!seen.has(def.key)) out.push({ ...def });
  }
  return out;
}

/**
 * The buttons at the top right of Home, in the order they sit there.
 *
 * A draggable list like the tabs and the chips, and with the tabs' exemption
 * rather than the chips' freedom: **the gear cannot be turned off**. Settings
 * is only reachable from there, so hiding it would leave no way back to this
 * very screen.
 */
export type HomeButtonKey = 'queue' | 'search' | 'history' | 'settings';

export interface HomeButton {
  key: HomeButtonKey;
  enabled: boolean;
}

const HOME_BUTTON_KEYS: HomeButtonKey[] = ['queue', 'search', 'history', 'settings'];

/**
 * Left to right as they shipped.
 *
 * Search starts off. Searching already has a tab of its own at the bottom, and
 * a second way in at the top of Home is a duplicate for most people; it is
 * there for whoever takes that tab off the bar, or just prefers it up here.
 */
export const DEFAULT_HOME_BUTTONS: HomeButton[] = [
  // Off: the player and the mini player already lead there. For whoever hides
  // the player's buttons and wants it a tap from Home (#248).
  { key: 'queue', enabled: false },
  { key: 'search', enabled: true },
  { key: 'history', enabled: true },
  { key: 'settings', enabled: true },
];

/** The row of buttons under the player's controls, in order. */
export type PlayerButtonKey = 'devices' | 'lyrics' | 'speed' | 'sleep' | 'queue';

export interface PlayerButton {
  key: PlayerButtonKey;
  enabled: boolean;
}

/**
 * Devices and queue on, the rest off: lyrics have their card and the ⋯ menu,
 * the sleep timer the ⋯ menu, and speed is for the few who turn it on.
 */
export const DEFAULT_PLAYER_BUTTONS: PlayerButton[] = [
  { key: 'devices', enabled: true },
  { key: 'lyrics', enabled: false },
  { key: 'speed', enabled: false },
  { key: 'sleep', enabled: false },
  { key: 'queue', enabled: true },
];

/** Grouped in the middle, or spread across the width with equal gaps. */
export type PlayerButtonsLayout = 'centered' | 'spread';

/** Saved order kept, unknown keys dropped, new ones added at the end. */
function normalizePlayerButtons(raw: unknown): PlayerButton[] {
  if (!Array.isArray(raw)) return DEFAULT_PLAYER_BUTTONS.map((b) => ({ ...b }));
  const known = new Set(DEFAULT_PLAYER_BUTTONS.map((b) => b.key));
  const seen = new Set<PlayerButtonKey>();
  const out: PlayerButton[] = [];
  for (const item of raw) {
    const key = item?.key as PlayerButtonKey;
    if (known.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push({ key, enabled: typeof item.enabled === 'boolean' ? item.enabled : true });
    }
  }
  for (const def of DEFAULT_PLAYER_BUTTONS) {
    if (!seen.has(def.key)) out.push({ ...def });
  }
  return out;
}

/** The same sanitising as the tabs, with the gear in Home's place. */
function normalizeHomeButtons(raw: unknown): HomeButton[] {
  if (!Array.isArray(raw)) return DEFAULT_HOME_BUTTONS.map((b) => ({ ...b }));
  const seen = new Set<HomeButtonKey>();
  const out: HomeButton[] = [];
  for (const item of raw) {
    const key = item?.key as HomeButtonKey;
    if (HOME_BUTTON_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key);
      out.push({
        key,
        enabled:
          key === 'settings' ? true : typeof item.enabled === 'boolean' ? item.enabled : true,
      });
    }
  }
  for (const def of DEFAULT_HOME_BUTTONS) {
    if (!seen.has(def.key)) out.push({ ...def });
  }
  return out;
}

/**
 * Sanitizes the saved list: preserves user order and state, discards unknown
 * keys, and appends new chips not present (so a future version with more chips
 * doesn't break existing config).
 */
function normalizeHomeChips(raw: unknown): HomeChip[] {
  if (!Array.isArray(raw)) return DEFAULT_HOME_CHIPS.map((c) => ({ ...c }));
  const seen = new Set<HomeChipKey>();
  const out: HomeChip[] = [];
  for (const item of raw) {
    const key = item?.key as HomeChipKey;
    if (HOME_CHIP_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key);
      out.push({ key, enabled: typeof item.enabled === 'boolean' ? item.enabled : true });
    }
  }
  for (const def of DEFAULT_HOME_CHIPS) {
    if (!seen.has(def.key)) out.push({ ...def });
  }
  return out;
}


/** Display name for each font (proper names: not translated). */
export const APP_FONT_LABELS: Record<AppFont, string> = {
  system: 'Roboto',
  condensed: 'Condensed',
  serif: 'Serif',
  monospace: 'Monospace',
  casual: 'Casual',
  custom: 'Custom',
};

/**
 * Actual font family for each option; `undefined` = system default font.
 *
 * On Android the families are AOSP system fonts. On iOS the equivalent
 * built-in families are used instead, because Android names like
 * `sans-serif-condensed` are not recognised by CoreText.
 */
export const APP_FONT_FAMILY: Record<Exclude<AppFont, 'custom'>, string | undefined> = Platform.select({
  ios: {
    system: undefined,
    condensed: 'Helvetica Neue',
    serif: 'Georgia',
    monospace: 'Menlo',
    casual: 'Futura',
  },
  default: {
    system: undefined,
    condensed: 'sans-serif-condensed',
    serif: 'serif',
    monospace: 'monospace',
    casual: 'casual',
  },
});

/** Everything that is saved per profile: all of `DEFAULTS` but the language,
 *  which is global (see LANG_KEY). */
type Persisted = Omit<typeof DEFAULTS, 'language'>;
type PersistedKey = keyof Persisted;
/** Saved settings whose stored shape has changed, so hydrating reads them as
 *  anything and checks. */
type Reshaped =
  | 'showAudioQuality'
  | 'lyricsSize'
  | 'homeSections'
  | 'homeChips'
  | 'exploreSections'
  | 'bottomTabs'
  | 'homeButtons'
  | 'playerButtons';

/**
 * `setX(value)` for every saved setting: stores it and saves the profile.
 * Settings that need more than that (side effects, clamping, a key inside a
 * list) define their own setter, which replaces the generated one.
 */
type AutoSetters = {
  [K in PersistedKey as `set${Capitalize<K>}`]: (value: Persisted[K]) => void;
};

/** The generated setters that a hand-written one replaces with another shape. */
type CustomSetter =
  | 'setDiagnostics'
  | 'setLyricsSize'
  | 'setHideUnavailableOffline'
  | 'setReplayGainPreampDb'
  | 'setCustomGreeting'
  | 'setGridColumns'
  | 'setAccentColor'
  | 'setThemeMode'
  | 'setThemeLightFrom'
  | 'setThemeDarkFrom'
  | 'setPureBlack'
  | 'setAnimatedArtworkFps'
  | 'setBackgroundTint';

interface SettingsState extends Omit<AutoSetters, CustomSetter> {
  /** Streaming quality over Wi-Fi (and any non-cellular network). */
  maxBitRate: number;
  /** Streaming quality over cellular. */
  maxBitRateCellular: number;
  /** Download quality: 0 = original file; rest, transcoded bitrate. */
  downloadBitRate: number;
  /**
   * Songs fetched at the same time, across the whole app. Each one can be a
   * transcode the server has to run, so this is as much a limit on the server
   * as on the phone (#83).
   */
  downloadConcurrency: number;
  /** Streaming transcode codec over Wi-Fi ('' = server default). */
  streamFormat: TranscodeFormat;
  /** Streaming transcode codec over cellular ('' = server default). */
  streamFormatCellular: TranscodeFormat;
  /** Download transcode codec ('' = server default). */
  downloadFormat: TranscodeFormat;
  /** Download only over Wi-Fi (blocks downloads on cellular). */
  downloadWifiOnly: boolean;
  /** Streaming: lossy files are sent as they are, only lossless ones are
   *  transcoded (#216). */
  streamLosslessOnly: boolean;
  /** The same for downloads. */
  downloadLosslessOnly: boolean;
  /** Keep a copy of streamed songs on the phone, evicted by size (#180). */
  songCache: boolean;
  /** Ceiling of that cache, in GB. */
  songCacheLimitGb: number;
  language: Language;
  /** Show format/bitrate/Hi-Res label (player only). */
  showAudioQuality: boolean;
  /** Star rating bar for the current song in the player. */
  showRating: boolean;
  /** Show album and year below title/artist in the player. */
  showAlbumInfo: boolean;
  /**
   * Swap the player's ⋯ menu and favorite button: the menu next to the title
   * and the heart in the top bar. The top-right corner is the hardest spot to
   * reach one-handed, and the menu gets used more often than the heart (which
   * still shows the state up there, and can still toggle from inside the menu).
   */
  swapPlayerButtons: boolean;
  /**
   * Show the tracks before the current one in the queue (dimmed, tappable).
   * The key still says "played" for historical reasons: they are simply the
   * ones behind the cursor, which after jumping forward includes skipped ones.
   */
  showPlayedInQueue: boolean;
  /** Show mini album cover in lists (playlists/favorites). */
  showListArtwork: boolean;
  /** Show a playlist's or an album's description under its name. */
  showPlaylistDescription: boolean;
  /** Keep the navigation bar on every screen, not only on the tabs. */
  alwaysShowTabs: boolean;
  /** Blur what scrolls under the navigation bar. */
  blurBars: boolean;
  /** What the navigation bar is filled with: flat, or fading out at the top. */
  navBarStyle: NavBarStyle;
  /** Blur what scrolls under the mini player. */
  blurMiniPlayer: boolean;
  /** Song duration in lists (Spotify doesn't show it). */
  showSongDuration: boolean;
  /** Rating stars per song in lists. */
  showListRating: boolean;
  /**
   * The E badge on anything tagged with a parental advisory. One switch and not
   * one per screen: it is the same mark wherever it appears, and whoever wants
   * it out of a list does not want it on the player either. The song
   * information sheet still spells it out, the way it spells out everything
   * else about a file whether or not it is drawn anywhere.
   */
  showExplicitTag: boolean;
  /** When the queue ends, continue with similar songs (getSimilarSongs2). */
  autoplaySimilar: boolean;
  /**
   * The artist radios at all. Off, nothing is built or asked for: no shelf on
   * Home, no radio in the menus, no round added at the end of one.
   */
  radiosEnabled: boolean;
  /** How many radios Home offers (`RADIO_COUNT_OPTIONS`). */
  radioCount: number;
  /** A radio draws another round when its songs run out. */
  radioEndless: boolean;
  /**
   * Whether the app measures itself (Settings › About → Diagnostics). On for
   * everybody, since a report from the phone with the problem is worth more
   * than the little it costs, and off for whoever is chasing that problem and
   * wants the measuring out of the way first.
   */
  diagnostics: boolean;
  /**
   * Whether to ask GitHub, once a day, if there is a newer release.
   *
   * On, unlike everything else that reaches the network on its own. The app is
   * not on a store and there is nothing to tell somebody a version came out:
   * off by default would leave the check to the people who already knew where
   * to look, who are exactly the ones who did not need it.
   */
  updateCheck: boolean;
  /** Crossfade seconds between songs (0 = disabled). */
  crossfadeSec: number;
  /**
   * The two scrobble rules, in percent of the song and in seconds, each 0 when
   * it is off (see `scrobbleThresholdSec`). Both off means nothing is ever
   * scrobbled, which is a thing somebody may well want and the reason neither
   * has a floor of its own.
   */
  scrobblePercent: number;
  scrobbleSeconds: number;
  /**
   * Pre-warm the stream for upcoming tracks in the queue. Designed for proxies
   * like Octo Fiesta or slow origins that serve the track on the fly: requests
   * the URL ahead of time so the server has it ready when needed. Off by
   * default: on a normal server it adds no value and only creates extra work
   * (transcodes, stats) without the user asking.
   */
  preloadUpcoming: boolean;
  /**
   * Ask the asset for frame-exact timing before anything plays: the
   * `AVURLAssetPreferPreciseDurationAndTimingKey` on iOS, which is what makes a
   * seek land on the exact frame and the duration be the file's own. The cost
   * is a scan of the file for an index before the first second plays - on a
   * stream that has none (a transcoded mp3 over HTTP) that scan is the wait
   * before a track starts. Off by default: the clock follows the audio either
   * way, so positions, lyrics and scrobbles stay in step; what off gives up is
   * exact seek landing and exact duration on the files that need a scan to
   * know it. iOS only.
   */
  preferPreciseTiming: boolean;
  /**
   * Auto-switch between online and offline based on connectivity: fall back to
   * downloads when the server doesn't respond and reconnect when it comes back.
   * On by default. If turned off, the user manually controls the mode
   * (Settings → "Offline mode" / "Back online") and the app never switches it.
   */
  autoOfflineSwitch: boolean;
  /**
   * In server offline mode, hide non-downloaded songs instead of showing them
   * grayed out. Off by default (shown grayed out, as before); when enabled, the
   * offline library only shows playable content.
   */
  hideUnavailableOffline: boolean;
  /** Volume normalization (ReplayGain): off, per track, or per album. */
  replayGain: ReplayGainMode;
  /**
   * Offset in dB applied on top of the ReplayGain tag, so the normalized
   * loudness can be moved to wherever the user wants it. Only counts when
   * normalization is on and the song carries tags: with nothing to normalize
   * there is no reference to move away from.
   */
  replayGainPreampDb: number;
  /** Keep screen on while the app is in the foreground. */
  keepScreenAwake: boolean;
  /** Subtle vibration on key actions (favorite, long-press, drag…). */
  hapticsEnabled: boolean;
  /** Lyrics screen background: flat, cover color, or blurred cover art. */
  lyricsBackground: ScreenBackground;
  /** Lyrics card (under the player controls): flat or cover color. */
  lyricsCardBackground: CardBackground;
  /**
   * Where lyrics come from: prefer local, prefer online (LRCLIB), or online
   * disabled. Defaults to 'local' (local first, LRCLIB as fallback).
   */
  lyricsSource: LyricsSource;
  lyricsSize: LyricsSize;
  /** Thickness of lyric glyphs, from light (300) to bold (700). */
  lyricsWeight: LyricsWeight;
  lyricsAlign: LyricsAlign;
  /** Progressively blur synchronized lyric rows away from the current line. */
  blurInactiveLyrics: boolean;
  /** The names under the icons of the navigation bar. */
  showTabLabels: boolean;
  miniPlayerButtons: MiniPlayerButtons;
  miniPlayerProgress: boolean;
  /** The time right of the seek bar counts down what is left, not the length. */
  showRemainingTime: boolean;
  coverCorners: CoverCorners;
  /** When a downloaded song plays from disk instead of being streamed. */
  preferDownloads: PreferDownloads;
  /** Circular artist photo next to the name on the album screen. */
  showArtistPhoto: boolean;
  /**
   * Disc headers in multi-disc albums (separator + disc title, or "Disc N"
   * if untitled). On by default.
   */
  showDiscHeaders: boolean;
  /**
   * Genre chips on the album screen (tap one to browse that genre). Read from
   * the album's tags, so an untagged album simply shows none. Off by default:
   * whoever wants them will go and find them, and a first-time album screen is
   * better off with one less row on it.
   */
  showGenreChips: boolean;
  /**
   * Warn on startup when Android's battery optimization is restricting the app.
   * Only «Don't remind me» turns it off, so a warning dismissed with «Later»
   * comes back — and the system can re-restrict the app at any time, which is
   * exactly when it needs saying again.
   */
  batteryWarning: boolean;
  /** Player background: flat, cover color, or blurred cover art. */
  playerBackground: ScreenBackground;
  /**
   * When the cover art is animated (GIF, animated WebP, APNG), use it as
   * the fullscreen player background and show a small static copy beside
   * the title. Off by default: the cover plays inside the square as before.
   */
  animatedCoverBackground: boolean;
  /**
   * The fps animated covers encode at for the lock screen (30 or 60). A clip
   * already on disk keeps the rate it was written at; the next one picks up
   * whatever this says.
   */
  animatedArtworkFps: number;
  /**
   * Show non-square artwork whole in the player instead of cropping it to a
   * square. Off by default: cropping is what it has always done, and every
   * other place in the app (lists, cards, grids) keeps cropping regardless.
   */
  fitCoverArt: boolean;
  /** Mini-player tinted with the dominant color of the cover art. */
  miniPlayerColorBackground: boolean;
  /** Lyrics card below the player controls. */
  showLyricsCard: boolean;
  /** Artist card below the player controls. */
  showArtistCard: boolean;
  /** What tapping the player cover does (nothing / lyrics screen /
   *  lyrics in place of the cover). */
  coverTapAction: CoverTapAction;
  /** What tapping it twice does (nothing / play or pause / favourite). */
  coverDoubleTapAction: CoverDoubleTapAction;
  /** Marquee: long titles in the player auto-scroll. */
  marqueeTitles: boolean;
  /** The row under the player's controls: which buttons, in what order. */
  playerButtons: PlayerButton[];
  playerButtonsLayout: PlayerButtonsLayout;
  /** Seek ±N seconds buttons next to play (0 = hidden). Only 5/10/30: these are the numbered icons that exist in MaterialIcons. */
  seekButtonsSec: number;
  /** "Previous" button behavior (restart track or always go to previous). */
  previousButtonMode: PreviousButtonMode;
  /**
   * Whether skipping while paused leaves it paused (#110).
   *
   * Off, which is what the app has always done. Every other player, and media3
   * underneath, stays paused: skipping is moving through the queue, not
   * starting it. It is a setting rather than the new behaviour because people
   * have four years of muscle memory in which ⏭ means "play the next one".
   */
  keepPausedOnSkip: boolean;
  /** Action when swiping a song right in lists. */
  swipeAction: SwipeAction;
  /** Action when swiping a song left in lists. */
  swipeLeftAction: SwipeAction;
  /** Home album rows, in order (each with its state). */
  homeSections: HomeSection[];
  /** Quick access grid (Favorites + recent) at the top of Home. */
  showQuickGrid: boolean;
  /** The card at the top of Home with what plays on the user's other players. */
  showPlayingElsewhere: boolean;
  /** Pin the Favorites tile first in the quick grid. */
  quickGridFavorites: boolean;
  /** Include recent albums in the quick grid. */
  quickGridAlbums: boolean;
  /** Include playlists in the quick grid. */
  quickGridPlaylists: boolean;
  /** Total number of tiles in the quick grid (4, 6, or 8). */
  quickGridSize: number;
  /** Show the greeting ("Good morning"…) on Home. */
  showGreeting: boolean;
  /** Custom greeting; empty = the automatic one based on time of day. */
  customGreeting: string;
  /** Home explore chips, in order (each with its state). With none active, the
   *  row disappears: that replaces the old toggle. */
  homeChips: HomeChip[];
  /** The order of the pills at the top of Explore. */
  exploreSections: ExploreSection[];
  bottomTabs: BottomTab[];
  /** Whether those chips carry their icon, or are their name and nothing else. */
  homeChipIcons: boolean;
  /** "Folders" section in the Library (directory browsing; Subsonic). */
  showFolderBrowser: boolean;
  /** The buttons at the top right of Home, in order (each with its state).
   *  For those who prefer a minimal UI: all but the gear can go. */
  homeButtons: HomeButton[];
  /** App startup tab (Home/Search/Library). */
  defaultTab: DefaultTab;
  /** Your library with no chip pressed shows Favorites and the playlists, as
   *  it did before the mixed view, instead of everything (#217). */
  libraryShowsPlaylists: boolean;
  /** Chosen Library sort order (recent/added/alphabetical). */
  librarySort: LibrarySort;
  /** List or grid in the Library. */
  libraryLayout: ListLayout;
  /**
   * List or grid when browsing artists. Separate from `libraryLayout` on
   * purpose: they are different collections (here ALL artists, there only
   * favorites), and sharing it would make toggling the button on one screen
   * rearrange the other without warning.
   */
  browseArtistsLayout: ListLayout;
  /** List or grid when browsing albums. Separate for the same reason as above. */
  browseAlbumsLayout: ListLayout;
  /** List or grid, and the order, for the playlists section of Explore. Their
   *  own keys and not `libraryLayout`/`librarySort`: that pair belongs to
   *  "Your library", and one list rearranging the other on a button press is
   *  what the split above exists to avoid. */
  browsePlaylistsLayout: ListLayout;
  browsePlaylistsSort: LibrarySort;
  /** List or grid when browsing songs. Its own key, same reasoning. */
  browseSongsLayout: ListLayout;
  /** List or grid in an artist's full discography. Its own key, again for the
   *  same reason: it's one artist's albums, not the whole library. */
  discographyLayout: ListLayout;
  /** List or grid on a genre's albums. Its own key, same reasoning. */
  genreLayout: ListLayout;
  /**
   * How many across each grid is, for the ones that have been changed. Only
   * what somebody chose is kept; anything absent falls back to
   * `GRID_DEFAULT_COLUMNS`, so the defaults stay in one place and a screen
   * that is added later needs nothing here.
   */
  gridColumns: Partial<Record<GridSizeKey, number>>;
  /** Last expiry chosen when sharing, offered again the next time. */
  shareExpiry: ShareExpiry;
  /** Whether the last share allowed downloading (Navidrome only). */
  shareDownloadable: boolean;
  /**
   * Bring over the queue another player left on the server, on its own.
   *
   * Off by default: what it does when it fires is replace the queue on this
   * device, and a queue that changes without being asked is worse than one
   * that has to be asked for (the ⋯ of the queue screen always can).
   */
  syncQueueFromServer: boolean;
  /** Accent color (hex) under the dark appearance. */
  accentColor: string;
  /** The same under the light one, which is a separate choice: a colour picked
   *  for near-black is not always the one wanted on white. */
  accentColorLight: string;
  /** The user's own colour (hex), kept apart so picking one from the palette
   *  does not lose it; '' until one is made. */
  customAccentColor: string;
  /** Dark (the app's own look), light, or whichever one the device is in. */
  themeMode: ThemePreference;
  /** With `themeMode` 'schedule': the hour (0–23) light starts, and dark. */
  themeLightFrom: number;
  themeDarkFrom: number;
  /** True black instead of dark grey in the dark appearance (OLED). */
  pureBlack: boolean;
  /** The hue in the dark appearance's greys. */
  backgroundTint: BackgroundTint;
  /** UI font (system font family; `system` = default). */
  appFont: AppFont;
  /** Loaded custom font family name (the key passed to `Font.loadAsync`). */
  customFontFamily: string | null;
  /** URI the custom font was copied to inside the app's document directory. */
  customFontUri: string | null;
  setLanguage: (language: Language) => void;
  setDiagnostics: (value: boolean) => void;
  setAnimatedArtworkFps: (value: number) => void;
  setLyricsSize: (value: number) => void;
  resetScrobbleRules: () => void;
  setHideUnavailableOffline: (value: boolean) => void;
  setReplayGainPreampDb: (value: number) => void;
  setHomeSection: (key: HomeSectionKey, value: boolean) => void;
  /** Trims to GREETING_MAX internally: the cap doesn't depend on the caller. */
  setCustomGreeting: (value: string) => void;
  setHomeChip: (key: HomeChipKey, value: boolean) => void;
  /** One section on or off, by key, the way the Home chips do it. */
  setExploreSection: (key: ExploreSectionKey, value: boolean) => void;
  setBottomTab: (key: TabSegment, value: boolean) => void;
  setHomeButton: (key: HomeButtonKey, value: boolean) => void;
  setPlayerButton: (key: PlayerButtonKey, value: boolean) => void;
  setGridColumns: (key: GridSizeKey, value: number) => void;
  setAccentColor: (value: string, appearance: ThemeMode) => void;
  setThemeMode: (value: ThemePreference) => void;
  setThemeLightFrom: (hour: number) => void;
  setThemeDarkFrom: (hour: number) => void;
  setPureBlack: (value: boolean) => void;
  setBackgroundTint: (value: BackgroundTint) => void;
  setCustomFont: (fontFamily: string | null, uri: string | null) => void;
  /** Resets to factory defaults (language is preserved). */
  resetToDefaults: () => void;
  /** Replaces every setting with an exported file's (#243). */
  importSettings: (saved: unknown) => void;
  /** The saved settings have been read from disk. Until then everything is at
   *  its default, so anything that acts ON a setting must wait for this. */
  hydrated: boolean;
  hydrate: () => Promise<void>;
}

const scope = profileScopeGuard();

/** A saved accent, as the picker writes them. Anything else was not written by
 *  this app and is not worth painting the screen with. */
function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function persist(state: ReturnType<typeof snapshot>) {
  const key = settingsKey();
  // Never write one profile's settings under another's key, and never write
  // before hydrating: both save factory defaults over real preferences and the
  // next hydrate reads them back as good. See `profileScopeGuard`.
  if (!scope.owns(key)) return;
  void setItem(key, JSON.stringify(state));
}

function snapshot(get: () => SettingsState): Persisted {
  const s = get();
  const out: Partial<Record<PersistedKey, unknown>> = {};
  for (const key of PERSISTED_KEYS) out[key] = s[key];
  return out as Persisted;
}

/** Factory default values for all preferences. */
const DEFAULTS = {
  maxBitRate: 0,
  maxBitRateCellular: 0,
  downloadBitRate: 0,
  streamFormat: '' as TranscodeFormat,
  downloadConcurrency: 2,
  streamFormatCellular: '' as TranscodeFormat,
  downloadFormat: '' as TranscodeFormat,
  downloadWifiOnly: false,
  streamLosslessOnly: false,
  downloadLosslessOnly: false,
  songCache: false,
  songCacheLimitGb: 4,
  language: 'en' as Language,
  showAudioQuality: false,
  showRating: false,
  showAlbumInfo: false,
  swapPlayerButtons: false,
  showPlayedInQueue: false,
  showListArtwork: true,
  showPlaylistDescription: true,
  alwaysShowTabs: true,
  blurBars: true,
  navBarStyle: 'solid' as NavBarStyle,
  blurMiniPlayer: true,
  showSongDuration: false,
  showListRating: false,
  // On: it only ever draws where a file says so, which in most libraries is
  // nowhere, and where it does draw it is the tag the file was given.
  showExplicitTag: true,
  autoplaySimilar: true,
  radiosEnabled: true,
  radioCount: 6,
  radioEndless: true,
  // Off: measuring is for somebody who is being asked to measure. Everyone
  // else was paying for a report they will never send.
  diagnostics: false,
  // On: see the note on the field. Nothing is downloaded by it.
  updateCheck: true,
  crossfadeSec: 0,
  scrobblePercent: SCROBBLE_PERCENT_DEFAULT,
  scrobbleSeconds: SCROBBLE_SECONDS_DEFAULT,
  preloadUpcoming: false,
  preferPreciseTiming: false,
  autoOfflineSwitch: true,
  hideUnavailableOffline: false,
  replayGain: 'off' as ReplayGainMode,
  replayGainPreampDb: 0,
  keepScreenAwake: false,
  hapticsEnabled: false,
  // Same as the player's: the blurred artwork, which is what the screen it
  // opens from is already showing.
  lyricsBackground: 'cover' as ScreenBackground,
  lyricsCardBackground: 'color' as CardBackground,
  lyricsSource: 'local' as LyricsSource,
  lyricsSize: LYRICS_SIZE_DEFAULT as LyricsSize,
  lyricsWeight: '500' as LyricsWeight,
  lyricsAlign: 'left' as LyricsAlign,
  // Opt-in, matching Primuse: it changes the reading treatment substantially.
  blurInactiveLyrics: false,
  showTabLabels: true,
  miniPlayerButtons: 'favorite' as MiniPlayerButtons,
  miniPlayerProgress: true,
  showRemainingTime: false,
  coverCorners: 'rounded' as CoverCorners,
  preferDownloads: 'always' as PreferDownloads,
  showArtistPhoto: true,
  showDiscHeaders: true,
  showGenreChips: false,
  batteryWarning: true,
  playerBackground: 'cover' as ScreenBackground,
  animatedCoverBackground: false,
  // 30: half the frames of 60 for a cover that reads the same; see
  // `ANIMATED_ARTWORK_FPS_OPTIONS`.
  animatedArtworkFps: 30,
  fitCoverArt: false,
  miniPlayerColorBackground: true,
  // Off by default: the card pushes the controls up on shorter screens, and
  // the lyrics screen is one tap away on the cover.
  showLyricsCard: false,
  // Off for the same reason, and it also needs a biography to show anything.
  showArtistCard: false,
  // By default, tapping the cover opens the lyrics screen (as always).
  coverTapAction: 'screen' as CoverTapAction,
  // Nothing: see `CoverDoubleTapAction`.
  coverDoubleTapAction: 'none' as CoverDoubleTapAction,
  marqueeTitles: true,
  playerButtons: DEFAULT_PLAYER_BUTTONS.map((b) => ({ ...b })),
  playerButtonsLayout: 'spread' as PlayerButtonsLayout,
  seekButtonsSec: 0,
  previousButtonMode: 'restart' as PreviousButtonMode,
  keepPausedOnSkip: false,
  // By default, swiping right queues (previous behavior) and left does
  // nothing (opt-in).
  swipeAction: 'queue' as SwipeAction,
  swipeLeftAction: 'off' as SwipeAction,
  homeSections: DEFAULT_HOME_SECTIONS.map((s) => ({ ...s })),
  showQuickGrid: false,
  showPlayingElsewhere: true,
  quickGridFavorites: true,
  quickGridAlbums: true,
  quickGridPlaylists: true,
  quickGridSize: 8,
  showGreeting: false,
  customGreeting: '',
  homeChips: DEFAULT_HOME_CHIPS.map((c) => ({ ...c })),
  exploreSections: DEFAULT_EXPLORE_SECTIONS.map((s) => ({ ...s })),
  bottomTabs: DEFAULT_BOTTOM_TABS.map((t) => ({ ...t })),
  homeChipIcons: true,
  showFolderBrowser: false,
  homeButtons: DEFAULT_HOME_BUTTONS.map((b) => ({ ...b })),
  defaultTab: 'index' as DefaultTab,
  libraryShowsPlaylists: false,
  librarySort: 'recent' as LibrarySort,
  libraryLayout: 'list' as ListLayout,
  // Rows, like the songs below and like everything else in Explore. A grid is
  // how you recognise one artist you are already looking at; browsing the
  // whole server is reading names, and a wall of faces is slower at that. The
  // button is there for whoever disagrees.
  browseArtistsLayout: 'list' as ListLayout,
  // Rows, for the same reason. The cover identifies an album you know; the
  // list is what you scan when you do not.
  browseAlbumsLayout: 'list' as ListLayout,
  // Rows here too, and "Recents" like "Your library" opens on: the two lists
  // hold the same playlists and landing on a different order in each would
  // read as a different list.
  browsePlaylistsLayout: 'list' as ListLayout,
  browsePlaylistsSort: 'recent' as LibrarySort,
  // Rows: a song is read by its title, and twelve of the same album are twelve
  // copies of one cover. The button is there for whoever disagrees.
  browseSongsLayout: 'list' as ListLayout,
  // List by default: that's how the discography has always been shown, and the
  // toggle is right there for whoever prefers blocks.
  discographyLayout: 'list' as ListLayout,
  // Grid, like browsing albums: a genre is browsed by cover, not read by name.
  genreLayout: 'grid' as ListLayout,
  // Grid too: a shelf of books is looked at, and the covers are how you tell
  // one from another before you have read the spine.
  gridColumns: {} as Partial<Record<GridSizeKey, number>>,
  // Sharing a song with somebody usually means for good; the rest are there
  // for whoever wants the link to stop working.
  shareExpiry: 'never' as ShareExpiry,
  // Off: the server has its own default for this and nothing was overriding it.
  shareDownloadable: false,
  // On. The queue is pushed to the server whether this is on or off (that is
  // what lets any client, this one included, pick up where you left off), so
  // leaving the reading half off by default made the app a writer that never
  // listened: it would overwrite what another player left and never take it
  // (#188). Adopting is the conservative half of the pair anyway, since it only
  // happens with nothing playing here and only for a queue another client
  // wrote later.
  syncQueueFromServer: true,
  accentColor: DEFAULT_ACCENT,
  accentColorLight: DEFAULT_ACCENT,
  customAccentColor: '',
  // Dark: the appearance the app was designed in. Light is opt-in.
  themeMode: 'dark' as ThemePreference,
  themeLightFrom: 7,
  themeDarkFrom: 21,
  pureBlack: false,
  backgroundTint: 'blue' as BackgroundTint,
  appFont: 'system' as AppFont,
  customFontFamily: null as string | null,
  customFontUri: null as string | null,
};

const PERSISTED_KEYS = (Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]).filter(
  (key): key is PersistedKey => key !== 'language',
);

function autoSetters(
  set: (partial: Partial<SettingsState>) => void,
  get: () => SettingsState,
): AutoSetters {
  const out: Record<string, (value: unknown) => void> = {};
  for (const key of PERSISTED_KEYS) {
    out[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      set({ [key]: value } as Partial<SettingsState>);
      persist(snapshot(get));
    };
  }
  return out as AutoSetters;
}

/** The appearance side effects of the factory values: they live outside the
 *  store, so putting the store back does not put them back. */
function applyFactoryLook() {
  applyAccents(DEFAULT_ACCENT, DEFAULT_ACCENT);
  applyThemeSchedule(DEFAULTS.themeLightFrom, DEFAULTS.themeDarkFrom);
  applyThemePreference(DEFAULTS.themeMode);
  applyPureBlack(DEFAULTS.pureBlack);
  applyBackgroundTint(DEFAULTS.backgroundTint);
}

/**
 * A saved blob onto what is in the store, which the caller has already put at
 * the factory values. Shared by the read at startup and an imported file (#243),
 * so both go through the same checks and the same migrations.
 */
function applySaved(raw: unknown, set: (partial: Partial<SettingsState>) => void) {
  // Typed as what this version writes, plus the earlier shapes that are
  // read only to migrate them. Nothing here is trusted: every value is
  // checked before it is used.
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<Omit<Persisted, Reshaped>> & {
    showAudioQuality?: string | boolean;
    homeSections?: unknown;
    homeChips?: unknown;
    exploreSections?: unknown;
    bottomTabs?: unknown;
    homeButtons?: unknown;
    playerButtons?: unknown;
    showQueueButton?: boolean;
    showDevicesButton?: boolean;
    showSpeedButton?: boolean;
    lyricsColorBackground?: boolean;
    lyricsOnlineFallback?: boolean;
    lyricsSize?: unknown;
    playerColorBackground?: boolean;
    swipeToQueue?: boolean;
    showExploreChips?: boolean;
    exploreChips?: unknown;
    exploreChipIcons?: boolean;
    showHistoryButton?: boolean;
  };
  // Every on/off setting the same way: a saved boolean is taken as is.
  // The few that also migrate an older value do that further down.
  const flags: Record<string, boolean> = {};
  for (const key of PERSISTED_KEYS) {
    const value: unknown = parsed[key];
    if (typeof DEFAULTS[key] === 'boolean' && typeof value === 'boolean') flags[key] = value;
  }
  set(flags as Partial<SettingsState>);
  // One switch used to blur both bars.
  if (typeof parsed.blurMiniPlayer !== 'boolean' && typeof parsed.blurBars === 'boolean') {
    set({ blurMiniPlayer: parsed.blurBars });
  }
  if (typeof parsed.maxBitRate === 'number') {
    set({ maxBitRate: parsed.maxBitRate });
  }
  if (typeof parsed.maxBitRateCellular === 'number') {
    set({ maxBitRateCellular: parsed.maxBitRateCellular });
  } else if (typeof parsed.maxBitRate === 'number') {
    // Previously there was a single streaming quality: whoever had it set
    // inherits the same value for cellular (identical behavior until they
    // touch the new setting).
    set({ maxBitRateCellular: parsed.maxBitRate });
  }
  if (typeof parsed.downloadBitRate === 'number') {
    set({ downloadBitRate: parsed.downloadBitRate });
  }
  if (DOWNLOAD_CONCURRENCY_OPTIONS.includes(parsed.downloadConcurrency as number)) {
    set({ downloadConcurrency: parsed.downloadConcurrency as number });
  }
  if ((ANIMATED_ARTWORK_FPS_OPTIONS as readonly number[]).includes(parsed.animatedArtworkFps as number)) {
    set({ animatedArtworkFps: parsed.animatedArtworkFps as number });
  }
  if ((RADIO_COUNT_OPTIONS as readonly number[]).includes(parsed.radioCount as number)) {
    set({ radioCount: parsed.radioCount as number });
  }
  if (TRANSCODE_FORMATS.includes(parsed.streamFormat as TranscodeFormat)) {
    set({ streamFormat: parsed.streamFormat as TranscodeFormat });
  }
  if (TRANSCODE_FORMATS.includes(parsed.streamFormatCellular as TranscodeFormat)) {
    set({ streamFormatCellular: parsed.streamFormatCellular as TranscodeFormat });
  } else if (TRANSCODE_FORMATS.includes(parsed.streamFormat as TranscodeFormat)) {
    // Previously there was a single streaming codec: whoever had it set
    // keeps it on both networks until they touch the new setting.
    set({ streamFormatCellular: parsed.streamFormat as TranscodeFormat });
  }
  if (TRANSCODE_FORMATS.includes(parsed.downloadFormat as TranscodeFormat)) {
    set({ downloadFormat: parsed.downloadFormat as TranscodeFormat });
  }
  if (SONG_CACHE_LIMITS_GB.includes(parsed.songCacheLimitGb as number)) {
    set({ songCacheLimitGb: parsed.songCacheLimitGb as number });
  }
  // `language` is no longer applied here: it's global, loaded at the end.
  // It used to be a mode ('off'/'player'/'everywhere'); now a simple
  // on/off. Map old values: any mode that showed the label maps to on.
  if (typeof parsed.showAudioQuality === 'boolean') {
    set({ showAudioQuality: parsed.showAudioQuality });
  } else if (parsed.showAudioQuality === 'player' || parsed.showAudioQuality === 'everywhere') {
    set({ showAudioQuality: true });
  } else if (parsed.showAudioQuality === 'off') {
    set({ showAudioQuality: false });
  }
  if (typeof parsed.crossfadeSec === 'number' && parsed.crossfadeSec >= 0) {
    set({ crossfadeSec: parsed.crossfadeSec });
  }
  // Clamped rather than only checked: these two decide whether a listen
  // is reported at all, and a file with a percentage of 4000 in it would
  // otherwise turn scrobbling off in a way nothing on screen explains.
  if (typeof parsed.scrobblePercent === 'number' && parsed.scrobblePercent >= 0) {
    set({ scrobblePercent: Math.min(100, Math.round(parsed.scrobblePercent)) });
  }
  if (typeof parsed.scrobbleSeconds === 'number' && parsed.scrobbleSeconds >= 0) {
    set({
      scrobbleSeconds: Math.min(SCROBBLE_SECONDS_MAX, Math.round(parsed.scrobbleSeconds)),
    });
  }
  if (
    parsed.replayGain === 'off' ||
    parsed.replayGain === 'auto' ||
    parsed.replayGain === 'track' ||
    parsed.replayGain === 'album'
  ) {
    set({ replayGain: parsed.replayGain });
  }
  if (typeof parsed.replayGainPreampDb === 'number') {
    set({ replayGainPreampDb: clampReplayGainPreamp(parsed.replayGainPreampDb) });
  }
  if (parsed.lyricsBackground === 'none' || parsed.lyricsBackground === 'color' || parsed.lyricsBackground === 'cover') {
    set({ lyricsBackground: parsed.lyricsBackground });
  } else if (typeof parsed.lyricsColorBackground === 'boolean') {
    // Same migration as the player's: on → tinted, off → flat.
    set({ lyricsBackground: parsed.lyricsColorBackground ? 'color' : 'none' });
  }
  // The card used to follow the lyrics screen's setting, so a profile
  // without its own value inherits whatever the screen had.
  if (parsed.lyricsCardBackground === 'none' || parsed.lyricsCardBackground === 'color') {
    set({ lyricsCardBackground: parsed.lyricsCardBackground });
  } else if (parsed.lyricsBackground === 'none') {
    set({ lyricsCardBackground: 'none' });
  } else if (typeof parsed.lyricsColorBackground === 'boolean') {
    set({ lyricsCardBackground: parsed.lyricsColorBackground ? 'color' : 'none' });
  }
  if (
    parsed.lyricsSource === 'local' ||
    parsed.lyricsSource === 'online' ||
    parsed.lyricsSource === 'off'
  ) {
    set({ lyricsSource: parsed.lyricsSource });
  } else if (typeof parsed.lyricsOnlineFallback === 'boolean') {
    // Migrate the old boolean: on = local first with online fallback, off = no online.
    set({ lyricsSource: parsed.lyricsOnlineFallback ? 'local' : 'off' });
  }
  const oneOf = <T extends string>(v: unknown, all: readonly T[]): v is T =>
    all.includes(v as T);
  if (typeof parsed.lyricsSize === 'number') {
    set({ lyricsSize: clampLyricsSize(parsed.lyricsSize) });
  } else if (oneOf(parsed.lyricsSize, ['small', 'normal', 'large'] as const)) {
    // Before the continuous control these were the three full-screen sizes.
    set({ lyricsSize: { small: 22, normal: 28, large: 34 }[parsed.lyricsSize] });
  }
  if (oneOf(parsed.lyricsWeight, LYRICS_WEIGHTS)) {
    set({ lyricsWeight: parsed.lyricsWeight });
  }
  if (oneOf(parsed.lyricsAlign, ['left', 'center'] as const)) {
    set({ lyricsAlign: parsed.lyricsAlign });
  }
  if (oneOf(parsed.miniPlayerButtons, ['favorite', 'next', 'previousNext', 'none'] as const)) {
    set({ miniPlayerButtons: parsed.miniPlayerButtons });
  }
  if (oneOf(parsed.coverCorners, ['square', 'rounded', 'round'] as const)) {
    set({ coverCorners: parsed.coverCorners });
  }
  if (
    parsed.preferDownloads === 'always' ||
    parsed.preferDownloads === 'cellular' ||
    parsed.preferDownloads === 'original' ||
    parsed.preferDownloads === 'never'
  ) {
    set({ preferDownloads: parsed.preferDownloads });
  }
  if (parsed.playerBackground === 'none' || parsed.playerBackground === 'color' || parsed.playerBackground === 'cover') {
    set({ playerBackground: parsed.playerBackground });
  } else if (typeof parsed.playerColorBackground === 'boolean') {
    // Migration from the old boolean: on → the tinted background it
    // already had, off → flat. Profiles saved before the blurred cover
    // option existed keep looking exactly the same.
    set({ playerBackground: parsed.playerColorBackground ? 'color' : 'none' });
  }
  if (isCoverTapAction(parsed.coverTapAction)) {
    set({ coverTapAction: parsed.coverTapAction });
  }
  if (isCoverTapAction(parsed.coverDoubleTapAction)) {
    set({ coverDoubleTapAction: parsed.coverDoubleTapAction });
  }
  if (parsed.seekButtonsSec === 0 || parsed.seekButtonsSec === 5 || parsed.seekButtonsSec === 10 || parsed.seekButtonsSec === 30) {
    set({ seekButtonsSec: parsed.seekButtonsSec });
  }
  if (parsed.previousButtonMode === 'restart' || parsed.previousButtonMode === 'always') {
    set({ previousButtonMode: parsed.previousButtonMode });
  }
  if (parsed.navBarStyle === 'solid' || parsed.navBarStyle === 'gradient') {
    set({ navBarStyle: parsed.navBarStyle });
  }
  if (
    parsed.swipeAction === 'off' ||
    parsed.swipeAction === 'queue' ||
    parsed.swipeAction === 'next' ||
    parsed.swipeAction === 'favorite' ||
    parsed.swipeAction === 'menu'
  ) {
    set({ swipeAction: parsed.swipeAction });
  } else if (typeof parsed.swipeToQueue === 'boolean') {
    // Migration from the old setting: on → queue, off → nothing.
    set({ swipeAction: parsed.swipeToQueue ? 'queue' : 'off' });
  }
  if (
    parsed.swipeLeftAction === 'off' ||
    parsed.swipeLeftAction === 'queue' ||
    parsed.swipeLeftAction === 'next' ||
    parsed.swipeLeftAction === 'favorite' ||
    parsed.swipeLeftAction === 'menu'
  ) {
    set({ swipeLeftAction: parsed.swipeLeftAction });
  }
  if (Array.isArray(parsed.homeSections)) {
    set({ homeSections: normalizeHomeSections(parsed.homeSections) });
  }
  if (parsed.quickGridSize === 4 || parsed.quickGridSize === 6 || parsed.quickGridSize === 8) {
    set({ quickGridSize: parsed.quickGridSize });
  }
  // Truncated on hydrate: a setting saved by a version with a different
  // cap must not sneak in longer than what fits.
  if (typeof parsed.customGreeting === 'string') {
    set({ customGreeting: parsed.customGreeting.slice(0, GREETING_MAX) });
  }
  // Two older names are still read here, and this is the whole of the
  // rename's cost. The row used to be called the Explore chips, one word
  // away from the Explore tab and meaning something else entirely; a
  // file written before the rename says `exploreChips`, and whoever had
  // spent time putting those in order would have found them back at the
  // defaults. Written under the new name from the first save on, so this
  // only ever runs once per install.
  const chipIcons = parsed.homeChipIcons ?? parsed.exploreChipIcons;
  if (typeof chipIcons === 'boolean') {
    set({ homeChipIcons: chipIcons });
  }
  const chips = parsed.homeChips ?? parsed.exploreChips;
  if (Array.isArray(chips)) {
    set({ homeChips: normalizeHomeChips(chips) });
  } else if (parsed.showExploreChips === false) {
    // Migration from the single toggle that came before either name:
    // whoever had the row hidden should still not see it, not find the
    // chips back. Turning them all off is exactly what hides it now.
    set({ homeChips: DEFAULT_HOME_CHIPS.map((c) => ({ ...c, enabled: false })) });
  }
  if (Array.isArray(parsed.bottomTabs)) {
    set({ bottomTabs: normalizeBottomTabs(parsed.bottomTabs) });
  }
  if (Array.isArray(parsed.exploreSections)) {
    set({ exploreSections: normalizeExploreSections(parsed.exploreSections) });
  }
  if (Array.isArray(parsed.homeButtons)) {
    set({ homeButtons: normalizeHomeButtons(parsed.homeButtons) });
  } else if (parsed.showHistoryButton === false) {
    // Migration from the previous single toggle: the clock was the only
    // one of these with a switch, and whoever had it hidden should not
    // find it back.
    set({
      homeButtons: DEFAULT_HOME_BUTTONS.map((b) =>
        b.key === 'history' ? { ...b, enabled: false } : { ...b },
      ),
    });
  }
  if (parsed.playerButtonsLayout === 'centered' || parsed.playerButtonsLayout === 'spread') {
    set({ playerButtonsLayout: parsed.playerButtonsLayout });
  }
  if (Array.isArray(parsed.playerButtons)) {
    set({ playerButtons: normalizePlayerButtons(parsed.playerButtons) });
  } else {
    // From the three switches there were before: whoever had one of them
    // off does not find it back. Speed was off unless turned on.
    const off = new Set<PlayerButtonKey>();
    if (parsed.showQueueButton === false) off.add('queue');
    if (parsed.showDevicesButton === false) off.add('devices');
    if (parsed.showSpeedButton !== true && 'showQueueButton' in parsed) off.add('speed');
    set({
      playerButtons: DEFAULT_PLAYER_BUTTONS.map((b) => ({ ...b, enabled: !off.has(b.key) })),
    });
  }
  if (
    parsed.defaultTab === 'index' ||
    parsed.defaultTab === 'search' ||
    parsed.defaultTab === 'library' ||
    parsed.defaultTab === 'explore'
  ) {
    set({ defaultTab: parsed.defaultTab });
  }
  if (parsed.librarySort === 'recent' || parsed.librarySort === 'added' || parsed.librarySort === 'alpha') {
    set({ librarySort: parsed.librarySort });
  }
  if (parsed.libraryLayout === 'list' || parsed.libraryLayout === 'grid') {
    set({ libraryLayout: parsed.libraryLayout });
  }
  if (parsed.browseArtistsLayout === 'list' || parsed.browseArtistsLayout === 'grid') {
    set({ browseArtistsLayout: parsed.browseArtistsLayout });
  }
  if (parsed.browseAlbumsLayout === 'list' || parsed.browseAlbumsLayout === 'grid') {
    set({ browseAlbumsLayout: parsed.browseAlbumsLayout });
  }
  if (parsed.browsePlaylistsLayout === 'list' || parsed.browsePlaylistsLayout === 'grid') {
    set({ browsePlaylistsLayout: parsed.browsePlaylistsLayout });
  }
  if (
    parsed.browsePlaylistsSort === 'recent' ||
    parsed.browsePlaylistsSort === 'added' ||
    parsed.browsePlaylistsSort === 'alpha'
  ) {
    set({ browsePlaylistsSort: parsed.browsePlaylistsSort });
  }
  if (parsed.browseSongsLayout === 'list' || parsed.browseSongsLayout === 'grid') {
    set({ browseSongsLayout: parsed.browseSongsLayout });
  }
  if (parsed.discographyLayout === 'list' || parsed.discographyLayout === 'grid') {
    set({ discographyLayout: parsed.discographyLayout });
  }
  if (parsed.genreLayout === 'list' || parsed.genreLayout === 'grid') {
    set({ genreLayout: parsed.genreLayout });
  }
  // Read key by key rather than taken whole: a number from a file is the
  // one thing here that decides how a list is laid out, and a stray one
  // would be a screen that renders with columns nobody can choose. Keys
  // that are not grids any more simply do not survive the read.
  if (parsed.gridColumns && typeof parsed.gridColumns === 'object') {
    const cols: Partial<Record<GridSizeKey, number>> = {};
    for (const [key, value] of Object.entries(parsed.gridColumns)) {
      // A grid remembers a phone and a tablet apart, so the key can carry
      // which one it is; the grid itself has to be one that still exists.
      const wide = key.endsWith(':wide');
      if (!(key.replace(/:wide$/, '') in GRID_DEFAULT_COLUMNS)) continue;
      const choices = wide ? WIDE_COLUMN_CHOICES : GRID_COLUMN_CHOICES;
      if (choices.includes(value as number)) cols[key as GridSizeKey] = value as number;
    }
    set({ gridColumns: cols });
  }
  if (SHARE_EXPIRIES.includes(parsed.shareExpiry as ShareExpiry)) {
    set({ shareExpiry: parsed.shareExpiry as ShareExpiry });
  }
  // The light accent falls back to the dark one rather than to the
  // default: every profile that picked a colour before there were two of
  // them picked it for the app, not for one of its appearances.
  if (isHexColor(parsed.accentColor) || isHexColor(parsed.accentColorLight)) {
    const dark = isHexColor(parsed.accentColor) ? parsed.accentColor : DEFAULT_ACCENT;
    const light = isHexColor(parsed.accentColorLight) ? parsed.accentColorLight : dark;
    set({ accentColor: dark, accentColorLight: light });
    applyAccents(dark, light);
  }
  if (isHexColor(parsed.customAccentColor)) {
    set({ customAccentColor: parsed.customAccentColor });
  }
  {
    const hour = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? (v as number) : null);
    const light = hour(parsed.themeLightFrom) ?? DEFAULTS.themeLightFrom;
    const dark = hour(parsed.themeDarkFrom) ?? DEFAULTS.themeDarkFrom;
    set({ themeLightFrom: light, themeDarkFrom: dark });
    applyThemeSchedule(light, dark);
  }
  if (isThemePreference(parsed.themeMode)) {
    set({ themeMode: parsed.themeMode });
    applyThemePreference(parsed.themeMode);
  }
  if (typeof parsed.pureBlack === 'boolean') {
    set({ pureBlack: parsed.pureBlack });
    applyPureBlack(parsed.pureBlack);
  }
  if (typeof parsed.backgroundTint === 'string' && parsed.backgroundTint in BACKGROUND_TINTS) {
    set({ backgroundTint: parsed.backgroundTint });
    applyBackgroundTint(parsed.backgroundTint);
  }
  if (parsed.appFont && (parsed.appFont in APP_FONT_FAMILY || parsed.appFont === 'custom')) {
    set({ appFont: parsed.appFont });
  }
  if (parsed.customFontFamily) {
    set({ customFontFamily: parsed.customFontFamily });
  }
  if (parsed.customFontUri) {
    set({ customFontUri: parsed.customFontUri });
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  ...autoSetters(set, get),

  setLanguage: (language) => {
    set({ language });
    void setItem(LANG_KEY, language); // global language, not per profile
  },

  setDiagnostics: (diagnostics) => {
    set({ diagnostics });
    setPerfEnabled(diagnostics);
    persist(snapshot(get));
  },

  setAnimatedArtworkFps: (animatedArtworkFps) => {
    set({ animatedArtworkFps });
    persist(snapshot(get));
    // The encoder reads this the next time a clip is built; one already on
    // disk keeps the rate it was written at, which is the rate it holds.
    pushArtworkEncodeFps(animatedArtworkFps);
  },

  setLyricsSize: (lyricsSize) => {
    set({ lyricsSize: clampLyricsSize(lyricsSize) });
    persist(snapshot(get));
  },

  // Both at once, and one write: put back separately, the first of the two
  // spends a moment as a rule nobody chose next to the other one's old value.
  resetScrobbleRules: () => {
    set({
      scrobblePercent: SCROBBLE_PERCENT_DEFAULT,
      scrobbleSeconds: SCROBBLE_SECONDS_DEFAULT,
    });
    persist(snapshot(get));
  },

  setHideUnavailableOffline: (hideUnavailableOffline) => {
    set({ hideUnavailableOffline });
    persist(snapshot(get));
    // Changes what offline queries return (filters out non-downloaded or not):
    // refresh lists so the change is visible immediately.
    if (useAuthStore.getState().offline) queryClient.invalidateQueries();
  },

  setReplayGainPreampDb: (value) => {
    set({ replayGainPreampDb: clampReplayGainPreamp(value) });
    persist(snapshot(get));
  },

  setHomeSection: (key, value) => {
    set((s) => ({
      homeSections: s.homeSections.map((x) => (x.key === key ? { ...x, enabled: value } : x)),
    }));
    persist(snapshot(get));
  },

  setCustomGreeting: (customGreeting) => {
    set({ customGreeting: customGreeting.slice(0, GREETING_MAX) });
    persist(snapshot(get));
  },

  setHomeChip: (key, value) => {
    set((s) => ({
      homeChips: s.homeChips.map((x) => (x.key === key ? { ...x, enabled: value } : x)),
    }));
    persist(snapshot(get));
  },

  setBottomTab: (key, value) => {
    // Home's switch is not drawn, but a saved file could still say otherwise.
    if (key === 'index') return;
    set((s) => ({
      bottomTabs: s.bottomTabs.map((x) => (x.key === key ? { ...x, enabled: value } : x)),
    }));
    persist(snapshot(get));
  },

  setExploreSection: (key, value) => {
    set({
      exploreSections: get().exploreSections.map((s) =>
        s.key === key ? { ...s, enabled: value } : s,
      ),
    });
    persist(snapshot(get));
  },

  setHomeButton: (key, value) => {
    // The gear's switch is not drawn, but a saved file could still say
    // otherwise.
    if (key === 'settings') return;
    set((s) => ({
      homeButtons: s.homeButtons.map((x) => (x.key === key ? { ...x, enabled: value } : x)),
    }));
    persist(snapshot(get));
  },

  setPlayerButton: (key, value) => {
    set((s) => ({
      playerButtons: s.playerButtons.map((x) => (x.key === key ? { ...x, enabled: value } : x)),
    }));
    persist(snapshot(get));
  },

  setGridColumns: (key, value) => {
    set({ gridColumns: { ...get().gridColumns, [key]: value } });
    persist(snapshot(get));
  },

  setAccentColor: (value, appearance) => {
    set(appearance === 'light' ? { accentColorLight: value } : { accentColor: value });
    applyAccents(get().accentColor, get().accentColorLight);
    persist(snapshot(get));
  },

  setThemeMode: (themeMode) => {
    applyThemePreference(themeMode);
    set({ themeMode });
    persist(snapshot(get));
  },

  setThemeLightFrom: (themeLightFrom) => {
    set({ themeLightFrom });
    applyThemeSchedule(themeLightFrom, get().themeDarkFrom);
    persist(snapshot(get));
  },

  setThemeDarkFrom: (themeDarkFrom) => {
    set({ themeDarkFrom });
    applyThemeSchedule(get().themeLightFrom, themeDarkFrom);
    persist(snapshot(get));
  },

  setPureBlack: (pureBlack) => {
    applyPureBlack(pureBlack);
    set({ pureBlack });
    persist(snapshot(get));
  },

  setBackgroundTint: (backgroundTint) => {
    applyBackgroundTint(backgroundTint);
    set({ backgroundTint });
    persist(snapshot(get));
  },

  setCustomFont: (fontFamily, uri) => {
    set({ customFontFamily: fontFamily, customFontUri: uri });
    persist(snapshot(get));
  },

  resetToDefaults: () => {
    // Language is preserved: resetting shouldn't change your language.
    set({ ...DEFAULTS, language: get().language });
    applyFactoryLook();
    pushArtworkEncodeFps(get().animatedArtworkFps);
    persist(snapshot(get));
  },

  importSettings: (saved) => {
    // The font file stays on the phone that picked it, so the one here is kept
    // and a custom font this phone does not have falls back to the default.
    const { language, customFontFamily, customFontUri } = get();
    set({ ...DEFAULTS, language, customFontFamily, customFontUri });
    applyFactoryLook();
    applySaved({ ...(saved as object), customFontFamily: null, customFontUri: null }, set);
    if (get().appFont === 'custom' && !customFontFamily) set({ appFont: 'system' });
    setPerfEnabled(get().diagnostics);
    pushArtworkEncodeFps(get().animatedArtworkFps);
    persist(snapshot(get));
    if (useAuthStore.getState().offline) queryClient.invalidateQueries();
  },

  hydrate: async () => {
    const key = settingsKey();
    const token = scope.start();
    let applied = false;
    // What is in memory belongs to the profile that just left, and this says
    // so until the new one's has been read. It was only ever false on the first
    // read of a launch, so on a profile change whoever waits for this was told
    // the previous profile's settings were the new one's.
    set({ hydrated: false });
    try {
      // Active profile settings; if it doesn't have its own yet, inherits the
      // old (shared) ones as fallback/migration. Read BEFORE touching the
      // store: resetting to factory up front left the settings in memory at
      // default values for the whole read, and anything saved in that window
      // wrote those defaults over the real ones.
      const raw = (await getItem(key)) ?? (await getItem(STORAGE_KEY));
      // A newer hydration started while we were reading (profile switch, or
      // the saved session arriving on startup): it owns the store now, and
      // applying this would restore the wrong profile's settings.
      if (!scope.accept(token, key)) return;
      // Reset to factory (preserving language, which is global): on profile
      // switch it must not inherit the previous profile's settings. Accent and
      // appearance are applied manually because they're side effects (the blob
      // re-applies them if present); the font is reactive and doesn't need it.
      set({ ...DEFAULTS, language: get().language });
      applyFactoryLook();
      applied = true;
      if (raw) applySaved(JSON.parse(raw), set);
      // Language: global (not per profile). If not yet saved separately, it is
      // migrated from the old blob (which included it) on first run.
      let lang = await getItem(LANG_KEY);
      if (!lang) {
        const legacy = await getItem(STORAGE_KEY);
        if (legacy) {
          try {
            const l = (JSON.parse(legacy) as { language?: string }).language;
            if (l) {
              lang = l;
              void setItem(LANG_KEY, l);
            }
          } catch {
            // ignore
          }
        }
      }
      // Language is global, so it's applied even if another hydration took
      // over the per-profile part in the meantime.
      if (isLanguage(lang)) {
        set({ language: lang });
      }
    } catch {
      // Factory values if the read failed (the reset used to happen before it),
      // but not if the settings were already applied — a later failure, such as
      // the global language read, must not undo them — and not if a newer
      // hydration has taken over.
      if (!applied && scope.accept(token, key)) {
        set({ ...DEFAULTS, language: get().language });
        applyFactoryLook();
      }
    } finally {
      // A read overtaken by a newer one has nothing to hand over: saying
      // hydrated here showed the factory values as the saved ones, and the
      // battery warning asked again after «Don't remind me» (#238).
      if (!scope.current(token)) return;
      // Read or failed, what's in memory is now what this profile gets.
      set({ hydrated: true });
      // Here rather than where the value is read, so it is also settled for a
      // profile that saved nothing about it: the measuring starts on, to catch
      // the startup it would otherwise miss, and this is where it is told
      // whether anybody asked for it.
      setPerfEnabled(get().diagnostics);
      // The encoder's rate is native state with no way to read it back, so it
      // is pushed here for the same reason: every profile's saved value takes
      // effect on the first clip it builds, not on the next launch.
      pushArtworkEncodeFps(get().animatedArtworkFps);
    }
  },
}));

/**
 * What an exported file carries (#243): every per-profile setting but where
 * this phone keeps its custom font, which means nothing anywhere else. None of
 * them is a credential; those live in the auth store.
 */
export function exportedSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = { ...snapshot(useSettings.getState) };
  delete out.customFontFamily;
  delete out.customFontUri;
  return out;
}
