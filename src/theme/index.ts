/**
 * Resonus visual theme.
 *
 * Two palettes — the dark one the app was built around, and a light one — plus
 * an accent that can be picked in Settings › Theme. Both are chosen at runtime,
 * so nothing here can be a constant that a `StyleSheet.create` copies once at
 * import time; that is what `themed()` and `useTheme()` below are for.
 *
 * The shape of it:
 *
 *  - `colors` is a single mutable object, rewritten in place by `applyThemeMode`
 *    and `applyAccents`.
 *    Anything reading `colors.text` while rendering gets the current value.
 *  - `themed(c => ({…}))` replaces `StyleSheet.create` and returns an object
 *    whose entries are rebuilt when the theme changes. It stays a plain module
 *    constant, so it can still be exported and used outside a component.
 *  - `useTheme()` subscribes a component to those changes. It is the only part
 *    that has to be remembered per file: the values above are always current,
 *    but React still has to be told to paint again. Same idea as `useT()` for
 *    the language.
 */
import { useSyncExternalStore } from 'react';
import { Appearance, AppState, Platform } from 'react-native';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

/** Default accent (Spotify green). */
export const DEFAULT_ACCENT = '#1DB954';

/** The two appearances. Dark is what the app has always looked like. */
export type ThemeMode = 'dark' | 'light';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

/**
 * What the setting holds, which is not the same question as which appearance is
 * on screen: `system` is a standing instruction to keep asking Android,
 * `schedule` one to keep looking at the clock, and the other two are answers.
 */
export type ThemePreference = ThemeMode | 'system' | 'schedule';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'schedule' || isThemeMode(value);
}

/**
 * Every colour the app is allowed to name. Anything not in here is a literal
 * in one screen, and a literal is what stops working the moment the background
 * behind it changes.
 */
export interface Palette {
  /** Page background. */
  background: string;
  /** Cards and rows sitting on the background. */
  surface: string;
  /** A surface a step further forward: inputs, chips, pressed rows. */
  surfaceHighlight: string;
  /** Hairlines between rows and around boxes. */
  border: string;
  /** Primary text and icons. */
  text: string;
  /** Secondary text: subtitles, values on the right of a settings row. */
  textSecondary: string;
  /** Muted text: descriptions, disabled icons, placeholders. */
  textMuted: string;
  /**
   * The two times under the progress bar, on the player and on the lyrics
   * screen. A step from the greys towards white and short of it: over artwork
   * the muted greys sit too far back to be read at a glance, and full white
   * glares out of the screen beside the cover.
   */
  textTime: string;
  /** The accent, for fills (play button, active dot, switch track). */
  accent: string;
  /** The accent while pressed. */
  accentPressed: string;
  /**
   * The accent exactly as it was picked, undimmed. For the surfaces that stay
   * dark in both appearances — the snackbar, anything over artwork — where the
   * light theme's darkened accent would be the one that cannot be read.
   */
  accentVivid: string;
  /**
   * The app's own green, independent of whatever accent is picked. The login
   * screen uses it, because there the accent may still be the one belonging to
   * a profile that is not open yet. Darkened for the light appearance by the
   * same rule as the accent.
   */
  brand: string;
  /** Text and icons drawn on an accent (or `brand`) fill. */
  onAccent: string;
  /** Text and icons drawn on a `text`-coloured fill (the white pill buttons). */
  onInverse: string;
  /**
   * The floating dark bar: the toast and the multi-select bar. Dark in both
   * appearances, the way a snackbar is everywhere — it is a strip of something
   * else laid over the screen, and matching the page is what makes it read as
   * part of it.
   */
  snackbar: string;
  /** Text and icons on `snackbar`. */
  onSnackbar: string;
  /** Full-screen scrim behind a sheet that slides up from the bottom. */
  backdrop: string;
  /**
   * The same scrim, one step darker, for what asks you to decide rather than
   * to choose: a dialog, the pad that nudges a slider, the update prompt. Two
   * values and not one because a sheet is dismissed by looking away from it and
   * a dialog is not, and the darker room is what says so before reading a word.
   */
  backdropStrong: string;
  /**
   * Scrim laid over artwork so text on top of it stays readable. Dark in both
   * appearances on purpose: what it has to cover is a cover, not the theme.
   */
  scrim: string;
  /** Text over artwork (and over `scrim`), for the same reason. */
  onArtwork: string;
  /**
   * Veil over a cover that is in the library but not on this device. Unlike
   * `scrim` this one does follow the appearance: it has to read as "faded",
   * and what fades a cover is a wash of the page behind it.
   */
  veil: string;
  /** A translucent lift over a surface: progress tracks, selected rows. */
  highlight: string;
  /**
   * Wash laid over the blurred cover the player and the lyrics screen can use
   * as a backdrop, so the page's own text still reads on it. Dark under the
   * dark appearance, pale under the light one — the opposite way round from
   * `scrim`, because here what goes on top is ordinary text and not white.
   */
  coverWash: string;
  /**
   * Flat backdrop of the player with no cover colour ("None"). Not
   * `background`: it is deliberately a step away from the page, so the screen
   * that covers the app looks like a different room.
   */
  playerPlain: string;
  /** The unfilled part of the player's and the lyrics screen's slider, which
   *  lie over artwork or its tint rather than over the page. */
  mediaTrack: string;
  /**
   * The part of a switch or slider track that is not filled. Its own colour
   * rather than `border`: a hairline can afford to be nearly invisible and a
   * control that says whether a setting is on cannot.
   */
  control: string;
  /** The knob of a switch or slider. White in both, as the platform draws it. */
  knob: string;
  /** Drop shadows (paired with the per-use opacity). */
  shadow: string;
  /** Destructive actions. */
  danger: string;
  /** "It worked" state, independent of the configurable accent. */
  success: string;
}

