/** App settings (persisted): streaming quality and language. */
import { create } from 'zustand';

import { LANGUAGE_NAMES, isLanguage, type Language } from '@/i18n/languages';
import { hashKey } from '@/lib/localLibrary';
import { profileScopeGuard } from '@/lib/profileScope';
import { getItem, setItem } from '@/lib/storage';
import { applyAccent, DEFAULT_ACCENT } from '@/theme';
import { profileScopeId, useAuthStore } from './auth';
import { queryClient } from '@/lib/query';

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

/** Marker for the one-off «Rating» migration (see `hydrate`), per profile too. */
function ratingShownKey(): string {
  return `${STORAGE_KEY}.ratingShown.${hashKey(profileScopeId())}`;
}

/** 0 = original quality (no transcoding); the rest is bitrate in kbps. */
export const BITRATE_OPTIONS = [
  { label: 'Original', value: 0 },
  { label: '320 kbps', value: 320 },
  { label: '192 kbps', value: 192 },
  { label: '160 kbps', value: 160 },
  { label: '128 kbps', value: 128 },
  { label: '96 kbps', value: 96 },
  { label: '64 kbps', value: 64 },
] as const;

/**
 * Codec to request for transcoding (Subsonic `format` parameter).
 * '' = the server's default transcoder (MP3 on Navidrome). Only relevant
 * when a bitrate is selected (with "Original" the raw file is served).
 */
export type TranscodeFormat = '' | 'mp3' | 'opus' | 'aac';

/** Codec selector options. Codec labels are proper names; the "default" one
 *  is translated on each screen with `t('Server default')`. */
export const TRANSCODE_FORMATS: TranscodeFormat[] = ['', 'mp3', 'opus', 'aac'];

// Languages live in a single place (`src/i18n/languages.ts`): adding one is
// a single line there. Re-exported here to avoid breaking existing imports.
export { LANGUAGE_NAMES, isLanguage };
export type { Language };

/** Library sort order, Spotify style. */
export type LibrarySort = 'recent' | 'added' | 'alpha';

/** Collection layout: list (rows) or grid (cards). */
export type ListLayout = 'list' | 'grid';

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
 * UI font. These are Android system font families (no packaging or download
 * cost): `system` leaves the default font (Roboto).
 */
export type AppFont = 'system' | 'condensed' | 'serif' | 'monospace' | 'casual' | 'typewriter';

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

/** What tapping the cover in the player does: nothing, open the lyrics screen,
 *  or show lyrics in place of the cover. */
export type CoverTapAction = 'none' | 'screen' | 'inline';

/**
 * Where lyrics come from:
 * - 'local':  prefer server / .lrc / USLT, fall back to LRCLIB online.
 * - 'online': prefer LRCLIB online search, fall back to local.
 * - 'off':    never search LRCLIB (local / server only).
 * 'local' and 'online' send the artist and title to an external service (LRCLIB).
 */
export type LyricsSource = 'local' | 'online' | 'off';

/** Tab the app starts on (and returns to after being in the background for a
 *  while). Matches the `(tabs)` route names. */
export type DefaultTab = 'index' | 'search' | 'library';

/** "Previous" button behavior: restart the track after a few seconds (default,
 *  like Spotify) or always go to the previous track (like YouTube). */
export type PreviousButtonMode = 'restart' | 'always';

/** Action when swiping a song right in lists (customizable). */
export type SwipeAction = 'off' | 'queue' | 'next' | 'favorite' | 'menu';

/** Home section row. `recentlyPlayed` and `discover` are server-only; `discover`
 *  rediscovers albums played long ago; `randomAlbums`/`randomArtists`
 *  are purely random. */
export type HomeSectionKey =
  | 'recentlyAdded'
  | 'recentlyPlayed'
  | 'mostPlayed'
  | 'discover'
  | 'playlists'
  | 'randomAlbums'
  | 'randomArtists';

/** Home section with its state (order is determined by its position in the list). */
export interface HomeSection {
  key: HomeSectionKey;
  enabled: boolean;
}

const HOME_SECTION_KEYS: HomeSectionKey[] = [
  'recentlyAdded',
  'recentlyPlayed',
  'mostPlayed',
  'discover',
  'playlists',
  'randomAlbums',
  'randomArtists',
];

/** Default order and state (optional ones off to avoid cluttering Home). */
export const DEFAULT_HOME_SECTIONS: HomeSection[] = [
  { key: 'discover', enabled: true },
  { key: 'playlists', enabled: false },
  { key: 'recentlyAdded', enabled: true },
  { key: 'recentlyPlayed', enabled: true },
  { key: 'mostPlayed', enabled: true },
  { key: 'randomAlbums', enabled: false },
  { key: 'randomArtists', enabled: false },
];

/**
 * Sanitizes the saved list: preserves user order and state, discards unknown
 * keys, and appends new sections not present (so a future version with more
 * sections doesn't break existing config).
 */
