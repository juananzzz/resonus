/**
 * Last known position per album for audiobook-like content.
 *
 * Stored locally per profile so the app can resume within long-form albums
 * without depending on backend-specific resume APIs.
 */
import { create } from 'zustand';

import { type Album, type Song, type SubsonicAuth } from '@/api/subsonic';
import { queryClient } from '@/lib/query';
import { releaseGroupOf, type ReleaseGroup } from '@/lib/releaseGroups';
import { primaryUrl } from '@/lib/serverUrls';
import { getItem, setItem } from '@/lib/storage';

const STORAGE_KEY = 'resonus.albumProgress';
const WRITE_EVERY_SEC = 30;

/**
 * Genres that mean the record is something read aloud rather than music.
 *
 * Matched whole, never as a substring of something longer, and only against
 * genre fields. This must stay explicit and medium-specific: story genres
 * (thriller, fantasy, crime) are not audiobook genres and must not trigger
 * audiobook mode.
 *
 * Spellings are normalized first (see `normGenre`), so the umlauts in Hörbuch
 * and Hörspiel are already gone by the time they are looked up.
 */
const AUDIOBOOK_GENRES = new Set([
  // English
  'audiobook',
  'audiobooks',
  'audio book',
  'audio books',
  'book on tape',
  'books on tape',
  'talking book',
  'talking books',
  'narrated book',
  'narrated books',
  'narrated audiobook',
  'narrated audiobooks',
  'audio novel',
  'audio novels',
  'audio fiction',
  'audio drama',
  'audio dramas',
  'audio theatre',
  'audio theatre drama',
  'audio theater',
  'audio theater drama',
  'radio play',
  'radio plays',
  'radio drama',
  'radio dramas',
  'radioplay',
  'dramatized audiobook',
  'dramatized audiobooks',
  // German
  'horbuch',
  'horbucher',
  'hoerbuch',
  'hoerbuecher',
  'horspiel',
  'horspiele',
  'hoerspiel',
  'hoerspiele',
  'lesung',
  'lesungen',
  'bucher zum horen',
  'buch zum horen',
  // Spanish
  'audiolibro',
  'audiolibros',
  'libro hablado',
  'libros hablados',
  'libro narrado',
  'libros narrados',
  'drama radiofonico',
  'radioteatro',
  'radionovela',
  // Catalan
  'audiollibre',
  'audiollibres',
  'llibre parlat',
  // Portuguese
  'audiolivro',
  'audiolivros',
  'livro narrado',
  'livre audio',
  'livres audio',
  'livro falado',
  'livros falados',
  'drama radiofonico',
  'radioteatro',
  // French
  'livre parle',
  'livres parles',
  'roman audio',
  'romans audio',
  'fiction sonore',
  'drame radiophonique',
  // Italian
  'audiolibri',
  'libro parlato',
  'libri parlati',
  'romanzo audio',
  'drammi radiofonici',
  // Dutch / Flemish
  'luisterboek',
  'luisterboeken',
  'gesproken boek',
  'gesproken boeken',
  'hoorspel',
  'hoorspelen',
  // Scandinavian
  'ljudbok',
  'ljudbocker',
  'talbok',
  'radioteater',
  'lydbok',
  'lydboker',
  'horespill',
  'lydbog',
  'lydboger',
  'horspil',
  // Finnish / Estonian
  'aanikirja',
  'aanikirjat',
  'kuunnelma',
  'kuunnelmat',
  'heliraamat',
  'heliraamatud',
  // Slavic (Latin transliterations where commonly seen in tags)
  'audiokniha',
  'audioknihy',
  'zvukova kniha',
  'zvukove knihy',
  'audiokniga',
  'kniga audio',
  // Romanian / Hungarian / Turkish
  'carte audio',
  'carti audio',
  'hangoskonyv',
  'hangos konyv',
  'sesli kitap',
  'sesli kitaplar',
  // Greek (transliterated)
  'ichitiko vivlio',
  'ixitiko vivlio',
  // East Asian labels commonly written in Latin tags
  'ting shu',
  'you sheng shu',
  'yuseisho',
  'audiobukku',
  // Generic labels that still denote spoken long-form content (medium, not story)
  'spoken audio',
  'spoken literature',
  'spokenword book',
  'spokenword audiobook',
]);

/**
 * The release types that say the same thing, in `releaseGroupOf`'s spelling.
 *
 * Wherever a library is tagged this is the answer, and asking it is what ztx
 * asked for on #144: MusicBrainz's `RELEASETYPE` already arrives with every
 * album and `lib/releaseGroups` already reads it for the discography, so an
 * audiobook is known rather than guessed and nothing extra is fetched.
 */
const AUDIOBOOK_RELEASE_GROUPS = new Set<ReleaseGroup>([
  'audiobook',
  'audiodrama',
  'spokenword',
]);

export interface AlbumProgressEntry {
  trackId: string;
  positionSec: number;
  updatedAt: number;
}

type AlbumProgressByProfile = Record<string, Record<string, AlbumProgressEntry>>;

interface AlbumProgressState {
  byProfile: AlbumProgressByProfile;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  clearAll: () => void;
  clearAlbum: (
    auth: SubsonicAuth | null | undefined,
    offline: boolean,
    albumId: string,
  ) => void;
  remember: (
    auth: SubsonicAuth | null | undefined,
    offline: boolean,
    albumId: string,
    trackId: string,
    positionSec: number,
    force?: boolean,
  ) => void;
}