/** The colours each appearance sets; the accent-derived ones come from `rebuild`. */
type BasePalette = Omit<
  Palette,
  'accent' | 'accentPressed' | 'accentVivid' | 'onAccent' | 'brand'
>;

/** The dark appearance, on greys with a touch of blue: a neutral grey reads flat. */
const DARK: BasePalette = {
  background: '#141619',
  surface: '#1E2026',
  surfaceHighlight: '#2A2C33',
  border: '#2B2D34',
  text: '#FFFFFF',
  textSecondary: '#A0A3AB',
  textMuted: '#72757D',
  textTime: '#DDE0E6',
  onInverse: '#000000',
  snackbar: '#30323A',
  onSnackbar: '#FFFFFF',
  backdrop: 'rgba(0,0,0,0.5)',
  backdropStrong: 'rgba(0,0,0,0.6)',
  scrim: 'rgba(0,0,0,0.45)',
  onArtwork: '#FFFFFF',
  veil: 'rgba(20,22,25,0.6)',
  highlight: 'rgba(255,255,255,0.14)',
  coverWash: 'rgba(0,0,0,0.42)',
  playerPlain: '#3a4042',
  mediaTrack: 'rgba(255,255,255,0.35)',
  control: '#2B2D34',
  knob: '#FFFFFF',
  shadow: '#000000',
  danger: '#E03131',
  success: '#2F9E44',
};

/**
 * The tints the greys can take (Settings › Theme › Background), in both
 * appearances: each is a set of greys with a touch of one hue. Blue is the
 * default, and in light it keeps the white page the app always had; neutral
 * is the plain grey from before.
 */
export type BackgroundTint =
  | 'blue'
  | 'neutral'
  | 'purple'
  | 'green'
  | 'warm'
  | 'teal'
  | 'rose'
  | 'olive';

type TintGreys = Pick<
  BasePalette,
  | 'surface'
  | 'surfaceHighlight'
  | 'border'
  | 'control'
  | 'snackbar'
  | 'textSecondary'
  | 'textMuted'
> &
  Partial<Pick<BasePalette, 'background' | 'veil'>>;

