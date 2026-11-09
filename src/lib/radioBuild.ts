/**
 * The radios on Home: which artists get one, what goes in it, and when the
 * set is rebuilt.
 *
 * A radio is a seed artist (the one in its title, "… Radio") plus similar
 * artists mixed beside it - never a saved playlist: nothing is written to
 * the server. The def carries a snapshot of the tracks it opened with, so
 * the screen is already full the first time it is drawn, and a fresh list is
 * asked for whenever it has gone stale - the mix still reflects the library
 * as it is now.
 *
 * The seeds come from the server's own play counts, which is where every
 * listen lands anyway: the player reports to the server, and the server
 * passes it on to Last.fm or ListenBrainz when it is set up for that. A
 * local profile has the same counts, so there is one path to read and
 * nothing to fill in.
 */
import {
  COVER,
  coverArtUrl,
  getAlbum,
  getArtists,
  getArtist,
  getArtistInfo,
  getMostPlayedSongs,
  getRandomSongs,
  getSimilarSongs,
  getTopSongs,
} from '@/api/data';
import type { Artist, Song } from '@/api/subsonic';
import { coverColorOf, isPlainTint } from '@/hooks/useDominantColor';
import { ensureRadioIcons } from '@/lib/radioArt';
import { useRadios, radiosStale, type RadioArtist, type RadioDef } from '@/store/radios';
import { useSettings } from '@/store/settings';
import { themeMode } from '@/theme';

/** How many radios the section offers, unless Settings says otherwise. */
export const RADIO_SEEDS = 6;

/** The artists a build chooses from: the most played, this many deep, so
 *  skipping the recently used still leaves unplayed favourites. */
const SEED_POOL = 24;

/** How many tracks a radio aims for. */
export const RADIO_TARGET = 30;

/** Below this many tracks the mix takes one outsider per artist rather than
 *  stopping: a short list that holds together beats a long one that wanders
 *  off into children's songs. */
const MIN_RADIO_TRACKS = 12;

/** Similar artists kept per radio: the pool the track mix draws from. */
const SIMILAR_PER_RADIO = 8;

/** Fisher–Yates (Home's own `shuffled`, for the fallback tiers). */
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Seeds from this server's play counts: the artists behind the most played
 * songs, ordered by plays. The cover is the album's, not the artist's - what
 * `buildRadioDef` fetches upgrades it to the artist's own when there is one.
 */
async function serverSeeds(): Promise<RadioArtist[]> {
  const songs = await getMostPlayedSongs(100);
  const byArtist = new Map<string, { artist: RadioArtist; plays: number }>();
  for (const s of songs) {
    if (!s.artistId || !s.artist) continue;
    const plays = s.playCount ?? 1;
    const cur = byArtist.get(s.artistId);
    if (cur) cur.plays += plays;
    else byArtist.set(s.artistId, { artist: { id: s.artistId, name: s.artist, coverArt: s.coverArt }, plays });
  }
  return [...byArtist.values()]
    .sort((x, y) => y.plays - x.plays)
    .slice(0, SEED_POOL)
    .map((x) => x.artist);
}

/**
 * The radio seeds: the artists behind the most played songs, in a new order
 * each time, and any artists at all filling the rest - but not the ones on
 * screen, so every refresh brings different radios. Six radios about artists
 * you never played beats no radios, and the section still hides itself when
 * even that comes back empty (a library with no artists). When there are too
 * few to avoid them, repeats are allowed: the same radio again beats none.
 */
