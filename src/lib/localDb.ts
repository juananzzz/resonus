/**
 * The phone's own music, catalogued, in a database.
 *
 * The local profile scans a folder or the whole device and ends up with every
 * song, album and artist it found. That used to be one JSON file per source,
 * written whole after a scan and parsed whole on every start: a library of a
 * few thousand files is several megabytes of string built in one piece and
 * taken apart again, on the thread that is trying to draw the first screen.
 *
 * Same shape as the downloads catalog next door, and for the same reasons: a
 * row per thing, the object itself kept as JSON in a column, and the columns
 * that get searched on pulled out beside it. Rows can be written in batches and
 * read back without a single string holding the library.
 *
 * One database per source, since "the device" and each chosen folder are
 * different libraries and are scanned apart.
 */
import * as SQLite from 'expo-sqlite';

import type { Song } from '@/api/subsonic';
import { timed } from './perfLog';

const SCHEMA = `
PRAGMA journal_mode = WAL;
-- See downloadsDb: without a limit the log keeps whatever it grew to.
PRAGMA journal_size_limit = 524288;
-- The columns are the ones that get sorted, searched or grouped on, pulled out
-- beside the object itself so that answering "the first fifty albums by name"
-- is the database's job and not fifteen thousand objects' walk through JS.
-- Same shape as the downloads catalog, so one set of queries serves both.
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY NOT NULL,
  album_id TEXT,
  artist_key TEXT,
  title TEXT,
  artist TEXT,
  disc INTEGER,
  track INTEGER,
  added_at INTEGER,
  -- Lower case and without accents, so that searching for "nino" finds "Niño".
  -- SQLite's LIKE only folds case, and only for ASCII, so the folded text has
  -- to be a column of its own for the search to be the database's job.
  title_norm TEXT,
  artist_norm TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS songs_album ON songs(album_id);
CREATE INDEX IF NOT EXISTS songs_artist ON songs(artist_key);
CREATE INDEX IF NOT EXISTS songs_title ON songs(title);
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  artist TEXT,
  artist_key TEXT,
  added_at INTEGER,
  year INTEGER,
  name_norm TEXT,
  artist_norm TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS albums_name ON albums(name);
CREATE INDEX IF NOT EXISTS albums_artist ON albums(artist_key);
CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  name_norm TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artists_name ON artists(name);
`;

/** Rows per statement. Two placeholders each, well under the limit. */
const PER_INSERT = 200;

/** Which catalog a query is about: one database per source (see `dbName`). */
export interface Source {
  dir: string;
  name: string;
}

/** Lower case and without accents, which is how the searchable columns are
 *  written and how a query has to be folded before it is compared to them. */