export const BACKGROUND_TINTS: Record<BackgroundTint, { dark: TintGreys; light: TintGreys }> = {
  blue: {
    dark: {
      background: '#141619',
      surface: '#1E2026',
      surfaceHighlight: '#2A2C33',
      border: '#2B2D34',
      control: '#2B2D34',
      snackbar: '#30323A',
      veil: 'rgba(20,22,25,0.6)',
      textSecondary: '#A0A3AB',
      textMuted: '#72757D',
    },
    // The default light look as it was: a white page, cards a hair blue.
    light: {
      surface: '#F4F4F6',
      surfaceHighlight: '#E7E7EB',
      border: '#E1E1E6',
      control: '#BFBFC8',
      snackbar: '#303036',
      textSecondary: '#5C5C66',
      textMuted: '#84848F',
    },
  },
  neutral: {
    dark: {
      background: '#121212',
      surface: '#1C1C1C',
      surfaceHighlight: '#282828',
      border: '#2A2A2A',
      control: '#2A2A2A',
      snackbar: '#2E2E2E',
      veil: 'rgba(18,18,18,0.6)',
      textSecondary: '#B3B3B3',
      textMuted: '#727272',
    },
    light: {
      surface: '#F4F4F4',
      surfaceHighlight: '#E8E8E8',
      border: '#E2E2E2',
      control: '#C0C0C0',
      snackbar: '#303030',
      textSecondary: '#5E5E5E',
      textMuted: '#858585',
    },
  },
  purple: {
    dark: {
      background: '#17141C',
      surface: '#211D27',
      surfaceHighlight: '#2E2935',
      border: '#302B37',
      control: '#302B37',
      snackbar: '#34303B',
      veil: 'rgba(23,20,28,0.6)',
      textSecondary: '#A7A1B0',
      textMuted: '#78727F',
    },
    light: {
      background: '#F8F5FB',
      veil: 'rgba(248,245,251,0.65)',
      surface: '#F0ECF5',
      surfaceHighlight: '#E5DFEC',
      border: '#DED7E6',
      control: '#C3BCCB',
      snackbar: '#332E3A',
      textSecondary: '#605A6A',
      textMuted: '#88818F',
    },
  },
  green: {
    dark: {
      background: '#131815',
      surface: '#1C221E',
      surfaceHighlight: '#28302A',
      border: '#2A322C',
      control: '#2A322C',
      snackbar: '#2F3731',
      veil: 'rgba(19,24,21,0.6)',
      textSecondary: '#9FA8A2',
      textMuted: '#717A74',
    },
    light: {
      background: '#F4F8F6',
      veil: 'rgba(244,248,246,0.65)',
      surface: '#ECF2EE',
      surfaceHighlight: '#DFE8E2',
      border: '#D8E1DB',
      control: '#BAC4BD',
      snackbar: '#2E3531',
      textSecondary: '#56615A',
      textMuted: '#7F8983',
    },
  },
  warm: {
    dark: {
      background: '#181512',
      surface: '#221E1A',
      surfaceHighlight: '#2F2A25',
      border: '#312C27',
      control: '#312C27',
      snackbar: '#36312B',
      veil: 'rgba(24,21,18,0.6)',
      textSecondary: '#AAA39B',
      textMuted: '#7B746D',
    },
    light: {
      background: '#FAF6F2',
      veil: 'rgba(250,246,242,0.65)',
      surface: '#F3EEE9',
      surfaceHighlight: '#E8E0D8',
      border: '#E1D9D0',
      control: '#C6BDB4',
      snackbar: '#36302A',
      textSecondary: '#645C54',
      textMuted: '#8B837B',
    },
  },
  teal: {
    dark: {
      background: '#141C1B',
      surface: '#1D2726',
      surfaceHighlight: '#293534',
      border: '#2B3736',
      control: '#2B3736',
      snackbar: '#303B3A',
      veil: 'rgba(20,28,27,0.6)',
      textSecondary: '#A1B0AF',
      textMuted: '#727F7E',
    },
    light: {
      background: '#F5FBFA',
      surface: '#ECF5F4',
      surfaceHighlight: '#DFECEB',
      border: '#D7E6E5',
      control: '#BCCBCA',
      snackbar: '#2E3A39',
      veil: 'rgba(245,251,250,0.65)',
      textSecondary: '#5A6A69',
      textMuted: '#818F8E',
    },
  },
  rose: {
    dark: {
      background: '#1C1417',
      surface: '#271D20',
      surfaceHighlight: '#35292D',
      border: '#372B2F',
      control: '#372B2F',
      snackbar: '#3B3034',
      veil: 'rgba(28,20,23,0.6)',
      textSecondary: '#B0A1A6',
      textMuted: '#7F7276',
    },
    light: {
      background: '#FBF5F7',
      surface: '#F5ECEF',
      surfaceHighlight: '#ECDFE3',
      border: '#E6D7DC',
      control: '#CBBCC1',
      snackbar: '#3A2E32',
      veil: 'rgba(251,245,247,0.65)',
      textSecondary: '#6A5A5F',
      textMuted: '#8F8186',
    },
  },
  olive: {
    dark: {
      background: '#1A1C14',
      surface: '#24271D',
      surfaceHighlight: '#323529',
      border: '#34372B',
      control: '#34372B',
      snackbar: '#383B30',
      veil: 'rgba(26,28,20,0.6)',
      textSecondary: '#ACB0A1',
      textMuted: '#7C7F72',
    },
    light: {
      background: '#F9FBF5',
      surface: '#F3F5EC',
      surfaceHighlight: '#E9ECDF',
      border: '#E2E6D7',
      control: '#C7CBBC',
      snackbar: '#373A2E',
      veil: 'rgba(249,251,245,0.65)',
      textSecondary: '#666A5A',
      textMuted: '#8C8F81',
    },
  },
};

/**
 * The dark appearance on true black, for OLED screens ("Pure black" in
 * Settings › Theme). Everything that is not the page steps down with it, so
 * cards and chips keep the same distance from the background they had.
 */
const BLACK: BasePalette = {
  ...DARK,
  textSecondary: '#B3B3B3',
  textMuted: '#727272',
  textTime: '#E2E4E8',
  background: '#000000',
  surface: '#0C0C0C',
  surfaceHighlight: '#1C1C1C',
  border: '#1E1E1E',
  snackbar: '#222222',
  veil: 'rgba(0,0,0,0.6)',
  control: '#222222',
};

/**
 * The light appearance.
 *
 * Not the dark one inverted: white cards on a white page disappear, so the
 * page is the lighter of the two and the cards sit slightly under it, which is
 * the way round every light music app does it. The greys are spaced so
 * `textSecondary` and `textMuted` still read as two different things against
 * white (6.6:1 and 3.7:1), and `danger` and `success` are darkened until they
 * clear 4.5:1 there, which the dark theme's versions do not.
 */