export function normalizeHomeSections(raw: unknown): HomeSection[] {
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

/** Home explore row chip. `genres` and `radio` are server-only. */
export type ExploreChipKey =
  | 'shuffle'
  | 'favorites'
  | 'albums'
  | 'artists'
  | 'genres'
  | 'radio'
  | 'history';

/** Chip with its state (order is determined by its position in the list). */
export interface ExploreChip {
  key: ExploreChipKey;
  enabled: boolean;
}

const EXPLORE_CHIP_KEYS: ExploreChipKey[] = [
  'shuffle',
  'favorites',
  'albums',
  'artists',
  'genres',
  'radio',
  'history',
];

/** Default order and state: the usual ones, all visible. */
export const DEFAULT_EXPLORE_CHIPS: ExploreChip[] = [
  { key: 'shuffle', enabled: true },
  { key: 'favorites', enabled: false },
  { key: 'albums', enabled: true },
  { key: 'artists', enabled: true },
  { key: 'genres', enabled: true },
  { key: 'radio', enabled: true },
  { key: 'history', enabled: false },
];

/**
 * Sanitizes the saved list: preserves user order and state, discards unknown
 * keys, and appends new chips not present (so a future version with more chips
 * doesn't break existing config).
 */
export function normalizeExploreChips(raw: unknown): ExploreChip[] {
  if (!Array.isArray(raw)) return DEFAULT_EXPLORE_CHIPS.map((c) => ({ ...c }));
  const seen = new Set<ExploreChipKey>();
  const out: ExploreChip[] = [];
  for (const item of raw) {
    const key = item?.key as ExploreChipKey;
    if (EXPLORE_CHIP_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key);
      out.push({ key, enabled: typeof item.enabled === 'boolean' ? item.enabled : true });
    }
  }
  for (const def of DEFAULT_EXPLORE_CHIPS) {
    if (!seen.has(def.key)) out.push({ ...def });
  }
  return out;
}

/**
 * Hideable actions from the song ⋯ menu.
 *
 * «Remove from playlist» is not included: it only appears inside a playlist, so
 * it never gets in the way elsewhere, and it's the only way to remove a single
 * song from the menu. The criterion is not "essential" but "gets in the way
 * somewhere": the rest also have another path (the heart on rows and the
 * player, the cover and card for lyrics, multi-select for download and adding
 * to a list).
 *
 * Except `sleepTimer`, which only lives here: hiding it leaves the timer
 * inaccessible until re-enabled. This is a deliberate choice, not an oversight —
 * the app already allows disabling unique paths (swipe gesture, cover tap). If
 * it ever becomes an issue, the right fix is giving it a second location (the
 * player ⋯), not removing the toggle.
 */
export type SongMenuActionKey =
  | 'playlist'
  | 'artist'
  | 'album'
  | 'lyrics'
  | 'mix'
  | 'playNext'
  | 'queue'
  | 'favorite'
  | 'rating'
  | 'download'
  | 'share'
  | 'sleepTimer';

/**
 * Visibility of each action. Map instead of list (unlike chips and Home
 * sections) on purpose: order cannot be changed here, so storing it would imply
 * otherwise.
 */
export type SongMenuActions = Record<SongMenuActionKey, boolean>;

const SONG_MENU_ACTION_KEYS: SongMenuActionKey[] = [
  'playlist',
  'artist',
  'album',
  'lyrics',
  'mix',
  'playNext',
  'queue',
  'favorite',
  'rating',
  'download',
  'share',
  'sleepTimer',
];

/**
 * Everything visible. «Rating» used to start hidden, but rating is also off by
 * default in the player, so there was no way to rate a song without first
 * digging a toggle out of Settings — and it was the only action in the menu
 * that started hidden.
 */
export const DEFAULT_SONG_MENU_ACTIONS: SongMenuActions = {
  playlist: true,
  artist: true,
  album: true,
  lyrics: true,
  mix: true,
  playNext: true,
  queue: true,
  favorite: true,
  rating: true,
  download: true,
  share: true,
  sleepTimer: true,
};

/**
 * Sanitizes saved data: only accepts booleans for known keys. Anything missing
 * (e.g. a new action) stays visible, which is the default.
 */
export function normalizeSongMenuActions(raw: unknown): SongMenuActions {
  const out = { ...DEFAULT_SONG_MENU_ACTIONS };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const key of SONG_MENU_ACTION_KEYS) {
    if (typeof obj[key] === 'boolean') out[key] = obj[key];
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
  typewriter: 'Typewriter',
};

/** Actual font family for each option; `undefined` = system default font. */
export const APP_FONT_FAMILY: Record<AppFont, string | undefined> = {
  system: undefined,
  condensed: 'sans-serif-condensed',
  serif: 'serif',
  monospace: 'monospace',
  casual: 'casual',
  // Cutive Mono (AOSP serif-monospace family): typewriter style.
  typewriter: 'serif-monospace',
};