export async function pickSeeds(limit: number, exclude: Set<string> = new Set()): Promise<RadioArtist[]> {
  const out: RadioArtist[] = [];
  const seen = new Set<string>();
  const take = (list: RadioArtist[], skipExcluded: boolean) => {
    for (const a of list) {
      if (out.length >= limit || seen.has(a.id)) continue;
      if (skipExcluded && exclude.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  };

  let ranked: RadioArtist[] = [];
  try {
    ranked = await serverSeeds();
  } catch {
    // The play counts didn't answer; the tier below still can.
  }
  // In a different order every time: each refresh is another handful of the
  // artists played most, not the same top six.
  take(shuffled(ranked), true);
  let all: RadioArtist[] | null = null;
  const library = async (): Promise<RadioArtist[]> => {
    if (!all) {
      try {
        all = shuffled(await getArtists()).map((a: Artist) => ({
          id: a.id,
          name: a.name,
          coverArt: a.coverArt,
        }));
      } catch {
        all = [];
      }
    }
    return all;
  };
  if (out.length < limit) take(await library(), true);
  if (out.length < limit) take(ranked, false);
  if (out.length < limit) take(await library(), false);
  return out.slice(0, limit);
}

/**
 * One radio definition: the seed confirmed against the server (its current
 * name and cover), its similar artists, and the colour its icon will use.
 *
 * Every fetch has its own catch so a server without the Last.fm agent - or
 * with `getArtistInfo` off - still produces a radio of the seed's own top
 * tracks, which is what an empty `similar` means for the mix below.
 */
export async function buildRadioDef(seed: RadioArtist, own?: Song[]): Promise<RadioDef | null> {
  let base = seed;
  try {
    const { artist } = await getArtist(seed.id);
    base = { id: seed.id, name: artist.name || seed.name, coverArt: artist.coverArt || seed.coverArt };
  } catch {
    if (!seed.name) return null; // nothing to title it with
  }
  // An artist without a picture of its own wears its best known album's.
  if (!base.coverArt) base = { ...base, coverArt: own?.find((s) => s.coverArt)?.coverArt };

  let similar: RadioArtist[] = [];
  try {
    const info = await getArtistInfo(base.id);
    similar = info.similarArtists
      .filter((a) => a.id !== base.id)
      .slice(0, SIMILAR_PER_RADIO)
      .map((a) => ({ id: a.id, name: a.name, coverArt: a.coverArt }));
  } catch {
    // No similables: the radio is the seed's own.
  }

  const def: RadioDef = { seed: base, similar, color: '', createdAt: Date.now() };
  def.color = await radioColor(def);
  return def;
}

/**
 * The radio's colour: read off the seed's picture, or off its first track's
 * cover when the picture can't be read (no artist image, or the server still
 * fetching it from outside). Empty when neither can: the next refresh tries
 * again instead of keeping a grey for a week.
 */
async function radioColor(def: RadioDef): Promise<string> {
  const mode = themeMode();
  const seed = await coverColorOf(coverArtUrl(def.seed.coverArt || def.seed.id, COVER.thumb), mode, true);
  if (seed) return seed;
  const cover = def.tracks?.find((s) => s.coverArt)?.coverArt;
  if (!cover) return '';
  return (await coverColorOf(coverArtUrl(cover, COVER.thumb), mode, true)) ?? '';
}

/** Gives a colour to the radios that have none (or the plain grey an older
 *  build saved), and drops their icons so they are drawn again in it. */
async function recolor(defs: RadioDef[]): Promise<RadioDef[] | null> {
  let changed = false;
  const next = await Promise.all(
    defs.map(async (d) => {
      if (d.color && !isPlainTint(d.color)) return d;
      const color = await radioColor(d);
      if (!color || color === d.color) return d;
      changed = true;
      return { ...d, color };
    }),
  );
  return changed ? next : null;
}

/**
 * The tracks of one radio, aiming at `RADIO_TARGET`.
 *
 * Four pools are gathered - the seed's own top songs, the similar artists'
 * top songs, whatever the server suggests as similar to the seed's first
 * track, and the library's random songs - each shuffled, so the order is
 * not the same twice the way a server's ranking always is. The last two
 * pools only draw from the neighbourhood (the seed and its similar
 * artists): unfiltered, they are where the children's songs and the
 * strangers came from. The pools are then dealt out round by round, one
 * song from each per pass: every source keeps feeding the mix instead of
 * playing as a block.
 *
 * Three rules make it a radio rather than shuffled bins. It opens on the
 * seed's own most played - a radio never starts anywhere else. No two tracks
 * in a row are ever the same artist. And each artist is capped by the pool
 * it came from (six from the seed, three from a similar, two from the
 * filler) so nobody takes the list over, the same rule the player's own
 * radio extension works by (see `radioCandidates` in player.ts).
 */
export async function radioTracks(def: RadioDef, ownSongs?: Song[]): Promise<Song[]> {
  const [seedTop, similarLists] = await Promise.all([
    ownSongs ?? seedSongs(def.seed),
    Promise.all(
      def.similar
        .slice(0, 6)
        .map((a) => getTopSongs(a.name, 6, a.id).catch(() => [] as Song[])),
    ),
  ]);
  const extras = seedTop[0]
    ? await getSimilarSongs(seedTop[0].id, 30).catch(() => [] as Song[])
    : [];
  const random = await getRandomSongs(100).catch(() => [] as Song[]);
  // An artist Last.fm has few neighbours for gets its genre instead: songs
  // of the same style, rather than the last resort's strangers.
  const genre = few(def.similar) ? mainGenre(seedTop) : undefined;
  const sameGenre = genre
    ? (await getRandomSongs(60, genre).catch(() => [] as Song[])).filter((s) => !bySeed(s, def.seed))
    : [];

  const artistOf = (s: Song): string => s.artistId ?? s.artist ?? '';
  // The neighbourhood, by id and by name (a song without an id still tells
  // whose it is): the filler pools below only take songs from inside it.
  const allowIds = new Set([def.seed.id, ...def.similar.map((a) => a.id)]);
  const allowNames = new Set(
    [def.seed.name, ...def.similar.map((a) => a.name)].map((n) => n.toLowerCase()),
  );
  const inNeighborhood = (s: Song): boolean =>
    (s.artistId != null && allowIds.has(s.artistId)) ||
    (s.artist != null && allowNames.has(s.artist.toLowerCase()));
  // The opener: the seed's own most played, taken before the shuffle that
  // scrambles the rest - the first frame of the list is always the same.
  const opener = seedTop.find((s) => s.id && !s.url);
  const pools = [
    { songs: shuffled(seedTop.filter((s) => s !== opener)), cap: 6 },
    ...similarLists.map((list) => ({ songs: shuffled(list), cap: 3 })),
    { songs: shuffled(extras.filter(inNeighborhood)), cap: 2 },
    { songs: shuffled(random.filter(inNeighborhood)), cap: 2 },
    { songs: shuffled(sameGenre), cap: 2 },
  ].filter((p) => p.songs.length > 0);

  // Per pool, filter once: playable, not a repeat of a song already handed
  // out (the pools overlap - an artist's track can sit in three of them),
  // and within its artist's cap. The opener counts against the seed pool's
  // cap: six of the seed's own songs in all, opener included.
  const seen = new Set<string>();
  if (opener?.id) seen.add(opener.id);
  const lists = pools.map((p, i) => {
    const perArtist = new Map<string, number>();
    if (i === 0 && opener) perArtist.set(artistOf(opener), 1);
    const out: Song[] = [];
    for (const s of p.songs) {
      if (!s.id || s.url || seen.has(s.id)) continue;
      const artist = artistOf(s);
      const n = (perArtist.get(artist) ?? 0) + 1;
      if (n > p.cap) continue;
      perArtist.set(artist, n);
      seen.add(s.id);
      out.push(s);
    }
    return out;
  });

  const picked: Song[] = [];
  if (opener) picked.push(opener);

  // Deal: each pass takes the next song from every pool in turn. A pool
  // whose head repeats the artist just played holds it back for a later
  // slot; when every remaining head repeats it, the mix has said what it
  // has to say and the list stops where it is - the rule does not bend.
  const ptr = lists.map(() => 0);
  let cursor = 0;
  let guard = 0;
  while (picked.length < RADIO_TARGET && guard++ < RADIO_TARGET * 4) {
    const live = lists.map((_, i) => i).filter((i) => ptr[i] < lists[i].length);
    if (live.length === 0) break;
    const i = live[cursor++ % live.length];
    const head = lists[i][ptr[i]];
    const last = picked.length > 0 ? artistOf(picked[picked.length - 1]) : null;
    if (artistOf(head) === last) {
      const free = live.some((j) => artistOf(lists[j][ptr[j]]) !== last);
      if (!free) break;
      continue; // the head waits; another pool gets this slot
    }
    picked.push(head);
    ptr[i]++;
  }

  // Last resort, and only when the neighbourhood came up short: whatever is
  // left of the two filler pools, unfiltered - one track per artist at most,
  // and never two in a row. A filler with no artist to its name is skipped:
  // unattributed is exactly the untrustworthy kind.
  if (picked.length < MIN_RADIO_TRACKS) {
    const outsiders = new Set<string>();
    for (const s of shuffled([...extras, ...random])) {
      if (picked.length >= RADIO_TARGET) break;
      if (!s.id || s.url || seen.has(s.id)) continue;
      const artist = artistOf(s);
      if (!artist || outsiders.has(artist)) continue;
      if (picked.length > 0 && artist === artistOf(picked[picked.length - 1])) continue;
      outsiders.add(artist);
      seen.add(s.id);
      picked.push(s);
    }
  }
  return picked;
}

/** Fewer similar artists than a mix can be made of. */
function few(similar: RadioArtist[]): boolean {
  return similar.length < 3;
}

/** The genre most of these songs carry, if any of them carry one. */
function mainGenre(songs: Song[]): string | undefined {
  const counts = new Map<string, number>();
  for (const s of songs) if (s.genre) counts.set(s.genre, (counts.get(s.genre) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Songs of its own a seed needs to make a radio of: below that it is a
 *  name on somebody else's hit, and its radio would be everyone else. */
const MIN_SEED_SONGS = 3;

/** Whether a song is the seed artist's own, collaborations included: the
 *  song's `artistId` is only its first artist's. */
function bySeed(s: Song, seed: RadioArtist): boolean {
  const name = seed.name.toLowerCase();
  return (
    s.artistId === seed.id ||
    s.artist?.toLowerCase() === name ||
    !!s.artists?.some((a) => a.id === seed.id || a.name.toLowerCase() === name) ||
    !!s.albumArtists?.some((a) => a.id === seed.id)
  );
}

/**
 * The seed's own songs, most played first. The top songs come from Last.fm,
 * which knows nothing of an artist it never heard of: those fall back to the
 * artist's albums on this server. Without them the radio had no opener and
 * the last resort filled it with thirty strangers.
 */
async function seedSongs(seed: RadioArtist): Promise<Song[]> {
  // Last.fm's top songs are matched to the library by name, which lets other
  // artists' songs in: only the seed's own are kept.
  const top = (await getTopSongs(seed.name, 15, seed.id).catch(() => [] as Song[])).filter((s) =>
    bySeed(s, seed),
  );
  if (top.length >= 5) return top;
  try {
    const { albums } = await getArtist(seed.id);
    const lists = await Promise.all(
      albums.slice(0, 6).map((a) => getAlbum(a.id).then((d) => d.songs).catch(() => [] as Song[])),
    );
    const ids = new Set(top.map((s) => s.id));
    const own = lists
      .flat()
      .filter((s) => bySeed(s, seed) && !ids.has(s.id))
      .sort((x, y) => (y.playCount ?? 0) - (x.playCount ?? 0));
    return [...top, ...own].slice(0, 15);
  } catch {
    return top;
  }
}

let inflight: Promise<RadioDef[]> | null = null;

/**
 * Rebuilds the Home radios when they are missing or stale, and otherwise
 * hands back what is saved (the cheap path: Home asks on every focus).
 *
 * Concurrent callers share one build, and the icons are generated after the
 * index is written so the section can paint the collages immediately and
 * swap in the files as they land.
 */
export function refreshRadios(opts: { force?: boolean } = {}): Promise<RadioDef[]> {
  // A forced one (pulling Home) waits for whatever is under way and then
  // builds anyway: sharing a quiet check's answer would make the pull a no-op.
  if (inflight) return opts.force ? inflight.then(() => refreshRadios(opts)) : inflight;
  inflight = (async () => {
    const { radiosEnabled, radioCount } = useSettings.getState();
    // Turned off: nothing is built and nothing is asked of the server.
    if (!radiosEnabled) return [];
    const store = useRadios.getState();
    await store.hydrate();
    const count = radioCount || RADIO_SEEDS;
    if (!opts.force && !radiosStale(useRadios.getState().defs)) {
      const recolored = await recolor(useRadios.getState().defs);
      if (recolored) await useRadios.getState().recolor(recolored);
      // Fresh radios can still be missing an icon (one whose drawing changed).
      void ensureRadioIcons(useRadios.getState().defs);
      return useRadios.getState().defs;
    }
    // More candidates than radios: the ones with too few songs of their own
    // are passed over (see `MIN_SEED_SONGS`), and only when that leaves too
    // few does the bar drop to one song.
    // Only now is there a new set on its way: the cheap paths above return
    // before this and never show it.
    useRadios.getState().setBuilding(true);
    const candidates = await pickSeeds(
      count * 3,
      new Set(useRadios.getState().defs.map((d) => d.seed.id)),
    );
    const own = new Map<string, Song[]>();
    const seeds: RadioArtist[] = [];
    for (let i = 0; i < candidates.length && seeds.length < count; i += RADIO_SEEDS) {
      const batch = candidates.slice(i, i + RADIO_SEEDS);
      const songs = await Promise.all(batch.map((c) => seedSongs(c).catch(() => [] as Song[])));
      batch.forEach((c, j) => {
        own.set(c.id, songs[j]);
        if (seeds.length < count && songs[j].length >= MIN_SEED_SONGS) seeds.push(c);
      });
    }
    for (const c of candidates) {
      if (seeds.length >= count) break;
      if (!seeds.includes(c) && (own.get(c.id)?.length ?? 0) > 0) seeds.push(c);
    }
    // Only the cards: the artist, its neighbours and its colour. The list of
    // songs is the expensive part, and it is made when a radio is opened.
    const defs = (await Promise.all(seeds.map((s) => buildRadioDef(s, own.get(s.id))))).filter(
      (d): d is RadioDef => d !== null,
    );
    // All at once, so the shelf swaps whole rather than one card at a time.
    await useRadios.getState().setDefs(defs);
    void ensureRadioIcons(defs);
    return useRadios.getState().defs;
  })().finally(() => {
    inflight = null;
    useRadios.getState().setBuilding(false);
  });
  return inflight;
}

/**
 * The next round of a radio being played, for the player once its queue is
 * near the end: the same mix, drawn again, without what the queue already has.
 * Null when the radio cannot be made (an artist the server no longer knows).
 */
export async function moreRadioTracks(id: string, have: Set<string>): Promise<Song[] | null> {
  await useRadios.getState().hydrate();
  let def = useRadios.getState().defs.find((d) => d.seed.id === id) ?? null;
  if (!def) {
    const { artist } = await getArtist(id);
    def = await buildRadioDef({ id, name: artist.name, coverArt: artist.coverArt });
  }
  if (!def) return null;
  return (await radioTracks(def)).filter((s) => !have.has(s.id));
}