const LIGHT: BasePalette = {
  background: '#FFFFFF',
  surface: '#F4F4F6',
  surfaceHighlight: '#E7E7EB',
  border: '#E1E1E6',
  text: '#111113',
  textSecondary: '#5C5C66',
  textMuted: '#84848F',
  textTime: '#6E6E78',
  onInverse: '#FFFFFF',
  snackbar: '#303036',
  onSnackbar: '#FFFFFF',
  backdrop: 'rgba(0,0,0,0.35)',
  backdropStrong: 'rgba(0,0,0,0.45)',
  scrim: 'rgba(0,0,0,0.45)',
  onArtwork: '#FFFFFF',
  veil: 'rgba(255,255,255,0.65)',
  highlight: 'rgba(0,0,0,0.08)',
  coverWash: 'rgba(255,255,255,0.5)',
  playerPlain: '#E6E9EC',
  mediaTrack: 'rgba(0,0,0,0.26)',
  control: '#BFBFC8',
  knob: '#FFFFFF',
  shadow: '#000000',
  danger: '#C92A2A',
  success: '#287F38',
};

/**
 * A theme as data (Settings › Theme › Style): the palette to paint with, and
 * how the few pieces that can be drawn another way are drawn. The default
 * style is none; the chrome one and the user's own are one each. Anything a
 * theme can change is a field here, and a screen that wants to follow themes
 * reads it from here rather than asking which theme is on.
 */
export interface ThemeSpec {
  /** The appearance it is drawn in; the mode setting waits while it is on. */
  base: ThemeMode;
  colors: BasePalette;
  accent: string;
  corners: ThemeCorners;
  /** `app` keeps the font picked in Settings; `exo2` comes with the app. */
  font: 'app' | 'exo2';
  /** Section headings as written, or in spaced-out capitals. */
  headings: 'normal' | 'upper';
  /** A one-point bevel round cards and covers. */
  bevel: boolean;
  /** The player's play button: the app's own, the accent, or polished silver. */
  playButton: 'default' | 'accent' | 'silver';
  /** The navigation bar and the mini player: the app's own, or gunmetal. */
  bars: 'default' | 'metal';
}

export type ThemeCorners = 'sharp' | 'soft' | 'round';

/** Which theme is on: none (`default`), the built-in chrome, or the user's. */
export type ThemeSkin = 'default' | 'chrome' | 'custom';

export function isThemeSkin(value: unknown): value is ThemeSkin {
  return value === 'default' || value === 'chrome' || value === 'custom';
}

/**
 * What the theme creator asks for. Three colours and not twenty-nine: the
 * rest follow from these (`specFromCustom`), which is what keeps a theme made
 * in a minute readable everywhere.
 */
export interface CustomTheme {
  background: string;
  surface: string;
  accent: string;
  corners: ThemeCorners;
  font: ThemeSpec['font'];
  headings: ThemeSpec['headings'];
  bevel: boolean;
  playButton: ThemeSpec['playButton'];
  bars: ThemeSpec['bars'];
}

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  background: '#101418',
  surface: '#1A2027',
  accent: '#FF4FD8',
  corners: 'soft',
  font: 'app',
  headings: 'normal',
  bevel: false,
  playButton: 'accent',
  bars: 'default',
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A saved (or, later, imported) custom theme, field by field: whatever is
 * missing or not one of the known values falls back to the default's, so an
 * old file still opens. Null when it is not an object at all.
 */
export function parseCustomTheme(raw: unknown): CustomTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_CUSTOM_THEME;
  const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback);
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    background: hex(r.background, d.background),
    surface: hex(r.surface, d.surface),
    accent: hex(r.accent, d.accent),
    corners: pick(r.corners, ['sharp', 'soft', 'round'] as const, d.corners),
    font: pick(r.font, ['app', 'exo2'] as const, d.font),
    headings: pick(r.headings, ['normal', 'upper'] as const, d.headings),
    bevel: typeof r.bevel === 'boolean' ? r.bevel : d.bevel,
    playButton: pick(r.playButton, ['default', 'accent', 'silver'] as const, d.playButton),
    bars: pick(r.bars, ['default', 'metal'] as const, d.bars),
  };
}

const CHROME: BasePalette = {
  background: '#07090D',
  surface: '#12161D',
  surfaceHighlight: '#1C222B',
  border: '#3A4350',
  text: '#E8EEF4',
  textSecondary: '#9AA7B4',
  textMuted: '#65707C',
  textTime: '#9FF6FF',
  onInverse: '#05070A',
  snackbar: '#1C222B',
  onSnackbar: '#E8EEF4',
  backdrop: 'rgba(0,0,0,0.6)',
  backdropStrong: 'rgba(0,0,0,0.7)',
  scrim: 'rgba(0,0,0,0.5)',
  onArtwork: '#FFFFFF',
  veil: 'rgba(7,9,13,0.6)',
  highlight: 'rgba(170,200,230,0.16)',
  coverWash: 'rgba(0,0,0,0.5)',
  playerPlain: '#0D1117',
  mediaTrack: 'rgba(170,190,210,0.28)',
  control: '#2C3440',
  knob: '#DDE3EA',
  shadow: '#000000',
  danger: '#FF3B5C',
  success: '#39FF88',
};