interface SettingsState {
  /** Streaming quality over Wi-Fi (and any non-cellular network). */
  maxBitRate: number;
  /** Streaming quality over cellular. */
  maxBitRateCellular: number;
  /** Download quality: 0 = original file; rest, transcoded bitrate. */
  downloadBitRate: number;
  /** Streaming transcode codec ('' = server default). */
  streamFormat: TranscodeFormat;
  /** Download transcode codec ('' = server default). */
  downloadFormat: TranscodeFormat;
  /** Download only over Wi-Fi (blocks downloads on cellular). */
  downloadWifiOnly: boolean;
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
  /** Song duration in lists (Spotify doesn't show it). */
  showSongDuration: boolean;
  /** Rating stars per song in lists. */
  showListRating: boolean;
  /** When the queue ends, continue with similar songs (getSimilarSongs2). */
  autoplaySimilar: boolean;
  /** Crossfade seconds between songs (0 = disabled). */
  crossfadeSec: number;
  /**
   * Join one track to the next with no silence: the next one is queued in the
   * player itself, which buffers it in advance. On by default (nobody asks for
   * the gap), but it can be turned off, since it means fetching the next track
   * while the current one plays. Crossfade, when set, takes over the change and
   * this steps aside.
   */
  gapless: boolean;
  /**
   * Pre-warm the stream for upcoming tracks in the queue. Designed for proxies
   * like Octo Fiesta or slow origins that serve the track on the fly: requests
   * the URL ahead of time so the server has it ready when needed. Off by
   * default: on a normal server it adds no value and only creates extra work
   * (transcodes, stats) without the user asking.
   */
  preloadUpcoming: boolean;
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
   * Show non-square artwork whole in the player instead of cropping it to a
   * square. Off by default: cropping is what it has always done, and every
   * other place in the app (lists, cards, grids) keeps cropping regardless.
   */
  fitCoverArt: boolean;
  /** Mini-player tinted with the dominant color of the cover art. */
  miniPlayerColorBackground: boolean;
  /** Lyrics card below the player controls. */
  showLyricsCard: boolean;
  /** What tapping the player cover does (nothing / lyrics screen /
   *  lyrics in place of the cover). */
  coverTapAction: CoverTapAction;
  /** Marquee: long titles in the player auto-scroll. */
  marqueeTitles: boolean;
  /** Player bottom buttons (queue and devices). */
  showQueueButton: boolean;
  showDevicesButton: boolean;
  /** Seek ±N seconds buttons next to play (0 = hidden). Only 5/10/30: these are the numbered icons that exist in MaterialIcons. */
  seekButtonsSec: number;
  /** "Previous" button behavior (restart track or always go to previous). */
  previousButtonMode: PreviousButtonMode;
  /** Action when swiping a song right in lists. */
  swipeAction: SwipeAction;
  /** Action when swiping a song left in lists. */
  swipeLeftAction: SwipeAction;
  /** Home album rows, in order (each with its state). */
  homeSections: HomeSection[];
  /** Quick access grid (Favorites + recent) at the top of Home. */
  showQuickGrid: boolean;
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
  exploreChips: ExploreChip[];
  /** Which actions are visible in the song ⋯ menu. */
  songMenuActions: SongMenuActions;
  /** "Folders" section in the Library (directory browsing; Subsonic). */
  showFolderBrowser: boolean;
  /** Optional button visibility, for those who prefer a minimal UI. */
  showHistoryButton: boolean;
  showProfileButton: boolean;
  /** App startup tab (Home/Search/Library). */
  defaultTab: DefaultTab;
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
  /** List or grid in an artist's full discography. Its own key, again for the
   *  same reason: it's one artist's albums, not the whole library. */
  discographyLayout: ListLayout;
  /** List or grid on a genre's albums. Its own key, same reasoning. */
  genreLayout: ListLayout;
  /** Accent color (hex). */
  accentColor: string;
  /** UI font (system font family; `system` = default). */
  appFont: AppFont;
  setMaxBitRate: (value: number) => void;
  setMaxBitRateCellular: (value: number) => void;
  setDownloadBitRate: (value: number) => void;
  setStreamFormat: (value: TranscodeFormat) => void;
  setDownloadFormat: (value: TranscodeFormat) => void;
  setDownloadWifiOnly: (value: boolean) => void;
  setLanguage: (language: Language) => void;
  setShowAudioQuality: (value: boolean) => void;
  setShowRating: (value: boolean) => void;
  setShowAlbumInfo: (value: boolean) => void;
  setSwapPlayerButtons: (value: boolean) => void;
  setShowPlayedInQueue: (value: boolean) => void;
  setShowListArtwork: (value: boolean) => void;
  setShowSongDuration: (value: boolean) => void;
  setShowListRating: (value: boolean) => void;
  setAutoplaySimilar: (value: boolean) => void;
  setCrossfadeSec: (value: number) => void;
  setGapless: (value: boolean) => void;
  setPreloadUpcoming: (value: boolean) => void;
  setAutoOfflineSwitch: (value: boolean) => void;
  setHideUnavailableOffline: (value: boolean) => void;
  setReplayGain: (value: ReplayGainMode) => void;
  setKeepScreenAwake: (value: boolean) => void;
  setHapticsEnabled: (value: boolean) => void;
  setLyricsBackground: (value: ScreenBackground) => void;
  setLyricsCardBackground: (value: CardBackground) => void;
  setLyricsSource: (value: LyricsSource) => void;
  setShowArtistPhoto: (value: boolean) => void;
  setShowDiscHeaders: (value: boolean) => void;
  setShowGenreChips: (value: boolean) => void;
  setBatteryWarning: (value: boolean) => void;
  setPlayerBackground: (value: ScreenBackground) => void;
  setFitCoverArt: (value: boolean) => void;
  setMiniPlayerColorBackground: (value: boolean) => void;
  setShowLyricsCard: (value: boolean) => void;
  setCoverTapAction: (value: CoverTapAction) => void;
  setMarqueeTitles: (value: boolean) => void;
  setShowQueueButton: (value: boolean) => void;
  setShowDevicesButton: (value: boolean) => void;
  setSeekButtonsSec: (value: number) => void;
  setPreviousButtonMode: (value: PreviousButtonMode) => void;
  setSwipeAction: (value: SwipeAction) => void;
  setSwipeLeftAction: (value: SwipeAction) => void;
  setHomeSection: (key: HomeSectionKey, value: boolean) => void;
  /** Replace the full list (for reordering). */
  setHomeSections: (sections: HomeSection[]) => void;
  setShowQuickGrid: (value: boolean) => void;
  setQuickGridFavorites: (value: boolean) => void;
  setQuickGridAlbums: (value: boolean) => void;
  setQuickGridPlaylists: (value: boolean) => void;
  setQuickGridSize: (value: number) => void;
  setShowGreeting: (value: boolean) => void;
  /** Trims to GREETING_MAX internally: the cap doesn't depend on the caller. */
  setCustomGreeting: (value: string) => void;
  setExploreChip: (key: ExploreChipKey, value: boolean) => void;
  /** Replace the full list (for reordering). */
  setExploreChips: (chips: ExploreChip[]) => void;
  setSongMenuAction: (key: SongMenuActionKey, value: boolean) => void;
  setShowFolderBrowser: (value: boolean) => void;
  setShowHistoryButton: (value: boolean) => void;
  setShowProfileButton: (value: boolean) => void;
  setDefaultTab: (value: DefaultTab) => void;
  setLibrarySort: (value: LibrarySort) => void;
  setLibraryLayout: (value: ListLayout) => void;
  setBrowseArtistsLayout: (value: ListLayout) => void;
  setBrowseAlbumsLayout: (value: ListLayout) => void;
  setDiscographyLayout: (value: ListLayout) => void;
  setGenreLayout: (value: ListLayout) => void;
  setAccentColor: (value: string) => void;
  setAppFont: (value: AppFont) => void;
  /** Resets to factory defaults (language is preserved). */
  resetToDefaults: () => void;
  /** The saved settings have been read from disk. Until then everything is at
   *  its default, so anything that acts ON a setting must wait for this. */
  hydrated: boolean;
  hydrate: () => Promise<void>;
}

