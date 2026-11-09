/**
 * The radios on Home: their definitions, built once from the play counts
 * and kept on the device, plus the icon files made for them.
 *
 * They are deliberately NOT playlists - nothing here is written to the
 * server. A def is the seed artist, the similar artists mixed into it, the
 * colour its icon was tinted with, and the snapshot of tracks it opens with
 * - kept so the screen can paint its list the moment it is asked for, with
 * the server asked again in the background whenever it has gone stale. The
 * def itself is rebuilt when it goes old, so a radio stays current the way a
 * saved playlist does not. Everything is one JSON file under the app's
 * documents (`radios/index.json`), scoped to the active profile the same way
 * the settings are, with the icon PNGs beside it in the same folder.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import type { Song } from '@/api/subsonic';
import { hashKey } from '@/lib/localLibrary';
import { profileScopeId } from './auth';

/** An artist a radio is built from: id, display name and cover if known. */
export interface RadioArtist {
  id: string;
  name: string;
  coverArt?: string;
}

/** One Home radio. `seed` is the artist in its title ("… Radio"). */
export interface RadioDef {
  seed: RadioArtist;
  /** Artists mixed in beside the seed's own top tracks. */
  similar: RadioArtist[];
  /** The icon's background colour, read from the seed's cover at build time. */
  color: string;
  createdAt: number;
  /** Its list, made the first time it is opened and kept from then on, so
   *  the radio is the same radio until it is replaced. */
  tracks?: Song[];
}

/** The folder the index and the icons live in (the app's own documents). */
export const RADIO_DIR = FileSystem.documentDirectory + 'radios/';
const INDEX_PATH = RADIO_DIR + 'index.json';

/** Where one radio's icon is written. The number goes up when the drawing
 *  changes, so icons from the old one are made again; the colour is in the
 *  name because the image cache goes by it, and a recoloured icon written
 *  over the old file would keep showing the old one. */
export function radioIconPath(def: RadioDef): string {
  return `${RADIO_DIR}icon-3-${hashKey(def.seed.id)}-${def.color.replace('#', '')}.png`;
}

function deleteIcon(uri: string | undefined) {
  if (uri) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

/** Keeps the icons drawn at their radio's current path and deletes the rest. */
function currentIcons(icons: Record<string, string>, defs: RadioDef[]): Record<string, string> {
  const byId = new Map(defs.map((d) => [d.seed.id, d]));
  const out: Record<string, string> = {};
  for (const [id, uri] of Object.entries(icons)) {
    const def = byId.get(id);
    if (def && uri === radioIconPath(def)) out[id] = uri;
    else deleteIcon(uri);
  }
  return out;
}

/** Radios this old are replaced when Home asks, for whoever never pulls Home
 *  to refresh (which replaces them every time). */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** True when the radios are missing or old enough to be replaced. */
export function radiosStale(defs: RadioDef[]): boolean {
  if (defs.length === 0) return true;
  const newest = Math.max(...defs.map((d) => d.createdAt));
  return Date.now() - newest > STALE_MS;
}

interface PersistedShape {
  scope: string;
  defs: RadioDef[];
  icons: Record<string, string>;
}

interface RadiosState {
  defs: RadioDef[];
  /** Radio id (its seed's id) → uri of the generated icon file. */
  icons: Record<string, string>;
  hydrated: boolean;
  /**
   * A new set is being made over the one on screen (a pull of Home, or the
   * settings). Building takes a while, and with nothing to show for it the
   * pull looked like it had done nothing, so people pulled again.
   */
  building: boolean;
  setBuilding: (building: boolean) => void;
  hydrate: () => Promise<void>;
  setDefs: (defs: RadioDef[]) => Promise<void>;
  setIcon: (id: string, uri: string) => void;
  /** The same radios in new colours: their icons go, to be drawn again. */
  recolor: (defs: RadioDef[]) => Promise<void>;
}

// One write at a time: the icons for six radios finish in parallel, and
// six overlapping read-modify-writes of the index would lose all but one.
let writing: Promise<void> = Promise.resolve();

async function persistNow(): Promise<void> {
  const { defs, icons } = useRadios.getState();
  try {
    await FileSystem.makeDirectoryAsync(RADIO_DIR, { intermediates: true });
    const body: PersistedShape = { scope: hashKey(profileScopeId()), defs, icons };
    await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(body));
  } catch (e) {
    // Radios are a suggestion, not a library: a failed write costs the next
    // start a rebuild, so it warns and carries on like storage.ts does.
    if (__DEV__) console.warn('[radios] could not save', e);
  }
}

function enqueue(): Promise<void> {
  writing = writing.then(() => persistNow());
  return writing;
}

export const useRadios = create<RadiosState>((set, get) => ({
  defs: [],
  icons: {},
  hydrated: false,
  building: false,
  setBuilding: (building) => set({ building }),

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const info = await FileSystem.getInfoAsync(INDEX_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(INDEX_PATH);
        const parsed = JSON.parse(raw) as Partial<PersistedShape>;
        // Another profile's radios (another server) are not this one's: the
        // ids mean nothing here and the seeds are somebody else's listening.
        if (parsed && parsed.scope === hashKey(profileScopeId())) {
          const defs = Array.isArray(parsed.defs) ? parsed.defs : [];
          set({
            defs,
            icons:
              parsed.icons && typeof parsed.icons === 'object'
                ? currentIcons(parsed.icons, defs)
                : {},
            hydrated: true,
          });
          return;
        }
      }
    } catch {
      // Unreadable or half-written: starting empty is the same thing a first
      // run does, and the next successful build writes a clean index back.
    }
    set({ hydrated: true });
  },

  setDefs: async (defs) => {
    // Icons of radios that no longer exist would sit on the disk unread: the
    // ids are the seed artists, so anything not in the new set is stale.
    const keep = new Set(defs.map((d) => d.seed.id));
    const icons = { ...get().icons };
    for (const id of Object.keys(icons)) {
      if (keep.has(id)) continue;
      deleteIcon(icons[id]);
      delete icons[id];
    }
    set({ defs, icons });
    await enqueue();
  },

  recolor: async (defs) => {
    const before = new Map(get().defs.map((d) => [d.seed.id, d.color]));
    const icons = { ...get().icons };
    for (const d of defs) {
      if (before.get(d.seed.id) === d.color || !icons[d.seed.id]) continue;
      deleteIcon(icons[d.seed.id]);
      delete icons[d.seed.id];
    }
    set({ defs, icons });
    await enqueue();
  },

  setIcon: (id, uri) => {
    const icons = { ...get().icons, [id]: uri };
    set({ icons });
    void enqueue();
  },

}));
