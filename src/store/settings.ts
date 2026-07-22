/** Ajustes de la app (persistidos): calidad de streaming e idioma. */
import { create } from 'zustand';

import { LANGUAGE_NAMES, isLanguage, type Language } from '@/i18n/languages';
import { hashKey } from '@/lib/localLibrary';
import { getItem, setItem } from '@/lib/storage';
import { applyAccent, DEFAULT_ACCENT } from '@/theme';
import { profileScopeId, useAuthStore } from './auth';
import { queryClient } from '@/lib/query';

// El campo se llama `color` (no `value`) a propósito: Reanimated warnea de más
// al ver cualquier `.value` dentro de un estilo inline, aunque no sea un shared
// value. Con `color` se evita ese falso positivo en el picker de Theme.
/** Colores de acento elegibles (misma paleta viva; verde por defecto). */
export const ACCENT_OPTIONS: { name: string; color: string }[] = [
  // Ordenados por tono (arcoíris), con el verde por defecto el primero.
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

// Base de la clave de ajustes. Los ajustes son POR PERFIL: cada uno guarda bajo
// `resonus.settings.<id de perfil>`. La clave base a secas (`resonus.settings`)
// es la de la versión antigua (compartida); se usa como respaldo/migración: un
// perfil sin ajustes propios aún hereda los antiguos hasta que cambie algo.
const STORAGE_KEY = 'resonus.settings';
// El idioma es GLOBAL (de la app, no del perfil): con el reset por cambio de
// perfil, hacerlo por perfil pondría inglés en cada cuenta nueva.
const LANG_KEY = 'resonus.language';

/** Clave de ajustes del perfil activo (servidor, local o ninguno). El id se
 *  hashea: SecureStore solo admite [A-Za-z0-9._-] y la URL trae `:`, `/`, `|`. */
function settingsKey(): string {
  return `${STORAGE_KEY}.${hashKey(profileScopeId())}`;
}

/** 0 = calidad original (sin transcodificar); el resto es el bitrate en kbps. */
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
 * Códec al que pedir la transcodificación (parámetro `format` de Subsonic).
 * '' = el transcoder por defecto del servidor (MP3 en Navidrome). Solo entra en
 * juego cuando hay bitrate elegido (con "Original" se sirve el fichero crudo).
 */
export type TranscodeFormat = '' | 'mp3' | 'opus' | 'aac';

/** Opciones del selector de códec. Las etiquetas de códec son nombres propios;
 *  la de "por defecto" la traduce cada pantalla con `t('Server default')`. */
export const TRANSCODE_FORMATS: TranscodeFormat[] = ['', 'mp3', 'opus', 'aac'];

// Los idiomas viven en un único sitio (`src/i18n/languages.ts`): añadir uno es
// una sola fila allí. Se re-exportan aquí para no romper los imports existentes.
export { LANGUAGE_NAMES, isLanguage };
export type { Language };

/** Orden de la Biblioteca, estilo Spotify. */
export type LibrarySort = 'recent' | 'added' | 'alpha';

/** Disposición de una colección: lista (filas) o cuadrícula (tarjetas). */
export type ListLayout = 'list' | 'grid';

/**
 * Tope del saludo personalizado de Inicio. Cabe de sobra en una línea junto a
 * los botones de la derecha; pasado eso los empujaría fuera. Es un tope de
 * cordura, no la garantía: la fuente la elige el usuario y "WWWW" ocupa mucho
 * más que "iiii", así que el saludo además se recorta solo (ver Inicio).
 */
export const GREETING_MAX = 15;

/**
 * Normalización de volumen con las etiquetas ReplayGain de los ficheros.
 * `auto` = estilo Spotify: por álbum al escuchar un álbum entero (conserva su
 * dinámica interna) y por canción en playlists/shuffle.
 */
export type ReplayGainMode = 'off' | 'auto' | 'track' | 'album';

/**
 * Fuente de la interfaz. Son familias del sistema Android (sin coste de
 * empaquetado ni descarga): `system` deja la fuente por defecto (Roboto).
 */
export type AppFont = 'system' | 'condensed' | 'serif' | 'monospace' | 'casual' | 'typewriter';

/** Qué hace tocar la carátula en el reproductor: nada, abrir la pantalla de
 *  letra, o mostrar la letra en el sitio de la carátula. */
export type CoverTapAction = 'none' | 'screen' | 'inline';

/** Pestaña en la que arranca la app (y a la que vuelve al reabrir tras un rato
 *  en segundo plano). Coincide con los nombres de ruta de `(tabs)`. */
export type DefaultTab = 'index' | 'search' | 'library';

/** Conducta del botón "anterior": reiniciar la pista pasados unos segundos (por
 *  defecto, como Spotify) o ir siempre a la pista previa (como YouTube). */
export type PreviousButtonMode = 'restart' | 'always';

/** Acción al deslizar una canción a la derecha en las listas (customizable). */
export type SwipeAction = 'off' | 'queue' | 'next' | 'favorite' | 'menu';

/** Fila de Inicio. `recentlyPlayed` y `discover` son solo servidor; `discover`
 *  redescubre álbumes escuchados hace tiempo; `randomAlbums`/`randomArtists`
 *  son al azar puro. */
export type HomeSectionKey =
  | 'recentlyAdded'
  | 'recentlyPlayed'
  | 'mostPlayed'
  | 'discover'
  | 'playlists'
  | 'randomAlbums'
  | 'randomArtists';

/** Sección de Inicio con su estado (el orden lo da la posición en la lista). */
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

/** Orden y estado por defecto (las opcionales apagadas para no recargar Inicio). */
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
 * Sanea la lista guardada: conserva el orden y estado del usuario, descarta
 * claves desconocidas y añade al final las secciones nuevas que no estuvieran
 * (así una versión futura con más secciones no rompe la config existente).
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

/** Chip de la fila de explorar de Inicio. `genres` y `radio` son solo servidor. */
export type ExploreChipKey =
  | 'shuffle'
  | 'favorites'
  | 'albums'
  | 'artists'
  | 'genres'
  | 'radio'
  | 'history';

/** Chip con su estado (el orden lo da la posición en la lista). */
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

/** Orden y estado por defecto: los de siempre, todos visibles. */
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
 * Sanea la lista guardada: conserva el orden y estado del usuario, descarta
 * claves desconocidas y añade al final los chips nuevos que no estuvieran (así
 * una versión futura con más chips no rompe la config existente).
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
 * Acciones ocultables del menú ⋯ de una canción.
 *
 * «Quitar de la lista» no está: solo aparece dentro de una playlist, así que
 * nunca estorba en el resto, y es la única vía para quitar una canción suelta
 * desde el menú. El criterio no es "esencial" sino "estorba en algún sitio":
 * el resto tiene además otro camino (el corazón de las filas y del reproductor,
 * la carátula y la tarjeta para la letra, la selección múltiple para descargar
 * y para añadir a una lista).
 *
 * Salvo `sleepTimer`, que solo vive aquí: ocultarlo deja el temporizador sin
 * acceso hasta volver a activarlo. Es una decisión tomada, no un descuido — la
 * app ya deja apagar vías únicas (el gesto de deslizar, tocar la carátula). Si
 * algún día molesta, la salida buena es darle un segundo sitio (el ⋯ del
 * reproductor), no quitar el interruptor.
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
  | 'sleepTimer';

/**
 * Visibilidad de cada acción. Mapa y no lista (a diferencia de los chips y las
 * secciones de Inicio) a propósito: aquí el orden no se puede cambiar, así que
 * guardarlo sería insinuar que sí.
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
  'sleepTimer',
];

/** Todas visibles menos «Valorar», que empieza oculta (la pediste tú). */
export const DEFAULT_SONG_MENU_ACTIONS: SongMenuActions = {
  playlist: true,
  artist: true,
  album: true,
  lyrics: true,
  mix: true,
  playNext: true,
  queue: true,
  favorite: true,
  rating: false,
  download: true,
  sleepTimer: true,
};

/**
 * Sanea lo guardado: solo acepta booleanos de claves conocidas. Lo que falte
 * (p. ej. una acción nueva) se queda visible, que es el valor por defecto.
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

/** Nombre visible de cada fuente (nombres propios: no se traducen). */
export const APP_FONT_LABELS: Record<AppFont, string> = {
  system: 'Roboto',
  condensed: 'Condensed',
  serif: 'Serif',
  monospace: 'Monospace',
  casual: 'Casual',
  typewriter: 'Typewriter',
};

/** Familia real de cada opción; `undefined` = fuente por defecto del sistema. */
export const APP_FONT_FAMILY: Record<AppFont, string | undefined> = {
  system: undefined,
  condensed: 'sans-serif-condensed',
  serif: 'serif',
  monospace: 'monospace',
  casual: 'casual',
  // Cutive Mono (familia serif-monospace de AOSP): rollo máquina de escribir.
  typewriter: 'serif-monospace',
};

interface SettingsState {
  /** Calidad de streaming en Wi-Fi (y cualquier red que no sean datos móviles). */
  maxBitRate: number;
  /** Calidad de streaming con datos móviles. */
  maxBitRateCellular: number;
  /** Calidad de descarga: 0 = fichero original; resto, bitrate transcodificado. */
  downloadBitRate: number;
  /** Códec de transcodificación en streaming ('' = el del servidor). */
  streamFormat: TranscodeFormat;
  /** Códec de transcodificación en descargas ('' = el del servidor). */
  downloadFormat: TranscodeFormat;
  /** Descargar solo con Wi-Fi (bloquea descargas con datos móviles). */
  downloadWifiOnly: boolean;
  language: Language;
  /** Mostrar la etiqueta de formato/bitrate/Hi-Res (solo en el reproductor). */
  showAudioQuality: boolean;
  /** Barra de estrellas para valorar la canción en el reproductor. */
  showRating: boolean;
  /** Mostrar álbum y año bajo el título/artista en el reproductor. */
  showAlbumInfo: boolean;
  /** Mostrar en la cola las pistas ya reproducidas (atenuadas, tocables). */
  showPlayedInQueue: boolean;
  /** Mostrar la mini carátula del álbum en las listas (playlists/favoritos). */
  showListArtwork: boolean;
  /** Duración de cada canción en las listas (Spotify no la muestra). */
  showSongDuration: boolean;
  /** Estrellas de valoración de cada canción en las listas. */
  showListRating: boolean;
  /** Al acabar la cola, seguir con canciones parecidas (getSimilarSongs2). */
  autoplaySimilar: boolean;
  /** Segundos de fundido cruzado entre canciones (0 = desactivado). */
  crossfadeSec: number;
  /**
   * Calentar por adelantado el stream de las próximas pistas de la cola. Pensado
   * para proxys tipo Octo Fiesta u orígenes lentos que bajan la pista al vuelo:
   * pide su URL con antelación para que el servidor la tenga lista al llegar.
   * Apagado por defecto: en un servidor normal no aporta y solo daría trabajo de
   * más (transcodes, estadísticas) sin que el usuario lo pida.
   */
  preloadUpcoming: boolean;
  /**
   * Cambiar solo entre online y offline según la conectividad: caer a las
   * descargas cuando el servidor no responde y reconectar cuando vuelve.
   * Activado por defecto. Si se apaga, el usuario controla el modo a mano
   * (Ajustes → "Offline mode" / "Back online") y la app nunca lo cambia sola.
   */
  autoOfflineSwitch: boolean;
  /**
   * En el modo offline de servidor, ocultar las canciones no descargadas en vez
   * de mostrarlas en gris. Apagado por defecto (se ven en gris, como hasta
   * ahora); si se activa, la biblioteca offline solo muestra lo reproducible.
   */
  hideUnavailableOffline: boolean;
  /** Normalización de volumen (ReplayGain): apagada, por canción o por álbum. */
  replayGain: ReplayGainMode;
  /** Mantener la pantalla encendida mientras la app está en primer plano. */
  keepScreenAwake: boolean;
  /** Vibración sutil en acciones clave (favorito, long-press, arrastrar…). */
  hapticsEnabled: boolean;
  /** Pantalla de letra teñida con el color dominante de la carátula. */
  lyricsColorBackground: boolean;
  /**
   * Si una canción no tiene letra (ni el servidor, ni .lrc, ni USLT),
   * pedirla a LRCLIB. Activado por defecto (mejor experiencia con letras);
   * manda artista y título a un servicio externo, se puede desactivar.
   */
  lyricsOnlineFallback: boolean;
  /** Foto circular del artista junto a su nombre en la pantalla de álbum. */
  showArtistPhoto: boolean;
  /**
   * Cabeceras de disco en álbumes multi-disco (separador + título del disco, o
   * "Disc N" si no tiene título). Activado por defecto.
   */
  showDiscHeaders: boolean;
  /** Fondo del reproductor teñido con el color dominante de la carátula. */
  playerColorBackground: boolean;
  /** Mini-reproductor teñido con el color dominante de la carátula. */
  miniPlayerColorBackground: boolean;
  /** Tarjeta de letras bajo los controles del reproductor. */
  showLyricsCard: boolean;
  /** Qué hace tocar la carátula del reproductor (nada / pantalla de letra /
   *  letra en el sitio de la carátula). */
  coverTapAction: CoverTapAction;
  /** Marquee: los títulos largos del reproductor se desplazan solos. */
  marqueeTitles: boolean;
  /** Botones inferiores del reproductor (cola y dispositivos). */
  showQueueButton: boolean;
  showDevicesButton: boolean;
  /** Botones de salto ±N segundos junto al play (0 = ocultos). Solo 5/10/30: son los iconos numerados que existen en MaterialIcons. */
  seekButtonsSec: number;
  /** Conducta del botón "anterior" (reiniciar pista o ir siempre a la previa). */
  previousButtonMode: PreviousButtonMode;
  /** Acción al deslizar una canción a la derecha en las listas. */
  swipeAction: SwipeAction;
  /** Acción al deslizar una canción a la izquierda en las listas. */
  swipeLeftAction: SwipeAction;
  /** Filas de álbumes de Inicio, en orden (cada una con su estado). */
  homeSections: HomeSection[];
  /** Cuadrícula de acceso rápido (Favoritos + recientes) arriba en Inicio. */
  showQuickGrid: boolean;
  /** Fijar el mosaico de Favoritos el primero en el quick grid. */
  quickGridFavorites: boolean;
  /** Incluir álbumes recientes en el quick grid. */
  quickGridAlbums: boolean;
  /** Incluir playlists en el quick grid. */
  quickGridPlaylists: boolean;
  /** Nº total de mosaicos del quick grid (4, 6 u 8). */
  quickGridSize: number;
  /** Mostrar el saludo ("Buenos días"…) en Inicio. */
  showGreeting: boolean;
  /** Saludo propio; vacío = el automático según la hora. */
  customGreeting: string;
  /** Chips de explorar de Inicio, en orden (cada uno con su estado). Sin
   *  ninguno activo, la fila desaparece: eso sustituye al viejo interruptor. */
  exploreChips: ExploreChip[];
  /** Qué acciones se ven en el menú ⋯ de una canción. */
  songMenuActions: SongMenuActions;
  /** Sección "Carpetas" en la Biblioteca (navegación por directorios; Subsonic). */
  showFolderBrowser: boolean;
  /** Visibilidad de botones opcionales, para quien prefiera una UI mínima. */
  showHistoryButton: boolean;
  showProfileButton: boolean;
  /** Pestaña de arranque de la app (Inicio/Buscar/Biblioteca). */
  defaultTab: DefaultTab;
  /** Orden elegido en la Biblioteca (recientes/añadido/alfabético). */
  librarySort: LibrarySort;
  /** Lista o cuadrícula en la Biblioteca. */
  libraryLayout: ListLayout;
  /**
   * Lista o cuadrícula al explorar artistas. Aparte de `libraryLayout` a
   * propósito: son colecciones distintas (aquí están TODOS los artistas, allí
   * solo los favoritos), y compartirla haría que tocar el botón de una pantalla
   * recolocara la otra sin avisar.
   */
  browseArtistsLayout: ListLayout;
  /** Lista o cuadrícula al explorar álbumes. Aparte por lo mismo que la anterior. */
  browseAlbumsLayout: ListLayout;
  /** Color de acento (hex). */
  accentColor: string;
  /** Fuente de la interfaz (familia del sistema; `system` = por defecto). */
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
  setShowPlayedInQueue: (value: boolean) => void;
  setShowListArtwork: (value: boolean) => void;
  setShowSongDuration: (value: boolean) => void;
  setShowListRating: (value: boolean) => void;
  setAutoplaySimilar: (value: boolean) => void;
  setCrossfadeSec: (value: number) => void;
  setPreloadUpcoming: (value: boolean) => void;
  setAutoOfflineSwitch: (value: boolean) => void;
  setHideUnavailableOffline: (value: boolean) => void;
  setReplayGain: (value: ReplayGainMode) => void;
  setKeepScreenAwake: (value: boolean) => void;
  setHapticsEnabled: (value: boolean) => void;
  setLyricsColorBackground: (value: boolean) => void;
  setLyricsOnlineFallback: (value: boolean) => void;
  setShowArtistPhoto: (value: boolean) => void;
  setShowDiscHeaders: (value: boolean) => void;
  setPlayerColorBackground: (value: boolean) => void;
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
  /** Reemplaza la lista completa (para reordenar). */
  setHomeSections: (sections: HomeSection[]) => void;
  setShowQuickGrid: (value: boolean) => void;
  setQuickGridFavorites: (value: boolean) => void;
  setQuickGridAlbums: (value: boolean) => void;
  setQuickGridPlaylists: (value: boolean) => void;
  setQuickGridSize: (value: number) => void;
  setShowGreeting: (value: boolean) => void;
  /** Recorta a GREETING_MAX por su cuenta: el tope no depende de quien llame. */
  setCustomGreeting: (value: string) => void;
  setExploreChip: (key: ExploreChipKey, value: boolean) => void;
  /** Reemplaza la lista completa (para reordenar). */
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
  setAccentColor: (value: string) => void;
  setAppFont: (value: AppFont) => void;
  /** Vuelve a los valores de fábrica (el idioma se conserva). */
  resetToDefaults: () => void;
  hydrate: () => Promise<void>;
}

function persist(state: ReturnType<typeof snapshot>) {
  void setItem(settingsKey(), JSON.stringify(state));
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
    // `language` no va en el blob del perfil: es global (ver LANG_KEY).
    showAudioQuality: s.showAudioQuality,
    showRating: s.showRating,
    showAlbumInfo: s.showAlbumInfo,
    showPlayedInQueue: s.showPlayedInQueue,
    showListArtwork: s.showListArtwork,
    showSongDuration: s.showSongDuration,
    showListRating: s.showListRating,
    autoplaySimilar: s.autoplaySimilar,
    crossfadeSec: s.crossfadeSec,
    preloadUpcoming: s.preloadUpcoming,
    autoOfflineSwitch: s.autoOfflineSwitch,
    hideUnavailableOffline: s.hideUnavailableOffline,
    replayGain: s.replayGain,
    keepScreenAwake: s.keepScreenAwake,
    hapticsEnabled: s.hapticsEnabled,
    lyricsColorBackground: s.lyricsColorBackground,
    lyricsOnlineFallback: s.lyricsOnlineFallback,
    showArtistPhoto: s.showArtistPhoto,
    showDiscHeaders: s.showDiscHeaders,
    playerColorBackground: s.playerColorBackground,
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
    accentColor: s.accentColor,
    appFont: s.appFont,
  };
}