const scope = profileScopeGuard();

function persist(state: ReturnType<typeof snapshot>) {
  const key = settingsKey();
  // Never write one profile's settings under another's key, and never write
  // before hydrating: both save factory defaults over real preferences and the
  // next hydrate reads them back as good. See `profileScopeGuard`.
  if (!scope.owns(key)) return;
  void setItem(key, JSON.stringify(state));
}

function snapshot(get: () => SettingsState) {
  const s = get();
  return {
    maxBitRate: s.maxBitRate,
    maxBitRateCellular: s.maxBitRateCellular,
    downloadBitRate: s.downloadBitRate,
    streamFormat: s.streamFormat,
    downloadFormat: s.downloadFormat,
    downloadWifiOnly: s.downloadWifiOnly,
    // `language` is not in the profile blob: it's global (see LANG_KEY).
    showAudioQuality: s.showAudioQuality,
    showRating: s.showRating,
    showAlbumInfo: s.showAlbumInfo,
    swapPlayerButtons: s.swapPlayerButtons,
    showPlayedInQueue: s.showPlayedInQueue,
    showListArtwork: s.showListArtwork,
    showSongDuration: s.showSongDuration,
    showListRating: s.showListRating,
    autoplaySimilar: s.autoplaySimilar,
    crossfadeSec: s.crossfadeSec,
    gapless: s.gapless,
    preloadUpcoming: s.preloadUpcoming,
    autoOfflineSwitch: s.autoOfflineSwitch,
    hideUnavailableOffline: s.hideUnavailableOffline,
    replayGain: s.replayGain,
    keepScreenAwake: s.keepScreenAwake,
    hapticsEnabled: s.hapticsEnabled,
    lyricsBackground: s.lyricsBackground,
    lyricsCardBackground: s.lyricsCardBackground,
    lyricsSource: s.lyricsSource,
    showArtistPhoto: s.showArtistPhoto,
    showDiscHeaders: s.showDiscHeaders,
    showGenreChips: s.showGenreChips,
    batteryWarning: s.batteryWarning,
    playerBackground: s.playerBackground,
    fitCoverArt: s.fitCoverArt,
    miniPlayerColorBackground: s.miniPlayerColorBackground,
    showLyricsCard: s.showLyricsCard,
    coverTapAction: s.coverTapAction,
    marqueeTitles: s.marqueeTitles,
    showQueueButton: s.showQueueButton,
    showDevicesButton: s.showDevicesButton,
    seekButtonsSec: s.seekButtonsSec,
    previousButtonMode: s.previousButtonMode,
    swipeAction: s.swipeAction,
    swipeLeftAction: s.swipeLeftAction,
    homeSections: s.homeSections,
    showQuickGrid: s.showQuickGrid,
    quickGridFavorites: s.quickGridFavorites,
    quickGridAlbums: s.quickGridAlbums,
    quickGridPlaylists: s.quickGridPlaylists,
    quickGridSize: s.quickGridSize,
    showGreeting: s.showGreeting,
    customGreeting: s.customGreeting,
    exploreChips: s.exploreChips,
    songMenuActions: s.songMenuActions,
    showFolderBrowser: s.showFolderBrowser,
    showHistoryButton: s.showHistoryButton,
    showProfileButton: s.showProfileButton,
    defaultTab: s.defaultTab,
    librarySort: s.librarySort,
    libraryLayout: s.libraryLayout,
    browseArtistsLayout: s.browseArtistsLayout,
    browseAlbumsLayout: s.browseAlbumsLayout,
    discographyLayout: s.discographyLayout,
    genreLayout: s.genreLayout,
    accentColor: s.accentColor,
    appFont: s.appFont,
  };
}