const CHROME_ACCENT = '#00E5FF';

/**
 * The metal itself, for the few pieces that are drawn in it (play button,
 * mini player, navigation bar). Gradients top to bottom.
 */
export const chrome = {
  /** Polished silver: the play button. */
  silver: ['#FBFCFD', '#C9D0D8', '#8C96A1', '#D9DEE4', '#A7B0BA'] as const,
  silverAt: [0, 0.45, 0.5, 0.82, 1] as const,
  /** Dark brushed gunmetal: the bars. */
  gunmetal: ['#2A313B', '#161B22', '#0E1217', '#1A2028'] as const,
  gunmetalAt: [0, 0.48, 0.52, 1] as const,
  /** The lit top edge and the shadowed bottom one of a bevel. */
  edgeLight: 'rgba(255,255,255,0.35)',
  edgeDark: 'rgba(0,0,0,0.7)',
  /** Icons drawn on silver. */
  ink: '#0A0D12',
};

/** The Y2K experiment: gunmetal, brushed silver and a neon accent. */
export const CHROME_THEME: ThemeSpec = {
  base: 'dark',
  colors: CHROME,
  accent: CHROME_ACCENT,
  corners: 'sharp',
  font: 'exo2',
  headings: 'upper',
  bevel: true,
  playButton: 'silver',
  bars: 'metal',
};

/**
 * A section heading in spaced-out capitals, when the theme asks for them. Spread
 * last into a `themed()` style, so it is read again when the theme changes.
 */
export function skinHeading(): TextStyle {
  return spec?.headings === 'upper' ? { textTransform: 'uppercase', letterSpacing: 1.2 } : {};
}

/** A one-point bevel round a card or a cover, when the theme asks for one. */
export function skinBevel(): ViewStyle {
  return spec?.bevel
    ? {
        borderWidth: 1,
        borderTopColor: 'rgba(220,235,250,0.22)',
        borderLeftColor: 'rgba(220,235,250,0.12)',
        borderRightColor: 'rgba(0,0,0,0.6)',
        borderBottomColor: 'rgba(0,0,0,0.6)',
      }
    : {};
}