/** Valores de fábrica de todas las preferencias. */
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
  showPlayedInQueue: false,
  showListArtwork: true,
  showSongDuration: false,
  showListRating: false,
  autoplaySimilar: true,
  crossfadeSec: 0,
  preloadUpcoming: false,
  autoOfflineSwitch: true,
  hideUnavailableOffline: false,
  replayGain: 'off' as ReplayGainMode,
  keepScreenAwake: false,
  hapticsEnabled: false,
  lyricsColorBackground: true,
  lyricsOnlineFallback: true,
  showArtistPhoto: true,
  showDiscHeaders: true,
  playerColorBackground: true,
  miniPlayerColorBackground: true,
  showLyricsCard: true,
  // Por defecto, tocar la carátula abre la pantalla de letra (como siempre).
  coverTapAction: 'screen' as CoverTapAction,
  marqueeTitles: true,
  showQueueButton: true,
  showDevicesButton: true,
  seekButtonsSec: 0,
  previousButtonMode: 'restart' as PreviousButtonMode,
  // Por defecto, deslizar a la derecha encola (comportamiento previo) y a la
  // izquierda no hace nada (opt-in).
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
  // Cuadrícula por defecto: a un artista se le reconoce por la cara, y es como
  // se pinta ya la pantalla. La lista es para quien prefiera escanear nombres.
  browseArtistsLayout: 'grid' as ListLayout,
  // Cuadrícula por defecto: la portada es lo que identifica un álbum, y es
  // como se pinta ya la pantalla.
  browseAlbumsLayout: 'grid' as ListLayout,
  accentColor: DEFAULT_ACCENT,
  appFont: 'system' as AppFont,
};

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,

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
    void setItem(LANG_KEY, language); // idioma global, no por perfil
  },

  setShowAudioQuality: (showAudioQuality) => {
    set({ showAudioQuality });
    persist(snapshot(get));
  },

  setShowAlbumInfo: (showAlbumInfo) => {
    set({ showAlbumInfo });
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
    // Cambia lo que devuelven las queries offline (filtra o no las no
    // descargadas): refresca las listas para que el cambio se vea al momento.
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

  setLyricsColorBackground: (lyricsColorBackground) => {
    set({ lyricsColorBackground });
    persist(snapshot(get));
  },

  setLyricsOnlineFallback: (lyricsOnlineFallback) => {
    set({ lyricsOnlineFallback });
    persist(snapshot(get));
  },

  setShowDiscHeaders: (showDiscHeaders) => {
    set({ showDiscHeaders });
    persist(snapshot(get));
  },

  setShowArtistPhoto: (showArtistPhoto) => {
    set({ showArtistPhoto });
    persist(snapshot(get));
  },

  setPlayerColorBackground: (playerColorBackground) => {
    set({ playerColorBackground });
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
    // El idioma se conserva: restablecer no debería cambiarte de idioma.
    set({ ...DEFAULTS, language: get().language });
    applyAccent(DEFAULT_ACCENT);
    persist(snapshot(get));
  },

  hydrate: async () => {
    try {
      // Reset a fábrica primero (conservando el idioma, que es global): al
      // conmutar de perfil no debe heredar los ajustes del anterior. El acento
      // se aplica a mano porque es efecto colateral (el blob lo re-aplica si lo
      // trae); la fuente es reactiva y no lo necesita.
      set({ ...DEFAULTS, language: get().language });
      applyAccent(DEFAULT_ACCENT);
      // Ajustes del perfil activo; si aún no tiene propios, hereda los antiguos
      // (compartidos) como respaldo/migración.
      const raw = (await getItem(settingsKey())) ?? (await getItem(STORAGE_KEY));
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
          showPlayedInQueue: boolean;
          showListArtwork: boolean;
          showSongDuration: boolean;
          showListRating: boolean;
          autoplaySimilar: boolean;
          crossfadeSec: number;
          preloadUpcoming: boolean;
          autoOfflineSwitch: boolean;
          hideUnavailableOffline: boolean;
          replayGain: ReplayGainMode;
          keepScreenAwake: boolean;
          hapticsEnabled: boolean;
          lyricsColorBackground: boolean;
          lyricsOnlineFallback: boolean;
          showArtistPhoto: boolean;
          showDiscHeaders: boolean;
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
          /** Ajuste antiguo (booleano); se migra a swipeAction. */
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
          accentColor: string;
          appFont: AppFont;
        }>;
        if (typeof parsed.maxBitRate === 'number') {
          set({ maxBitRate: parsed.maxBitRate });
        }
        if (typeof parsed.maxBitRateCellular === 'number') {
          set({ maxBitRateCellular: parsed.maxBitRateCellular });
        } else if (typeof parsed.maxBitRate === 'number') {
          // Antes había una sola calidad de streaming: quien la tuviera puesta
          // hereda el mismo valor en datos móviles (comportamiento idéntico
          // hasta que toque el ajuste nuevo).
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
        // `language` ya no se aplica aquí: es global, se carga al final.
        // Antes era un modo ('off'/'player'/'everywhere'); ahora un simple
        // on/off. Mapeamos los valores viejos: cualquier modo que mostrara la
        // etiqueta pasa a activado.
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
        if (typeof parsed.lyricsColorBackground === 'boolean') {
          set({ lyricsColorBackground: parsed.lyricsColorBackground });
        }
        if (typeof parsed.lyricsOnlineFallback === 'boolean') {
          set({ lyricsOnlineFallback: parsed.lyricsOnlineFallback });
        }
        if (typeof parsed.showArtistPhoto === 'boolean') {
          set({ showArtistPhoto: parsed.showArtistPhoto });
        }
        if (typeof parsed.showDiscHeaders === 'boolean') {
          set({ showDiscHeaders: parsed.showDiscHeaders });
        }
        if (typeof parsed.playerColorBackground === 'boolean') {
          set({ playerColorBackground: parsed.playerColorBackground });
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
          // Migración del ajuste antiguo: activado → encolar, desactivado → nada.
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
        // Se recorta al hidratar: un ajuste guardado por una versión con otro
        // tope no debe colarse más largo de lo que cabe.
        if (typeof parsed.customGreeting === 'string') {
          set({ customGreeting: parsed.customGreeting.slice(0, GREETING_MAX) });
        }
        if (parsed.songMenuActions) {
          set({ songMenuActions: normalizeSongMenuActions(parsed.songMenuActions) });
        }
        if (Array.isArray(parsed.exploreChips)) {
          set({ exploreChips: normalizeExploreChips(parsed.exploreChips) });
        } else if (parsed.showExploreChips === false) {
          // Migración del interruptor único que había antes: quien tuviera la
          // fila oculta debe seguir sin verla, no encontrarse los chips de
          // vuelta. Apagarlos todos es justo lo que la esconde ahora.
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
        if (typeof parsed.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.accentColor)) {
          set({ accentColor: parsed.accentColor });
          applyAccent(parsed.accentColor);
        }
        if (parsed.appFont && parsed.appFont in APP_FONT_FAMILY) {
          set({ appFont: parsed.appFont });
        }
      }
      // Idioma: global (no por perfil). Si aún no está guardado aparte, se migra
      // del blob antiguo (que lo incluía) la primera vez.
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
      if (isLanguage(lang)) {
        set({ language: lang });
      }
    } catch {
      // valores por defecto si falla
    }
  },
}));