/** Factory default values for all preferences. */
const DEFAULTS = {
  maxBitRate: 0,
  maxBitRateCellular: 0,
  downloadBitRate: 0,
  streamFormat: '' as TranscodeFormat,
  downloadFormat: '' as TranscodeFormat,
  downloadWifiOnly: false,
  language: 'en' as Language,
  showAudioQuality: false,
  showRating: false,
  showAlbumInfo: false,
  swapPlayerButtons: false,
  showPlayedInQueue: false,
  showListArtwork: true,
  showSongDuration: false,
  showListRating: false,
  autoplaySimilar: true,
  crossfadeSec: 0,
  gapless: true,
  preloadUpcoming: false,
  autoOfflineSwitch: true,
  hideUnavailableOffline: false,
  replayGain: 'off' as ReplayGainMode,
  keepScreenAwake: false,
  hapticsEnabled: false,
  lyricsBackground: 'color' as ScreenBackground,
  lyricsCardBackground: 'color' as CardBackground,
  lyricsSource: 'local' as LyricsSource,
  showArtistPhoto: true,
  showDiscHeaders: true,
  showGenreChips: false,
  batteryWarning: true,
  playerBackground: 'cover' as ScreenBackground,
  fitCoverArt: false,
  miniPlayerColorBackground: true,
  showLyricsCard: true,
  // By default, tapping the cover opens the lyrics screen (as always).
  coverTapAction: 'screen' as CoverTapAction,
  marqueeTitles: true,
  showQueueButton: true,
  showDevicesButton: true,
  seekButtonsSec: 0,
  previousButtonMode: 'restart' as PreviousButtonMode,
  // By default, swiping right queues (previous behavior) and left does
  // nothing (opt-in).
  swipeAction: 'queue' as SwipeAction,
  swipeLeftAction: 'off' as SwipeAction,
  homeSections: DEFAULT_HOME_SECTIONS.map((s) => ({ ...s })),
  showQuickGrid: true,
  quickGridFavorites: true,
  quickGridAlbums: true,
  quickGridPlaylists: true,
  quickGridSize: 8,
  showGreeting: true,
  customGreeting: '',
  exploreChips: DEFAULT_EXPLORE_CHIPS.map((c) => ({ ...c })),
  songMenuActions: { ...DEFAULT_SONG_MENU_ACTIONS },
  showFolderBrowser: false,
  showHistoryButton: true,
  showProfileButton: true,
  defaultTab: 'index' as DefaultTab,
  librarySort: 'recent' as LibrarySort,
  libraryLayout: 'list' as ListLayout,
  // Grid by default: an artist is recognized by their face, and that's how the
  // screen is already rendered. List is for those who prefer scanning names.
  browseArtistsLayout: 'grid' as ListLayout,
  // Grid by default: the cover is what identifies an album, and that's how the
  // screen is already rendered.
  browseAlbumsLayout: 'grid' as ListLayout,
  // List by default: that's how the discography has always been shown, and the
  // toggle is right there for whoever prefers blocks.
  discographyLayout: 'list' as ListLayout,
  // Grid, like browsing albums: a genre is browsed by cover, not read by name.
  genreLayout: 'grid' as ListLayout,
  accentColor: DEFAULT_ACCENT,
  appFont: 'system' as AppFont,
};

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  setMaxBitRate: (maxBitRate) => {
    set({ maxBitRate });
    persist(snapshot(get));
  },

  setMaxBitRateCellular: (maxBitRateCellular) => {
    set({ maxBitRateCellular });
    persist(snapshot(get));
  },

  setStreamFormat: (streamFormat) => {
    set({ streamFormat });
    persist(snapshot(get));
  },

  setDownloadFormat: (downloadFormat) => {
    set({ downloadFormat });
    persist(snapshot(get));
  },

  setDownloadBitRate: (downloadBitRate) => {
    set({ downloadBitRate });
    persist(snapshot(get));
  },

  setDownloadWifiOnly: (downloadWifiOnly) => {
    set({ downloadWifiOnly });
    persist(snapshot(get));
  },

  setLanguage: (language) => {
    set({ language });
    void setItem(LANG_KEY, language); // global language, not per profile
  },

  setShowAudioQuality: (showAudioQuality) => {
    set({ showAudioQuality });
    persist(snapshot(get));
  },

  setShowAlbumInfo: (showAlbumInfo) => {
    set({ showAlbumInfo });
    persist(snapshot(get));
  },

  setSwapPlayerButtons: (swapPlayerButtons) => {
    set({ swapPlayerButtons });
    persist(snapshot(get));
  },

  setShowPlayedInQueue: (showPlayedInQueue) => {
    set({ showPlayedInQueue });
    persist(snapshot(get));
  },

  setShowRating: (showRating) => {
    set({ showRating });
    persist(snapshot(get));
  },

  setShowListArtwork: (showListArtwork) => {
    set({ showListArtwork });
    persist(snapshot(get));
  },

  setShowSongDuration: (showSongDuration) => {
    set({ showSongDuration });
    persist(snapshot(get));
  },

  setShowListRating: (showListRating) => {
    set({ showListRating });
    persist(snapshot(get));
  },

  setAutoplaySimilar: (autoplaySimilar) => {
    set({ autoplaySimilar });
    persist(snapshot(get));
  },

  setCrossfadeSec: (crossfadeSec) => {
    set({ crossfadeSec });
    persist(snapshot(get));
  },

  setGapless: (gapless) => {
    set({ gapless });
    persist(snapshot(get));
  },

  setPreloadUpcoming: (preloadUpcoming) => {
    set({ preloadUpcoming });
    persist(snapshot(get));
  },

  setAutoOfflineSwitch: (autoOfflineSwitch) => {
    set({ autoOfflineSwitch });
    persist(snapshot(get));
  },

  setHideUnavailableOffline: (hideUnavailableOffline) => {
    set({ hideUnavailableOffline });
    persist(snapshot(get));
    // Changes what offline queries return (filters out non-downloaded or not):
    // refresh lists so the change is visible immediately.
    if (useAuthStore.getState().offline) queryClient.invalidateQueries();
  },

  setReplayGain: (replayGain) => {
    set({ replayGain });
    persist(snapshot(get));
  },

  setKeepScreenAwake: (keepScreenAwake) => {
    set({ keepScreenAwake });
    persist(snapshot(get));
  },

  setHapticsEnabled: (hapticsEnabled) => {
    set({ hapticsEnabled });
    persist(snapshot(get));
  },

  setLyricsCardBackground: (lyricsCardBackground) => {
    set({ lyricsCardBackground });
    persist(snapshot(get));
  },

  setLyricsBackground: (lyricsBackground) => {
    set({ lyricsBackground });
    persist(snapshot(get));
  },

  setLyricsSource: (lyricsSource) => {
    set({ lyricsSource });
    persist(snapshot(get));
  },

  setShowDiscHeaders: (showDiscHeaders) => {
    set({ showDiscHeaders });
    persist(snapshot(get));
  },

  setShowGenreChips: (showGenreChips) => {
    set({ showGenreChips });
    persist(snapshot(get));
  },

  setBatteryWarning: (batteryWarning) => {
    set({ batteryWarning });
    persist(snapshot(get));
  },

  setShowArtistPhoto: (showArtistPhoto) => {
    set({ showArtistPhoto });
    persist(snapshot(get));
  },

  setFitCoverArt: (fitCoverArt) => {
    set({ fitCoverArt });
    persist(snapshot(get));
  },

  setPlayerBackground: (playerBackground) => {
    set({ playerBackground });
    persist(snapshot(get));
  },

  setMiniPlayerColorBackground: (miniPlayerColorBackground) => {
    set({ miniPlayerColorBackground });
    persist(snapshot(get));
  },

  setShowLyricsCard: (showLyricsCard) => {
    set({ showLyricsCard });
    persist(snapshot(get));
  },

  setCoverTapAction: (coverTapAction) => {
    set({ coverTapAction });
    persist(snapshot(get));
  },

  setMarqueeTitles: (marqueeTitles) => {
    set({ marqueeTitles });
    persist(snapshot(get));
  },

  setShowQueueButton: (showQueueButton) => {
    set({ showQueueButton });
    persist(snapshot(get));
  },

  setShowDevicesButton: (showDevicesButton) => {
    set({ showDevicesButton });
    persist(snapshot(get));
  },

  setSeekButtonsSec: (seekButtonsSec) => {
    set({ seekButtonsSec });
    persist(snapshot(get));
  },

  setPreviousButtonMode: (previousButtonMode) => {
    set({ previousButtonMode });
    persist(snapshot(get));
  },

  setSwipeLeftAction: (swipeLeftAction) => {
    set({ swipeLeftAction });
    persist(snapshot(get));
  },

  setHomeSection: (key, value) => {
    set((s) => ({
      homeSections: s.homeSections.map((x) => (x.key === key ? { ...x, enabled: value } : x)),
    }));
    persist(snapshot(get));
  },

  setHomeSections: (homeSections) => {
    set({ homeSections });
    persist(snapshot(get));
  },

  setSwipeAction: (swipeAction) => {
    set({ swipeAction });
    persist(snapshot(get));
  },

  setShowGreeting: (showGreeting) => {
    set({ showGreeting });
    persist(snapshot(get));
  },

  setCustomGreeting: (customGreeting) => {
    set({ customGreeting: customGreeting.slice(0, GREETING_MAX) });
    persist(snapshot(get));
  },

  setShowQuickGrid: (showQuickGrid) => {
    set({ showQuickGrid });
    persist(snapshot(get));
  },

  setQuickGridFavorites: (quickGridFavorites) => {
    set({ quickGridFavorites });
    persist(snapshot(get));
  },

  setQuickGridAlbums: (quickGridAlbums) => {
    set({ quickGridAlbums });
    persist(snapshot(get));
  },

  setQuickGridPlaylists: (quickGridPlaylists) => {
    set({ quickGridPlaylists });
    persist(snapshot(get));
  },

  setQuickGridSize: (quickGridSize) => {
    set({ quickGridSize });
    persist(snapshot(get));
  },

  setExploreChip: (key, value) => {
    set((s) => ({
      exploreChips: s.exploreChips.map((x) => (x.key === key ? { ...x, enabled: value } : x)),
    }));
    persist(snapshot(get));
  },

  setSongMenuAction: (key, value) => {
    set((s) => ({ songMenuActions: { ...s.songMenuActions, [key]: value } }));
    persist(snapshot(get));
  },

  setExploreChips: (exploreChips) => {
    set({ exploreChips });
    persist(snapshot(get));
  },

  setShowFolderBrowser: (showFolderBrowser) => {
    set({ showFolderBrowser });
    persist(snapshot(get));
  },

  setShowHistoryButton: (showHistoryButton) => {
    set({ showHistoryButton });
    persist(snapshot(get));
  },

  setShowProfileButton: (showProfileButton) => {
    set({ showProfileButton });
    persist(snapshot(get));
  },

  setDefaultTab: (defaultTab) => {
    set({ defaultTab });
    persist(snapshot(get));
  },

  setLibraryLayout: (libraryLayout) => {
    set({ libraryLayout });
    persist(snapshot(get));
  },

  setBrowseArtistsLayout: (browseArtistsLayout) => {
    set({ browseArtistsLayout });
    persist(snapshot(get));
  },

  setBrowseAlbumsLayout: (browseAlbumsLayout) => {
    set({ browseAlbumsLayout });
    persist(snapshot(get));
  },

  setDiscographyLayout: (discographyLayout) => {
    set({ discographyLayout });
    persist(snapshot(get));
  },

  setGenreLayout: (genreLayout) => {
    set({ genreLayout });
    persist(snapshot(get));
  },

  setAccentColor: (accentColor) => {
    applyAccent(accentColor);
    set({ accentColor });
    persist(snapshot(get));
  },

  setLibrarySort: (librarySort) => {
    set({ librarySort });
    persist(snapshot(get));
  },

  setAppFont: (appFont) => {
    set({ appFont });
    persist(snapshot(get));
  },

  resetToDefaults: () => {
    // Language is preserved: resetting shouldn't change your language.
    set({ ...DEFAULTS, language: get().language });
    applyAccent(DEFAULT_ACCENT);
    persist(snapshot(get));
  },

  hydrate: async () => {
    const key = settingsKey();
    const token = scope.start();
    let applied = false;
    try {
      // Active profile settings; if it doesn't have its own yet, inherits the
      // old (shared) ones as fallback/migration. Read BEFORE touching the
      // store: resetting to factory up front left the settings in memory at
      // default values for the whole read, and anything saved in that window
      // wrote those defaults over the real ones.
      const raw = (await getItem(key)) ?? (await getItem(STORAGE_KEY));
      // Read here, with `raw`, so nothing is awaited once the store is claimed.
      const ratingShown = await getItem(ratingShownKey());
      // A newer hydration started while we were reading (profile switch, or
      // the saved session arriving on startup): it owns the store now, and
      // applying this would restore the wrong profile's settings.
      if (!scope.accept(token, key)) return;
      // Reset to factory (preserving language, which is global): on profile
      // switch it must not inherit the previous profile's settings. Accent is
      // applied manually because it's a side effect (the blob re-applies it if
      // present); the font is reactive and doesn't need it.
      set({ ...DEFAULTS, language: get().language });
      applyAccent(DEFAULT_ACCENT);
      applied = true;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          maxBitRate: number;
          maxBitRateCellular: number;
          downloadBitRate: number;
          streamFormat: TranscodeFormat;
          downloadFormat: TranscodeFormat;
          downloadWifiOnly: boolean;
          language: Language;
          showAudioQuality: string | boolean;
          showRating: boolean;
          showAlbumInfo: boolean;
          swapPlayerButtons: boolean;
          showPlayedInQueue: boolean;
          showListArtwork: boolean;
          showSongDuration: boolean;
          showListRating: boolean;
          autoplaySimilar: boolean;
          crossfadeSec: number;
          gapless: boolean;
          preloadUpcoming: boolean;
          autoOfflineSwitch: boolean;
          hideUnavailableOffline: boolean;
          replayGain: ReplayGainMode;
          keepScreenAwake: boolean;
          hapticsEnabled: boolean;
          lyricsBackground: ScreenBackground;
          lyricsCardBackground: CardBackground;
          lyricsColorBackground: boolean;
          lyricsSource?: LyricsSource;
          lyricsOnlineFallback?: boolean;
          showArtistPhoto: boolean;
          showDiscHeaders: boolean;
          showGenreChips: boolean;
          batteryWarning: boolean;
          playerBackground: ScreenBackground;
          fitCoverArt: boolean;
          playerColorBackground: boolean;
          miniPlayerColorBackground: boolean;
          showLyricsCard: boolean;
          coverTapAction: CoverTapAction;
          marqueeTitles: boolean;
          showQueueButton: boolean;
          showDevicesButton: boolean;
          seekButtonsSec: number;
          previousButtonMode: PreviousButtonMode;
          swipeAction: SwipeAction;
          swipeLeftAction: SwipeAction;
          homeSections: unknown;
          /** Old setting (boolean); migrated to swipeAction. */
          swipeToQueue: boolean;
          showQuickGrid: boolean;
          quickGridFavorites: boolean;
          quickGridAlbums: boolean;
          quickGridPlaylists: boolean;
          quickGridSize: number;
          showGreeting: boolean;
          customGreeting: string;
          showExploreChips: boolean;
          exploreChips: unknown;
          songMenuActions: unknown;
          showFolderBrowser: boolean;
          showHistoryButton: boolean;
          showProfileButton: boolean;
          defaultTab: DefaultTab;
          librarySort: LibrarySort;
          libraryLayout: ListLayout;
          browseArtistsLayout: ListLayout;
          browseAlbumsLayout: ListLayout;
          discographyLayout: ListLayout;
          genreLayout: ListLayout;
          accentColor: string;
          appFont: AppFont;
        }>;
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
        if (TRANSCODE_FORMATS.includes(parsed.streamFormat as TranscodeFormat)) {
          set({ streamFormat: parsed.streamFormat as TranscodeFormat });
        }
        if (TRANSCODE_FORMATS.includes(parsed.downloadFormat as TranscodeFormat)) {
          set({ downloadFormat: parsed.downloadFormat as TranscodeFormat });
        }
        if (typeof parsed.downloadWifiOnly === 'boolean') {
          set({ downloadWifiOnly: parsed.downloadWifiOnly });
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
        if (typeof parsed.showRating === 'boolean') {
          set({ showRating: parsed.showRating });
        }
        if (typeof parsed.showAlbumInfo === 'boolean') {
          set({ showAlbumInfo: parsed.showAlbumInfo });
        }
        if (typeof parsed.swapPlayerButtons === 'boolean') {
          set({ swapPlayerButtons: parsed.swapPlayerButtons });
        }
        if (typeof parsed.showPlayedInQueue === 'boolean') {
          set({ showPlayedInQueue: parsed.showPlayedInQueue });
        }
        if (typeof parsed.showListArtwork === 'boolean') {
          set({ showListArtwork: parsed.showListArtwork });
        }
        if (typeof parsed.showSongDuration === 'boolean') {
          set({ showSongDuration: parsed.showSongDuration });
        }
        if (typeof parsed.showListRating === 'boolean') {
          set({ showListRating: parsed.showListRating });
        }
        if (typeof parsed.autoplaySimilar === 'boolean') {
          set({ autoplaySimilar: parsed.autoplaySimilar });
        }
        if (typeof parsed.crossfadeSec === 'number' && parsed.crossfadeSec >= 0) {
          set({ crossfadeSec: parsed.crossfadeSec });
        }
        if (typeof parsed.gapless === 'boolean') {
          set({ gapless: parsed.gapless });
        }
        if (typeof parsed.preloadUpcoming === 'boolean') {
          set({ preloadUpcoming: parsed.preloadUpcoming });
        }
        if (typeof parsed.autoOfflineSwitch === 'boolean') {
          set({ autoOfflineSwitch: parsed.autoOfflineSwitch });
        }
        if (typeof parsed.hideUnavailableOffline === 'boolean') {
          set({ hideUnavailableOffline: parsed.hideUnavailableOffline });
        }
        if (
          parsed.replayGain === 'off' ||
          parsed.replayGain === 'auto' ||
          parsed.replayGain === 'track' ||
          parsed.replayGain === 'album'
        ) {
          set({ replayGain: parsed.replayGain });
        }
        if (typeof parsed.keepScreenAwake === 'boolean') {
          set({ keepScreenAwake: parsed.keepScreenAwake });
        }
        if (typeof parsed.hapticsEnabled === 'boolean') {
          set({ hapticsEnabled: parsed.hapticsEnabled });
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
        if (typeof parsed.showArtistPhoto === 'boolean') {
          set({ showArtistPhoto: parsed.showArtistPhoto });
        }
        if (typeof parsed.showGenreChips === 'boolean') {
          set({ showGenreChips: parsed.showGenreChips });
        }
        if (typeof parsed.batteryWarning === 'boolean') {
          set({ batteryWarning: parsed.batteryWarning });
        }
        if (typeof parsed.showDiscHeaders === 'boolean') {
          set({ showDiscHeaders: parsed.showDiscHeaders });
        }
        if (typeof parsed.fitCoverArt === 'boolean') {
          set({ fitCoverArt: parsed.fitCoverArt });
        }
        if (parsed.playerBackground === 'none' || parsed.playerBackground === 'color' || parsed.playerBackground === 'cover') {
          set({ playerBackground: parsed.playerBackground });
        } else if (typeof parsed.playerColorBackground === 'boolean') {
          // Migration from the old boolean: on → the tinted background it
          // already had, off → flat. Profiles saved before the blurred cover
          // option existed keep looking exactly the same.
          set({ playerBackground: parsed.playerColorBackground ? 'color' : 'none' });
        }
        if (typeof parsed.miniPlayerColorBackground === 'boolean') {
          set({ miniPlayerColorBackground: parsed.miniPlayerColorBackground });
        }
        if (typeof parsed.showLyricsCard === 'boolean') {
          set({ showLyricsCard: parsed.showLyricsCard });
        }
        if (
          parsed.coverTapAction === 'none' ||
          parsed.coverTapAction === 'screen' ||
          parsed.coverTapAction === 'inline'
        ) {
          set({ coverTapAction: parsed.coverTapAction });
        }
        if (typeof parsed.marqueeTitles === 'boolean') {
          set({ marqueeTitles: parsed.marqueeTitles });
        }
        if (typeof parsed.showQueueButton === 'boolean') {
          set({ showQueueButton: parsed.showQueueButton });
        }
        if (typeof parsed.showDevicesButton === 'boolean') {
          set({ showDevicesButton: parsed.showDevicesButton });
        }
        if (parsed.seekButtonsSec === 0 || parsed.seekButtonsSec === 5 || parsed.seekButtonsSec === 10 || parsed.seekButtonsSec === 30) {
          set({ seekButtonsSec: parsed.seekButtonsSec });
        }
        if (parsed.previousButtonMode === 'restart' || parsed.previousButtonMode === 'always') {
          set({ previousButtonMode: parsed.previousButtonMode });
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
        if (typeof parsed.showQuickGrid === 'boolean') {
          set({ showQuickGrid: parsed.showQuickGrid });
        }
        if (typeof parsed.quickGridFavorites === 'boolean') {
          set({ quickGridFavorites: parsed.quickGridFavorites });
        }
        if (typeof parsed.quickGridAlbums === 'boolean') {
          set({ quickGridAlbums: parsed.quickGridAlbums });
        }
        if (typeof parsed.quickGridPlaylists === 'boolean') {
          set({ quickGridPlaylists: parsed.quickGridPlaylists });
        }
        if (parsed.quickGridSize === 4 || parsed.quickGridSize === 6 || parsed.quickGridSize === 8) {
          set({ quickGridSize: parsed.quickGridSize });
        }
        if (typeof parsed.showGreeting === 'boolean') {
          set({ showGreeting: parsed.showGreeting });
        }
        // Truncated on hydrate: a setting saved by a version with a different
        // cap must not sneak in longer than what fits.
        if (typeof parsed.customGreeting === 'string') {
          set({ customGreeting: parsed.customGreeting.slice(0, GREETING_MAX) });
        }
        if (parsed.songMenuActions) {
          set({ songMenuActions: normalizeSongMenuActions(parsed.songMenuActions) });
        }
        if (Array.isArray(parsed.exploreChips)) {
          set({ exploreChips: normalizeExploreChips(parsed.exploreChips) });
        } else if (parsed.showExploreChips === false) {
          // Migration from the previous single toggle: whoever had the row
          // hidden should still not see it, not find the chips back. Turning
          // them all off is exactly what hides it now.
          set({ exploreChips: DEFAULT_EXPLORE_CHIPS.map((c) => ({ ...c, enabled: false })) });
        }
        if (typeof parsed.showFolderBrowser === 'boolean') {
          set({ showFolderBrowser: parsed.showFolderBrowser });
        }
        if (typeof parsed.showHistoryButton === 'boolean') {
          set({ showHistoryButton: parsed.showHistoryButton });
        }
        if (typeof parsed.showProfileButton === 'boolean') {
          set({ showProfileButton: parsed.showProfileButton });
        }
        if (
          parsed.defaultTab === 'index' ||
          parsed.defaultTab === 'search' ||
          parsed.defaultTab === 'library'
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
        if (parsed.discographyLayout === 'list' || parsed.discographyLayout === 'grid') {
          set({ discographyLayout: parsed.discographyLayout });
        }
        if (parsed.genreLayout === 'list' || parsed.genreLayout === 'grid') {
          set({ genreLayout: parsed.genreLayout });
        }
        if (typeof parsed.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.accentColor)) {
          set({ accentColor: parsed.accentColor });
          applyAccent(parsed.accentColor);
        }
        if (parsed.appFont && parsed.appFont in APP_FONT_FAMILY) {
          set({ appFont: parsed.appFont });
        }
      }
      // One-off: «Rating» used to start hidden in the song ⋯ menu, so every
      // profile saved before this carries an explicit `false` that was never a
      // decision — just the old default. Turn it on once and save it. The
      // marker is what makes hiding it again from Settings stick, instead of
      // it coming back on every launch.
      if (!ratingShown) {
        void setItem(ratingShownKey(), '1');
        if (!get().songMenuActions.rating) {
          set((s) => ({ songMenuActions: { ...s.songMenuActions, rating: true } }));
          persist(snapshot(get));
        }
      }
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
        applyAccent(DEFAULT_ACCENT);
      }
    } finally {
      // Read or failed, what's in memory is now what this profile gets.
      set({ hydrated: true });
    }
  },
}));