function normGenre(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Genre fields arrive often enough as one string with several genres in it
 *  ("Audiobook; Fiction") that each part is asked separately. */
function genreParts(v: string): string[] {
  return v
    .split(/[\n;,|/]+/)
    .map((p) => normGenre(p))
    .filter(Boolean);
}

export function isAudiobookGenre(v: string | null | undefined): boolean {
  if (!v) return false;
  return genreParts(v).some((part) => AUDIOBOOK_GENRES.has(part));
}

/**
 * Whether a track is spoken word, going by its genre and nothing else.
 *
 * A song carries no release type — only its album does — so this is what an
 * untagged library is left with, and `isAudiobookAlbumId` is what goes and
 * asks the album the track came from.
 */
export function isAudiobookSong(song: Song | null | undefined): boolean {
  if (!song) return false;
  if (isAudiobookGenre(song.genre)) return true;
  return (song.genres ?? []).some((g) => isAudiobookGenre(g.name));
}

/** Whether an album is spoken word: the tag first, its genres after. */
export function isAudiobookAlbum(album: Album | null | undefined): boolean {
  if (!album) return false;
  if (AUDIOBOOK_RELEASE_GROUPS.has(releaseGroupOf(album))) return true;
  if (isAudiobookGenre(album.genre)) return true;
  return (album.genres ?? []).some((g) => isAudiobookGenre(g.name));
}

/**
 * The same question asked from the player, which holds songs and not albums.
 *
 * The album is read out of the query cache and never fetched: whatever put
 * this queue together went through `['album', id]` to get its songs, so the
 * tagged answer is usually already sitting there, and where it is not the
 * track's own genre still has a say.
 */
export function isAudiobookAlbumId(albumId: string | null | undefined): boolean {
  if (!albumId) return false;
  const cached = queryClient.getQueryData<{ album: Album }>(['album', albumId]);
  return cached ? isAudiobookAlbum(cached.album) : false;
}

function profileKey(auth: SubsonicAuth | null | undefined, offline: boolean): string {
  if (auth) return `${primaryUrl(auth)}|${auth.username}|${auth.serverType}`;
  return offline ? 'offline' : 'local';
}

export function getAlbumProgressEntry(
  auth: SubsonicAuth | null | undefined,
  offline: boolean,
  albumId: string,
): AlbumProgressEntry | undefined {
  const key = profileKey(auth, offline);
  return useAlbumProgress.getState().byProfile[key]?.[albumId];
}

const NO_PROGRESS: Record<string, AlbumProgressEntry> = {};

/**
 * Everything saved for a profile, for a screen that needs to hear it change.
 *
 * `getAlbumProgressEntry` reads the store once and tells nobody, so a screen
 * calling it while it renders shows whatever was saved the last time
 * something else made it draw: the album you have been listening to still
 * offers to resume where it stood two chapters ago.
 *
 * The whole profile rather than one album because the id to look up is the
 * one the server answered with, which a screen only has after its query has
 * come back, and the album a request was made for is not always the album
 * that arrives (Navidrome hands back canonical ids).
 */
export function useAlbumProgressByAlbum(
  auth: SubsonicAuth | null | undefined,
  offline: boolean,
): Record<string, AlbumProgressEntry> {
  const key = profileKey(auth, offline);
  return useAlbumProgress((s) => s.byProfile[key] ?? NO_PROGRESS);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(byProfile: AlbumProgressByProfile) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(STORAGE_KEY, JSON.stringify(byProfile));
  }, 1000);
}

export const useAlbumProgress = create<AlbumProgressState>((set, get) => ({
  byProfile: {},
  hydrated: false,

  clearAll: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    set({ byProfile: {} });
    void setItem(STORAGE_KEY, JSON.stringify({}));
  },

  clearAlbum: (auth, offline, albumId) => {
    const key = profileKey(auth, offline);
    const prevProfile = get().byProfile[key];
    if (!prevProfile?.[albumId]) return;
    const { [albumId]: _removed, ...nextProfile } = prevProfile;
    const byProfile = { ...get().byProfile, [key]: nextProfile };
    set({ byProfile });
    scheduleSave(byProfile);
  },

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) set({ byProfile: JSON.parse(raw) as AlbumProgressByProfile });
    } catch {
      // ignore corrupted/missing data
    } finally {
      set({ hydrated: true });
    }
  },

  remember: (auth, offline, albumId, trackId, positionSec, force = false) => {
    const sec = Number.isFinite(positionSec) ? Math.max(0, Math.round(positionSec)) : 0;
    const key = profileKey(auth, offline);
    const prevProfile = get().byProfile[key] ?? {};
    const prev = prevProfile[albumId];
    if (
      !force &&
      prev &&
      prev.trackId === trackId &&
      Math.abs(prev.positionSec - sec) < WRITE_EVERY_SEC
    ) {
      return;
    }
    const nextProfile = {
      ...prevProfile,
      [albumId]: { trackId, positionSec: sec, updatedAt: Date.now() },
    };
    const byProfile = { ...get().byProfile, [key]: nextProfile };
    set({ byProfile });
    scheduleSave(byProfile);
  },
}));