export function norm(text: string | undefined): string | null {
  if (!text) return null;
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Columns added after the first catalogs were written. `ALTER TABLE` is the
 *  only way in, and it throws on the ones that are already there. */
const ADDED_COLUMNS: [string, string][] = [
  ['songs', 'title_norm'],
  ['songs', 'artist_norm'],
  ['albums', 'name_norm'],
  ['albums', 'artist_norm'],
  ['artists', 'name_norm'],
];

/**
 * Fills the searchable columns of a catalog scanned before they existed.
 *
 * Only the short columns are read, never the objects: this is the walk through
 * the whole library that the queries are here to stop doing, and it happens
 * once instead of on every start. A rescan would be the alternative, and on a
 * phone full of music that is minutes of reading tags for nothing.
 */
async function fill(
  handle: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  from: string,
  value: (text: string | null) => string | null,
  includeNull: boolean,
): Promise<void> {
  // A row whose source column is empty is left alone unless the caller says
  // otherwise: writing NULL over NULL would leave it pending for ever and this
  // would run again on every open.
  const where = includeNull
    ? `${column} IS NULL`
    : `${column} IS NULL AND ${from} IS NOT NULL`;
  const pending = await handle.getAllAsync<{ id: string; value: string | null }>(
    `SELECT id, ${from} AS value FROM ${table} WHERE ${where}`,
  );
  if (pending.length === 0) return;
  await handle.withTransactionAsync(async () => {
    for (const row of pending) {
      await handle.runAsync(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [
        value(row.value),
        row.id,
      ]);
    }
  });
}

async function backfillNorm(handle: SQLite.SQLiteDatabase): Promise<void> {
  for (const [table, column] of ADDED_COLUMNS) {
    await handle.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`).catch(() => {});
  }
  await timed('local catalog backfill', async () => {
    for (const [table, column] of ADDED_COLUMNS) {
      await fill(handle, table, column, column.replace(/_norm$/, ''), (text) =>
        norm(text ?? undefined), false);
    }
  });
}

/**
 * Fills a column for rows that were written without one.
 *
 * The value is the caller's to work out: `artist_key` is the id the scan gives
 * an artist, made of their name in a particular way, and this module has no
 * business knowing how. Every row is touched once and then never again, since
 * what it looks for is the column still being empty.
 */
export async function backfillColumn(
  src: Source,
  table: string,
  column: string,
  from: string,
  value: (text: string | null) => string | null,
): Promise<void> {
  const handle = await db(src.dir, src.name);
  await timed('local catalog keys', () => fill(handle, table, column, from, value, true));
}

const open = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/**
 * One handle per source, in the folder the catalogs already lived in, so that
 * "Scan again" deleting that folder still takes everything with it.
 */
function db(dir: string, name: string): Promise<SQLite.SQLiteDatabase> {
  const key = `${dir}|${name}`;
  const existing = open.get(key);
  if (existing) return existing;
  const work = (async () => {
    const handle = await SQLite.openDatabaseAsync(name, {}, dir.replace(/^file:\/\//, ''));
    await handle.execAsync(SCHEMA);
    await backfillNorm(handle);
    return handle;
  })();
  open.set(key, work);
  return work;
}

/** Closes them all, for when the directory they live in is about to go. */
export async function closeLocalDbs(): Promise<void> {
  const handles = [...open.values()];
  open.clear();
  for (const h of handles) await h.then((d) => d.closeAsync()).catch(() => {});
}

/** What a catalog holds, as the rest of the app knows it. */
export interface StoredCatalog<A, R> {
  songs: Song[];
  albums: A[];
  artists: R[];
}

async function rows<T>(handle: SQLite.SQLiteDatabase, table: string): Promise<T[]> {
  const found = await handle.getAllAsync<{ data: string }>(`SELECT data FROM ${table}`);
  return found.map((r) => JSON.parse(r.data) as T);
}

/** The whole catalog, or null if this source has never been scanned. */
export async function loadCatalog<A, R>(
  dir: string,
  name: string,
): Promise<StoredCatalog<A, R> | null> {
  const handle = await db(dir, name);
  return timed('local catalog read', async () => {
    const songs = await rows<Song>(handle, 'songs');
    if (songs.length === 0) return null;
    return {
      songs,
      albums: await rows<A>(handle, 'albums'),
      artists: await rows<R>(handle, 'artists'),
    };
  });
}

/** The columns each table carries besides the object itself. */
type Columns = (item: never) => (string | number | null)[];

const COLUMNS: Record<string, { names: string[]; of: Columns }> = {
  songs: {
    names: [
      'album_id',
      'artist_key',
      'title',
      'artist',
      'disc',
      'track',
      'added_at',
      'title_norm',
      'artist_norm',
    ],
    of: ((s: Song) => [
      s.albumId ?? null,
      s.artistId ?? null,
      s.title ?? null,
      s.artist ?? null,
      s.discNumber ?? null,
      s.track ?? null,
      s.addedAt ?? null,
      norm(s.title),
      norm(s.artist),
    ]) as Columns,
  },
  albums: {
    names: ['name', 'artist', 'artist_key', 'added_at', 'year', 'name_norm', 'artist_norm'],
    of: ((a: { name?: string; artist?: string; artistId?: string; addedAt?: number; year?: number }) => [
      a.name ?? null,
      a.artist ?? null,
      a.artistId ?? null,
      a.addedAt ?? null,
      a.year ?? null,
      norm(a.name),
      norm(a.artist),
    ]) as Columns,
  },
  artists: {
    names: ['name', 'name_norm'],
    of: ((a: { name?: string }) => [a.name ?? null, norm(a.name)]) as Columns,
  },
};

async function replace(
  handle: SQLite.SQLiteDatabase,
  table: string,
  items: { id: string }[],
): Promise<void> {
  const spec = COLUMNS[table];
  const cols = ['id', ...spec.names, 'data'];
  const placeholders = `(${cols.map(() => '?').join(', ')})`;
  await handle.runAsync(`DELETE FROM ${table}`);
  for (let i = 0; i < items.length; i += PER_INSERT) {
    const part = items.slice(i, i + PER_INSERT);
    const marks = part.map(() => placeholders).join(',');
    const params: (string | number | null)[] = [];
    for (const it of part) {
      params.push(it.id, ...spec.of(it as never), JSON.stringify(it));
    }
    await handle.runAsync(
      `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES ${marks}`,
      params,
    );
  }
}

/**
 * Writes a scan down, replacing whatever was there.
 *
 * In one transaction: a scan that is interrupted half way through leaves the
 * previous catalog rather than half of two.
 */
export async function saveCatalog<A extends { id: string }, R extends { id: string }>(
  dir: string,
  name: string,
  catalog: StoredCatalog<A, R>,
): Promise<void> {
  const handle = await db(dir, name);
  await timed('local catalog write', () =>
    handle.withTransactionAsync(async () => {
      await replace(handle, 'songs', catalog.songs as { id: string }[]);
      await replace(handle, 'albums', catalog.albums);
      await replace(handle, 'artists', catalog.artists);
    }),
  );
}

// ── Asking the database instead of the catalog ──────────────────────────────
// What follows is the local profile's half of what `downloadsDb` does for a
// server's downloads: answering a screen's question with the rows it shows,
// rather than with the library in memory. The two catalogs are kept apart on
// purpose — a folder of files on the phone and a server's downloads are
// different things, and their tables say different things about a song — so
// these queries are their own and touch nothing over there.

function parsed<T>(rows: { data: string }[]): T[] {
  return rows.map((r) => JSON.parse(r.data) as T);
}

/**
 * Every album and artist, as the cover index wants them: the id and the object
 * it can take a `coverUri` out of.
 *
 * The one query that does read a whole table, and on purpose. Which cover a
 * song shows is answered from an index in memory, without a round trip, from
 * wherever a song turns up — a queue restored at start, a playlist, the
 * notification — and there is no query behind those. It is the albums and the
 * artists, though, never the songs: a library of fifteen thousand tracks is a
 * thousand records, and that is the whole difference.
 */
export async function coverRows<T>(src: Source, table: 'albums' | 'artists'): Promise<T[]> {
  const handle = await db(src.dir, src.name);
  const rows = await timed('local cover index', () =>
    handle.getAllAsync<{ data: string }>(`SELECT data FROM ${table}`),
  );
  return parsed<T>(rows);
}

/** Has this source ever been scanned? The one question asked before deciding
 *  whether a scan has to happen at all, so it reads a single row. */
export async function hasSongs(src: Source): Promise<boolean> {
  const handle = await db(src.dir, src.name);
  const row = await handle.getFirstAsync<{ id: string }>('SELECT id FROM songs LIMIT 1');
  return !!row;
}

/** Every song's id and the date its file carried, which is all it takes to
 *  tell whether the files on the phone are still the ones that were scanned. */
export async function songStamps(src: Source): Promise<Map<string, number>> {
  const handle = await db(src.dir, src.name);
  const rows = await handle.getAllAsync<{ id: string; added_at: number | null }>(
    'SELECT id, added_at FROM songs',
  );
  return new Map(rows.map((r) => [r.id, r.added_at ?? 0]));
}

/** Where every song's file is, without the songs themselves. */
export async function songUris(
  src: Source,
): Promise<{ id: string; uri: string; albumId?: string }[]> {
  const handle = await db(src.dir, src.name);
  const rows = await handle.getAllAsync<{ id: string; uri: string | null; album_id: string | null }>(
    "SELECT id, album_id, json_extract(data, '$.localUri') AS uri FROM songs",
  );
  return rows.flatMap((r) => (r.uri ? [{ id: r.id, uri: r.uri, albumId: r.album_id ?? undefined }] : []));
}

/** How many songs a catalog holds. */
export async function songCount(src: Source): Promise<number> {
  const handle = await db(src.dir, src.name);
  const row = await handle.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM songs');
  return row?.n ?? 0;
}

const ALBUM_ORDER = {
  name: 'name COLLATE NOCASE ASC',
  artist: 'artist COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
  // The date the file carries, and the year for the ones that have none: a
  // folder of music copied in one go shares a date to the second.
  newest: 'added_at DESC, year DESC',
  // NULLs sort last under DESC in SQLite, which is where an album with no year
  // belongs: last, not leading the list of what just came out.
  year: 'year DESC, name COLLATE NOCASE ASC',
  random: 'RANDOM()',
} as const;

export type AlbumOrder = keyof typeof ALBUM_ORDER;

export async function albumsPage<A>(
  src: Source,
  order: AlbumOrder,
  limit: number,
  offset: number,
): Promise<A[]> {
  const handle = await db(src.dir, src.name);
  const rows = await timed('local albums page', () =>
    handle.getAllAsync<{ data: string }>(
      `SELECT data FROM albums ORDER BY ${ALBUM_ORDER[order]} LIMIT ? OFFSET ?`,
      [limit, offset],
    ),
  );
  return parsed<A>(rows);
}

export async function albumById<A>(src: Source, id: string): Promise<A | null> {
  const handle = await db(src.dir, src.name);
  const row = await handle.getFirstAsync<{ data: string }>(
    'SELECT data FROM albums WHERE id = ?',
    [id],
  );
  return row ? (JSON.parse(row.data) as A) : null;
}

/** One album's songs, in the order they are meant to be played: disc first,
 *  then track, and whatever carries neither by title at the end. */
export async function albumSongs(src: Source, albumId: string): Promise<Song[]> {
  const handle = await db(src.dir, src.name);
  const rows = await timed('local album songs', () =>
    handle.getAllAsync<{ data: string }>(
      `SELECT data FROM songs WHERE album_id = ?
        ORDER BY disc IS NULL, disc, track IS NULL, track, title COLLATE NOCASE`,
      [albumId],
    ),
  );
  return parsed<Song>(rows);
}

export async function allArtists<R>(src: Source): Promise<R[]> {
  const handle = await db(src.dir, src.name);
  const rows = await timed('local artists', () =>
    handle.getAllAsync<{ data: string }>('SELECT data FROM artists ORDER BY name COLLATE NOCASE'),
  );
  return parsed<R>(rows);
}

export async function artistById<R>(src: Source, id: string): Promise<R | null> {
  const handle = await db(src.dir, src.name);
  const row = await handle.getFirstAsync<{ data: string }>(
    'SELECT data FROM artists WHERE id = ?',
    [id],
  );
  return row ? (JSON.parse(row.data) as R) : null;
}

/** The albums filed under an artist, newest first, which is how a discography
 *  is read. */
export async function artistAlbums<A>(src: Source, artistKey: string): Promise<A[]> {
  const handle = await db(src.dir, src.name);
  const rows = await handle.getAllAsync<{ data: string }>(
    `SELECT data FROM albums WHERE artist_key = ? ORDER BY year DESC, name COLLATE NOCASE`,
    [artistKey],
  );
  return parsed<A>(rows);
}

const SONG_ORDER = {
  title: 'title COLLATE NOCASE ASC',
  newest: 'added_at DESC',
  random: 'RANDOM()',
  // What the scan wrote, which is the library's own order.
  server: 'rowid',
} as const;

export type SongOrder = keyof typeof SONG_ORDER;

export async function songsPage(
  src: Source,
  order: SongOrder,
  limit: number,
  offset: number,
): Promise<Song[]> {
  const handle = await db(src.dir, src.name);
  const rows = await timed('local songs page', () =>
    handle.getAllAsync<{ data: string }>(
      `SELECT data FROM songs ORDER BY ${SONG_ORDER[order]} LIMIT ? OFFSET ?`,
      [limit, offset],
    ),
  );
  return parsed<Song>(rows);
}

/** An artist's songs, by the name the tag carries rather than by id: this is
 *  what "top songs" is asked with. */
export async function songsByArtist(src: Source, artist: string, limit: number): Promise<Song[]> {
  const handle = await db(src.dir, src.name);
  const rows = await handle.getAllAsync<{ data: string }>(
    'SELECT data FROM songs WHERE artist = ? ORDER BY rowid LIMIT ?',
    [artist, limit],
  );
  return parsed<Song>(rows);
}

/** The albums an artist's songs sit on, for the records they only guest on. */
export async function albumIdsOfArtist(src: Source, artistKey: string): Promise<string[]> {
  const handle = await db(src.dir, src.name);
  const rows = await handle.getAllAsync<{ album_id: string | null }>(
    'SELECT DISTINCT album_id FROM songs WHERE artist_key = ?',
    [artistKey],
  );
  return rows.map((r) => r.album_id).filter((id): id is string => !!id);
}

/** How many parameters go into one `IN (...)`, well under SQLite's own limit. */
const PARAM_CHUNK = 400;

async function byIds<T>(src: Source, table: string, ids: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (ids.length === 0) return out;
  const handle = await db(src.dir, src.name);
  for (let i = 0; i < ids.length; i += PARAM_CHUNK) {
    const part = ids.slice(i, i + PARAM_CHUNK);
    const rows = await handle.getAllAsync<{ id: string; data: string }>(
      `SELECT id, data FROM ${table} WHERE id IN (${part.map(() => '?').join(',')})`,
      part,
    );
    for (const r of rows) out.set(r.id, JSON.parse(r.data) as T);
  }
  return out;
}

/** Rows by id, as a map: the caller has the order it wants them in (a
 *  playlist's, the history's, the favourites') and SQL has none. */
export function songsByIds(src: Source, ids: string[]): Promise<Map<string, Song>> {
  return byIds<Song>(src, 'songs', ids);
}

export function albumsByIds<A>(src: Source, ids: string[]): Promise<Map<string, A>> {
  return byIds<A>(src, 'albums', ids);
}

export function artistsByIds<R>(src: Source, ids: string[]): Promise<Map<string, R>> {
  return byIds<R>(src, 'artists', ids);
}

/**
 * The songs whose title or artist contains the text, folded.
 *
 * `LIMIT` is deliberately generous: what comes back is ranked afterwards (a
 * name that starts with the query beats one that merely contains it), and a
 * tight limit here would decide the ranking by whatever the alphabet put first.
 */
export async function searchSongs(src: Source, text: string, limit: number): Promise<Song[]> {
  const handle = await db(src.dir, src.name);
  const like = `%${norm(text)}%`;
  const rows = await timed('local search songs', () =>
    handle.getAllAsync<{ data: string }>(
      `SELECT data FROM songs WHERE title_norm LIKE ? OR artist_norm LIKE ?
        ORDER BY title COLLATE NOCASE LIMIT ?`,
      [like, like, limit],
    ),
  );
  return parsed<Song>(rows);
}

export async function searchAlbums<A>(src: Source, text: string, limit: number): Promise<A[]> {
  const handle = await db(src.dir, src.name);
  const like = `%${norm(text)}%`;
  const rows = await timed('local search albums', () =>
    handle.getAllAsync<{ data: string }>(
      `SELECT data FROM albums WHERE name_norm LIKE ? OR artist_norm LIKE ?
        ORDER BY name COLLATE NOCASE LIMIT ?`,
      [like, like, limit],
    ),
  );
  return parsed<A>(rows);
}

export async function searchArtists<R>(src: Source, text: string, limit: number): Promise<R[]> {
  const handle = await db(src.dir, src.name);
  const like = `%${norm(text)}%`;
  const rows = await handle.getAllAsync<{ data: string }>(
    `SELECT data FROM artists WHERE name_norm LIKE ? ORDER BY name COLLATE NOCASE LIMIT ?`,
    [like, limit],
  );
  return parsed<R>(rows);
}

/** The albums holding a song whose title matches, for the search's last tier. */
export async function albumIdsOfMatchingSongs(
  src: Source,
  text: string,
  limit: number,
): Promise<{ albumIds: string[]; artistKeys: string[] }> {
  const handle = await db(src.dir, src.name);
  const like = `%${norm(text)}%`;
  const rows = await handle.getAllAsync<{ album_id: string | null; artist_key: string | null }>(
    `SELECT DISTINCT album_id, artist_key FROM songs WHERE title_norm LIKE ? LIMIT ?`,
    [like, limit],
  );
  return {
    albumIds: rows.map((r) => r.album_id).filter((id): id is string => !!id),
    artistKeys: rows.map((r) => r.artist_key).filter((k): k is string => !!k),
  };
}
