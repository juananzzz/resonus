/**
 * Letras para la música local/offline, en orden de preferencia:
 *
 * 1. Fichero `.lrc` junto al audio (mismo nombre). Cubre también las
 *    descargas: al bajar una canción se cachea ahí la letra del servidor.
 * 2. Letra embebida en el propio fichero (frame ID3 USLT).
 * 3. LRCLIB (lrclib.net), solo si el usuario activa el ajuste: manda artista
 *    y título fuera. El resultado se cachea en disco para no repetir la red.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { type Song, type SongLyrics } from '@/api/subsonic';
import { hashKey, readTags } from './localLibrary';
import { parseLrc } from './lrc';

const LRCLIB_CACHE_DIR = FileSystem.documentDirectory + 'lyrics-cache/';
const AUDIO_EXT_RE = /\.[a-z0-9]{1,5}$/i;

/** URI del `.lrc` hermano de un audio (vale para `file://` y SAF). */
export function siblingLrcUri(audioUri: string): string | null {
  if (!AUDIO_EXT_RE.test(audioUri)) return null;
  return audioUri.replace(AUDIO_EXT_RE, '.lrc');
}

/** Lee un fichero de texto; null si no existe o no se puede leer. */
async function readTextIfExists(uri: string): Promise<string | null> {
  try {
    const text = await FileSystem.readAsStringAsync(uri);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

export async function getLocalLyrics(song: Song, allowOnline: boolean): Promise<SongLyrics | null> {
  const uri = song.localUri;
  if (uri) {
    // 1) .lrc junto al fichero.
    const lrcUri = siblingLrcUri(uri);
    const lrcText = lrcUri ? await readTextIfExists(lrcUri) : null;
    const fromFile = lrcText ? parseLrc(lrcText) : null;
    if (fromFile) return fromFile;

    // 2) USLT embebido (puede traer timestamps estilo LRC dentro).
    const tags = await readTags(uri);
    const fromTag = tags?.lyrics ? parseLrc(tags.lyrics) : null;
    if (fromTag) return fromTag;
  }

  // 3) LRCLIB, si el usuario lo permite.
  if (allowOnline) return fetchLrclibCached(song);
  return null;
}

async function fetchLrclibCached(song: Song): Promise<SongLyrics | null> {
  const file = `${LRCLIB_CACHE_DIR}${hashKey(song.id)}.lrc`;
  const cached = await readTextIfExists(file);
  if (cached) return parseLrc(cached);
  const text = await fetchLrclib(song);
  if (!text) return null;
  try {
    await FileSystem.makeDirectoryAsync(LRCLIB_CACHE_DIR, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(file, text);
  } catch {
    // Sin caché seguimos funcionando; solo repetiría la petición.
  }
  return parseLrc(text);
}

interface LrclibResult {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

function pickLrclibText(r: LrclibResult | undefined): string | null {
  if (!r || r.instrumental) return null;
  return r.syncedLyrics?.trim() || r.plainLyrics?.trim() || null;
}

/** Busca la letra en LRCLIB por artista+título. Devuelve el texto LRC/plano. */
async function fetchLrclib(song: Song): Promise<string | null> {
  if (!song.title || !song.artist) return null;
  const headers = { 'Lrclib-Client': 'Resonus (https://github.com/juananzzz/resonus)' };
  try {
    // /api/get exige la firma completa (álbum + duración); si la tenemos, es
    // la vía más precisa. Si no (o si da 404), /api/search y el primer match.
    if (song.album && song.duration) {
      const params = new URLSearchParams({
        artist_name: song.artist,
        track_name: song.title,
        album_name: song.album,
        duration: String(Math.round(song.duration)),
      });
      const res = await fetch(`https://lrclib.net/api/get?${params}`, { headers });
      if (res.ok) {
        const text = pickLrclibText((await res.json()) as LrclibResult);
        if (text) return text;
      }
    }
    const params = new URLSearchParams({ artist_name: song.artist, track_name: song.title });
    const res = await fetch(`https://lrclib.net/api/search?${params}`, { headers });
    if (!res.ok) return null;
    const results = (await res.json()) as LrclibResult[];
    for (const r of results) {
      const text = pickLrclibText(r);
      if (text) return text;
    }
    return null;
  } catch {
    return null; // sin red o API caída: simplemente no hay letra
  }
}