/** Parses `#rrggbb` into its three channels. Returns null for anything else. */
function channels(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const to = (x: number) => Math.round(Math.min(Math.max(x, 0), 255)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Darkens a hex color (~14% by default) for the "pressed" state. */
function darken(hex: string, amount = 0.14): string {
  const ch = channels(hex);
  if (!ch) return hex;
  return toHex(ch[0] * (1 - amount), ch[1] * (1 - amount), ch[2] * (1 - amount));
}

/**
 * `hex` at zero opacity, for the clear end of a gradient. Not 'transparent':
 * that is transparent black, and Android blends through it, so a fade to
 * white passes through a grey band on the way.
 */
export function transparentOf(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}00` : 'transparent';
}

/** Mixes a hex color toward white. */
function lighten(hex: string, amount: number): string {
  const ch = channels(hex);
  if (!ch) return hex;
  return toHex(...(ch.map((c) => c + (255 - c) * amount) as [number, number, number]));
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const ch = channels(hex);
  if (!ch) return 0;
  const [r, g, b] = ch.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colors. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Darkens `hex` in small steps until it reads against `bg`, or gives up; on a
 * dark `bg`, lightens it instead.
 *
 * Every accent in the picker is a vivid colour chosen to sit on near-black; on
 * white the same green is 2.6:1, which is a colour you can see but not a colour
 * you can read. Rather than keeping a second hand-picked palette for the light
 * theme (twelve more values to maintain, and nothing to stop them drifting),
 * the light accent is derived from the one the user chose. The palette already
 * clears 4.5:1 on every dark background, so on dark only a custom colour moves.
 */
function readableOn(hex: string, bg: string, ratio = 4.5): string {
  const onDark = luminance(bg) < 0.2;
  let out = hex;
  for (let i = 0; i < 12 && contrast(out, bg) < ratio; i++) {
    out = onDark ? lighten(out, 0.1) : darken(out, 0.1);
  }
  return out;
}

/** `a` moved towards `b` by `t` (0–1). */
function mix(a: string, b: string, t: number): string {
  const x = channels(a);
  const y = channels(b);
  if (!x || !y) return a;
  return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

function rgba(hex: string, alpha: number): string {
  const ch = channels(hex);
  return ch ? `rgba(${ch[0]},${ch[1]},${ch[2]},${alpha})` : hex;
}

/**
 * The whole palette from the creator's three colours. Text is black or white
 * by the background, the greys step from the surface towards the text, and
 * the accent is pushed until it reads, the same rule the app's own accents
 * follow (`readableOn`).
 */
export function specFromCustom(c: CustomTheme): ThemeSpec {
  const light = luminance(c.background) > 0.4;
  const text = light ? '#111113' : '#F2F4F7';
  const own = light ? LIGHT : DARK;
  return {
    base: light ? 'light' : 'dark',
    colors: {
      ...own,
      background: c.background,
      surface: c.surface,
      surfaceHighlight: mix(c.surface, text, 0.07),
      border: mix(c.surface, text, 0.1),
      control: mix(c.surface, text, 0.16),
      text,
      textSecondary: mix(text, c.background, 0.35),
      textMuted: mix(text, c.background, 0.55),
      textTime: mix(text, c.background, 0.15),
      snackbar: light ? own.snackbar : mix(c.surface, text, 0.12),
      veil: rgba(c.background, 0.6),
      playerPlain: mix(c.background, text, 0.06),
    },
    accent: readableOn(c.accent, c.background),
    corners: c.corners,
    font: c.font,
    headings: c.headings,
    bevel: c.bevel,
    playButton: c.playButton,
    bars: c.bars,
  };
}

/**
 * The live palette. Rewritten in place by `rebuild` so that anything holding
 * a reference to it — including code outside React — always reads the current
 * appearance.
 */
export const colors: Palette = {
  ...DARK,
  accent: DEFAULT_ACCENT,
  accentPressed: darken(DEFAULT_ACCENT),
  accentVivid: DEFAULT_ACCENT,
  brand: DEFAULT_ACCENT,
  onAccent: '#000000',
};

let currentMode: ThemeMode = 'dark';
// One accent per appearance. They are two choices and not one: a colour that
// sings on near-black can be the one that dies on white, and the picker in
// Settings is where each is made.
let darkAccent = DEFAULT_ACCENT;
let lightAccent = DEFAULT_ACCENT;
let pureBlack = false;
let tint: BackgroundTint = 'blue';
let spec: ThemeSpec | null = null;

/** Which appearance is active right now (for code outside a component). */
export function themeMode(): ThemeMode {
  return spec ? spec.base : currentMode;
}

/** The theme on, if any (for code outside a component). */
export function themeSpec(): ThemeSpec | null {
  return spec;
}

// ---------------------------------------------------------------------------
// Change notification
// ---------------------------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

function getVersion(): number {
  return version;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Rebuilds `colors` from the current mode + accent and wakes everyone up. */
function rebuild(): void {
  Object.assign(radius, CORNERS[spec?.corners ?? 'round']);
  if (spec) {
    Object.assign(colors, spec.colors, {
      accent: spec.accent,
      accentPressed: darken(spec.accent),
      accentVivid: spec.accent,
      brand: spec.accent,
      onAccent: contrast(spec.accent, '#000000') >= contrast(spec.accent, '#FFFFFF') ? '#000000' : '#FFFFFF',
    });
    version += 1;
    for (const listener of listeners) listener();
    return;
  }
  const light = currentMode === 'light';
  const base = light
    ? { ...LIGHT, ...BACKGROUND_TINTS[tint].light }
    : pureBlack
      ? BLACK
      : { ...DARK, ...BACKGROUND_TINTS[tint].dark };
  const picked = light ? lightAccent : darkAccent;
  // On white the accent has to be dark enough to read as text; on near-black
  // a palette colour is already fine as picked, and a dark custom one is
  // lifted. `onAccent` follows from that: black on the vivid accent, white on
  // the darkened one.
  const accent = readableOn(picked, light ? LIGHT.background : base.background);
  Object.assign(colors, base, {
    accent,
    accentPressed: darken(accent),
    accentVivid: picked,
    brand: light ? readableOn(DEFAULT_ACCENT, LIGHT.background) : DEFAULT_ACCENT,
    onAccent: light ? '#FFFFFF' : '#000000',
  });
  version += 1;
  for (const listener of listeners) listener();
}

/** Hot-swaps both accents (accent + its "pressed" variant). Both at once, so
 *  there is never a moment where one appearance holds a colour the setting
 *  no longer says. */
export function applyAccents(dark: string, light: string): void {
  darkAccent = dark;
  lightAccent = light;
  rebuild();
}

/** True black instead of dark grey, whenever the appearance is dark. */
export function applyPureBlack(on: boolean): void {
  if (on === pureBlack) return;
  pureBlack = on;
  rebuild();
}

/** The tint of the greys, dark and light; true black ignores it. */
export function applyBackgroundTint(next: BackgroundTint): void {
  if (next === tint) return;
  tint = next;
  rebuild();
}

/** Puts a theme on, or takes it off with null (see `ThemeSpec`). */
export function applyThemeSpec(next: ThemeSpec | null): void {
  spec = next;
  rebuild();
}

/** Hot-swaps the whole appearance. */
function applyThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  // iOS styles the keyboard, alerts and sheets from the window, which follows
  // the device unless pinned to the app's appearance.
  if (Platform.OS === 'ios' && currentPref !== 'system') Appearance.setColorScheme(mode);
  rebuild();
}

let systemWatch: { remove: () => void } | null = null;

/** The appearance the device is in, or dark when it will not say. */
function systemMode(): ThemeMode {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

// The `schedule` preference: light from one hour, dark from another.
let lightFrom = 7;
let darkFrom = 21;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleWatch: { remove: () => void } | null = null;

function scheduledMode(now: Date): ThemeMode {
  if (lightFrom === darkFrom) return 'dark';
  const h = now.getHours() + now.getMinutes() / 60;
  const light = lightFrom < darkFrom ? h >= lightFrom && h < darkFrom : h >= lightFrom || h < darkFrom;
  return light ? 'light' : 'dark';
}

/** Milliseconds from `now` to the next of the two hours. */
function untilNextSwitch(now: Date): number {
  let best = Infinity;
  for (const hour of [lightFrom, darkFrom]) {
    const at = new Date(now);
    at.setHours(hour, 0, 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    best = Math.min(best, at.getTime() - now.getTime());
  }
  return best;
}

/** Puts the scheduled appearance on screen and waits for the next change. A
 *  timer does not run while the app is in the background, so coming back to
 *  the foreground checks the clock again as well. */
function followSchedule(): void {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  const now = new Date();
  const next = scheduledMode(now);
  if (next !== currentMode) applyThemeMode(next);
  // A second late, so the timer never lands just before the hour.
  scheduleTimer = setTimeout(followSchedule, untilNextSwitch(now) + 1000);
}

function stopWatching(): void {
  systemWatch?.remove();
  systemWatch = null;
  scheduleWatch?.remove();
  scheduleWatch = null;
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = null;
}

let currentPref: ThemePreference = 'dark';

/**
 * Picks the appearance and, on `system` or `schedule`, keeps picking it: the
 * listener is what makes the app follow a device switching to night without
 * being reopened, and the timer what makes it follow the clock.
 *
 * Android only tells anyone what it is set to when the app declares
 * `userInterfaceStyle: "automatic"` (app.json). Pinned to `dark`, the launcher
 * calls `setDefaultNightMode(MODE_NIGHT_YES)` and from then on the system
 * answers dark forever, so on a build older than that one `system` is a third
 * way of choosing dark.
 */
export function applyThemePreference(pref: ThemePreference): void {
  currentPref = pref;
  stopWatching();
  if (pref === 'system') {
    // Unpinned first, or `systemMode()` would read back the pinned value.
    if (Platform.OS === 'ios') Appearance.setColorScheme('unspecified');
    systemWatch = Appearance.addChangeListener(() => {
      // Only on a real change: every rebuild hands out new style objects, and
      // Android repeats this event for things that are not the appearance.
      const next = systemMode();
      if (next !== currentMode) applyThemeMode(next);
    });
    applyThemeMode(systemMode());
  } else if (pref === 'schedule') {
    scheduleWatch = AppState.addEventListener('change', (state) => {
      if (state === 'active') followSchedule();
    });
    followSchedule();
  } else {
    applyThemeMode(pref);
  }
}

/** The two hours of the `schedule` preference (0–23). */
export function applyThemeSchedule(light: number, dark: number): void {
  lightFrom = light;
  darkFrom = dark;
  if (currentPref === 'schedule') followSchedule();
}

// ---------------------------------------------------------------------------
// Themed stylesheets
// ---------------------------------------------------------------------------

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * `StyleSheet.create` that survives a theme change.
 *
 * Same call shape, one extra argument: the factory receives the palette, and
 * naming that parameter `colors` is what lets a sheet be converted without
 * touching a single line inside it. What comes back is not the object the
 * factory built but one whose entries are getters, so each style is looked up
 * when it is used and comes from the palette in force at that moment. The
 * container itself never changes identity, which is why an exported sheet
 * (`settingsStyles`) can still be imported anywhere.
 *
 * Each rebuild produces new style objects, and that matters: React Native
 * short-circuits its prop diff when a style prop is the same reference as last
 * render, so a sheet mutated in place would never repaint. Within one theme the
 * references are stable, so re-renders stay as cheap as they were.
 */
export function themed<T extends NamedStyles<T> | NamedStyles<any>>(
  factory: (palette: Palette) => T & NamedStyles<any>,
): T {
  let built = factory(colors);
  let builtVersion = version;
  const current = (): T => {
    if (builtVersion !== version) {
      built = factory(colors);
      builtVersion = version;
    }
    return built;
  };
  const sheet = {} as T;
  for (const key of Object.keys(built) as (keyof T)[]) {
    Object.defineProperty(sheet, key, {
      enumerable: true,
      get: () => current()[key],
    });
  }
  return sheet;
}

/**
 * Subscribes a component to the theme, and hands back the live palette.
 *
 * Colours are already current wherever they are read from — this is what makes
 * React read them again. A component that shows any themed colour needs it,
 * whether it reads `colors.x` inline or through a `themed()` sheet; without it
 * the screen keeps the appearance it was last painted in, which for a stack
 * that stays mounted behind you means until you visit it again.
 */
export function useTheme(): Palette {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return colors;
}

/**
 * The same subscription, for the handful of places that have to branch on the
 * appearance rather than just read a colour out of it: the status bar's icons,
 * and the tint taken from a cover, which is a dark tone under the dark theme
 * and a pale one under the light.
 */
export function useThemeMode(): ThemeMode {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return themeMode();
}

/** The same subscription, for the pieces a theme can draw another way. */
export function useThemeSpec(): ThemeSpec | null {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return spec;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * The corners, from the smallest control to the biggest surface.
 *
 * Read them as a ladder rather than as numbers: `sm` is a badge or a bar,
 * `md` a row or a small cover, `lg` a card, `xl` the panels that take up half
 * the screen, `xxl` the sheets that rise over it, and `pill` anything meant to
 * be a capsule or a circle (a large radius on a square box is one, which is
 * why there is no separate `circle`).
 *
 * The whole ladder went up a step in August 2026: it used to top out at 16 and
 * almost everything in the app sat on 8, which reads flat next to anything
 * drawn in the last few years.
 */
const DEFAULT_RADIUS = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  /** A sheet rising from the bottom, and anything else that owns the screen. */
  xxl: 32,
  pill: 999,
};

/** The corners a theme can ask for. Circles stay circles in all three. */
const CORNERS: Record<ThemeCorners, typeof DEFAULT_RADIUS> = {
  /** Machined, not soft: the chrome theme's. */
  sharp: { sm: 2, md: 3, lg: 5, xl: 8, xxl: 12, pill: 999 },
  soft: { sm: 4, md: 6, lg: 10, xl: 14, xxl: 20, pill: 999 },
  round: DEFAULT_RADIUS,
};

/**
 * Rewritten in place by the theme, like `colors`, so it is only current where
 * it is read inside a `themed()` sheet or while rendering.
 */
export const radius: Readonly<typeof DEFAULT_RADIUS> = { ...DEFAULT_RADIUS };

/**
 * The type scale, from the smallest label to the biggest heading.
 *
 * Read it as a ladder, the way `radius` is read: `xs` is a badge or a caption,
 * `sm` the second line of a row, `md` the first one, `lg` a section heading,
 * `xl` a screen's title bar, `xxl` the big heading a screen or a record opens
 * with.
 *
 * There is nothing between 24 and 32 on purpose. Three tab headings used to
 * carry a hand-written 30, which is two points off `xxl` and reads as the same
 * size to everybody who is not measuring: a step nobody can see is not a step,
 * it is a second name for one that already exists.
 */
export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Fixed line heights for one-line text set side by side, at what Roboto gives
 * the Latin alphabet on its own. A title in Japanese or with an emoji falls
 * back to a font with a taller line, so one such card in a shelf made the whole
 * shelf taller than the next, and the page below it shifted.
 */
export const lineHeight = {
  xs: 16,
  sm: 16.5,
} as const;

/**
 * Letter spacing for headings, tighter the bigger they are: at these
 * sizes the default spacing reads loose, and pulling it in is most of what
 * makes a title look current. Body text keeps the font's own.
 */
export const tracking = {
  heading: -0.1,
  title: -0.3,
  display: -0.3,
} as const;

/**
 * How wide a bottom sheet is allowed to get.
 *
 * A phone never reaches it, so nothing moves there. On a tablet it is what
 * keeps a list of six actions from being stretched across 1280 points, which
 * is a menu you read by turning your head (#131). The sheets pair it with
 * `alignSelf: 'center'` instead of pinning themselves to both edges.
 */
export const SHEET_MAX_WIDTH = 560;

/** Height of the tab bar (not including the bottom safe area). */
export const TAB_BAR_HEIGHT = 60;

/** Approximate height of the floating MiniPlayer (44px artwork + padding). */
export const MINI_PLAYER_HEIGHT = 60;

/** Air between the MiniPlayer and the navigation bar, so it floats. */
export const MINI_PLAYER_GAP = spacing.xs;

/**
 * Fixed bottom spacing for screen lists WITHOUT a tab bar: the MiniPlayer
 * floats at the bottom and this gap clears it with extra margin.
 *
 * On tab screens (Home, Search, Library) the MiniPlayer stacks on top of the
 * tab bar, so they additionally need the actual bottom safe area (which varies
 * between gesture nav vs. 3-button nav); those screens use
 * `useScreenBottomPadding()`, not this constant.
 */
export const SCREEN_BOTTOM_PADDING = 140;
