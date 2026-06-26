/**
 * Acceso a la música local para el modo sin conexión. Dos orígenes:
 *
 * - 'device': toda la música del dispositivo vía expo-media-library
 *   (permiso READ_MEDIA_AUDIO).
 * - 'folder': una carpeta concreta que el usuario elige con el selector del
 *   sistema (Storage Access Framework de expo-file-system); se leen sus
 *   ficheros de audio de forma recursiva.
 *
 * Los metadatos de etiqueta (artista/título ID3) no están disponibles por
 * estas vías, así que el título es el nombre del fichero.
 */
import { StorageAccessFramework } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

import { type Song } from '@/api/subsonic';

const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|alac|aif|aiff)$/i;

function titleFromFilename(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

// ── Origen: dispositivo (expo-media-library) ──────────────────────────────

/** Pide (o comprueba) el permiso de lectura de audio. Devuelve si está concedido. */
export async function ensureAudioPermission(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync(false, ['audio']);
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const res = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
  return res.granted;
}

/** Carga todas las canciones de audio del dispositivo (con un tope de seguridad). */
export async function loadDeviceSongs(): Promise<Song[]> {
  const songs: Song[] = [];
  let after: string | undefined;
  let hasNext = true;
  while (hasNext && songs.length < 5000) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: 200,
      after,
    });
    for (const a of page.assets) {
      songs.push({
        id: `local:${a.id}`,
        title: titleFromFilename(a.filename),
        duration: a.duration,
        localUri: a.uri,
      });
    }
    after = page.endCursor;
    hasNext = page.hasNextPage;
  }
  return songs;
}

// ── Origen: carpeta concreta (Storage Access Framework) ───────────────────

/** Abre el selector de carpeta del sistema. Devuelve la URI del árbol o null. */
export async function pickFolder(): Promise<string | null> {
  const res = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  return res.granted ? res.directoryUri : null;
}

function nameFromSafUri(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const last = decoded.split('/').pop() ?? decoded;
  return titleFromFilename(last);
}

/** Lee recursivamente los ficheros de audio de una carpeta SAF. */
export async function loadFolderSongs(treeUri: string): Promise<Song[]> {
  const songs: Song[] = [];

  async function walk(dirUri: string, depth: number): Promise<void> {
    if (depth > 6 || songs.length >= 5000) return;
    let entries: string[];
    try {
      entries = await StorageAccessFramework.readDirectoryAsync(dirUri);
    } catch {
      return; // no era un directorio legible
    }
    for (const entryUri of entries) {
      const decoded = decodeURIComponent(entryUri);
      if (AUDIO_EXT.test(decoded)) {
        songs.push({ id: `local:${entryUri}`, title: nameFromSafUri(entryUri), localUri: entryUri });
      } else if (!/\.[a-z0-9]{1,5}$/i.test(decoded)) {
        // Sin extensión reconocible → probablemente una subcarpeta.
        await walk(entryUri, depth + 1);
      }
    }
  }

  await walk(treeUri, 0);
  songs.sort((a, b) => a.title.localeCompare(b.title));
  return songs;
}
