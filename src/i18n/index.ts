/**
 * i18n mínimo y reactivo. El texto en español es la clave; cada idioma extra
 * tiene su diccionario (clave española → traducción). `useT()` devuelve una
 * función `t` ligada al idioma actual (del store de ajustes), por lo que
 * cambiar el idioma re-renderiza y traduce al vuelo.
 *
 * Para añadir un idioma nuevo (p. ej. 'fr'):
 *   1. Añádelo a `Language` en src/store/settings.ts (y a su `hydrate`).
 *   2. Crea aquí su diccionario `const fr = { ... }` y mételo en `dictionaries`.
 *   3. Añade sus formas a `PLURALS` (singular/plural).
 *   4. Añade su opción a `LANGUAGES` en src/app/settings.tsx.
 * El español no necesita diccionario (es la clave); lo no traducido cae a él.
 */
import { useCallback } from 'react';

import { useSettings, type Language } from '@/store/settings';

const en: Record<string, string> = {
  // Tabs
  Inicio: 'Home',
  Buscar: 'Search',
  Biblioteca: 'Library',
  // Login
  'Conéctate a tu servidor de música': 'Connect to your music server',
  'Perfiles guardados': 'Saved profiles',
  'Añadir otra cuenta': 'Add another account',
  Pronto: 'Soon',
  Usuario: 'Username',
  Contraseña: 'Password',
  Entrar: 'Sign in',
  'El soporte de Jellyfin llegará pronto. Por ahora usa Navidrome u OpenSubsonic.':
    'Jellyfin support is coming soon. For now use Navidrome or OpenSubsonic.',
  'No se pudo entrar; revisa la cuenta': "Couldn't sign in; check the account",
  'Jellyfin estará disponible pronto 🚧': 'Jellyfin is coming soon 🚧',
  'No se pudo iniciar sesión': "Couldn't sign in",
  o: 'or',
  'Modo sin conexión': 'Offline mode',
  'Escucha la música guardada en tu dispositivo, sin servidor.':
    'Listen to music stored on your device, without a server.',
  'Escucha la música guardada en tu dispositivo, sin servidor. Elige de dónde sacarla:':
    'Listen to music stored on your device, without a server. Choose where from:',
  Local: 'Local',
  'Música local': 'Local music',
  'Origen · Volver a escanear': 'Source · Rescan',
  'Volver a escanear': 'Rescan',
  'Volviendo a escanear tu música…': 'Rescanning your music…',
  'Biblioteca actualizada': 'Library updated',
  'No se pudo volver a escanear': "Couldn't rescan",
  Salir: 'Exit',
  'Cambiar origen': 'Change source',
  '¿De dónde sacamos tu música?': 'Where should we get your music?',
  'Escanear todo el móvil': 'Scan the whole phone',
  'Toda la música del dispositivo.': 'All the music on your device.',
  'Elegir una carpeta': 'Choose a folder',
  'Solo la música de la carpeta que elijas.': 'Only the music in the folder you choose.',
  'Necesitamos permiso para leer la música del dispositivo.':
    'We need permission to read your device music.',
  'No se pudo cargar la música local.': "Couldn't load local music.",
  'No hay música en esta ubicación.': 'No music in this location.',
  // Home
  'Tu música': 'Your music',
  'Reproducido recientemente': 'Recently played',
  'Añadidos recientemente': 'Recently added',
  'Añadido recientemente': 'Recently added',
  'Más escuchados': 'Most played',
  Favoritos: 'Favorites',
  // Search
  'Canciones, álbumes, artistas': 'Songs, albums, artists',
  'Búsquedas recientes': 'Recent searches',
  'Borrar todo': 'Clear all',
  Borrar: 'Clear',
  Artistas: 'Artists',
  Álbumes: 'Albums',
  Canciones: 'Songs',
  // Library / playlists
  Listas: 'Playlists',
  Lista: 'Playlist',
  Álbum: 'Album',
  Cancelar: 'Cancel',
  Crear: 'Create',
  'Nueva lista': 'New playlist',
  'Nombre de la lista': 'Playlist name',
  'Lista creada': 'Playlist created',
  'No se pudo crear la lista': "Couldn't create the playlist",
  Ordenar: 'Sort',
  'Ordenar por': 'Sort by',
  Dirección: 'Direction',
  Recientes: 'Recent',
  Alfabético: 'Alphabetical',
  Ascendente: 'Ascending',
  Descendente: 'Descending',
  Renombrar: 'Rename',
  'Renombrar lista': 'Rename playlist',
  Eliminar: 'Delete',
  'Eliminar lista': 'Delete playlist',
  '¿Eliminar «{name}»?': 'Delete “{name}”?',
  'Esta acción no se puede deshacer.': "This can't be undone.",
  'Lista eliminada': 'Playlist deleted',
  'Lista renombrada': 'Playlist renamed',
  'No se pudo completar la acción': "Couldn't complete the action",
  'No hay listas de reproducción.': 'No playlists.',
  'No hay artistas.': 'No artists.',
  'No hay artistas guardados.': 'No saved artists.',
  'No hay álbumes guardados.': 'No saved albums.',
  'No se encontró música en el dispositivo.': 'No music found on this device.',
  'Analizando tu música…': 'Scanning your music…',
  'No se pudieron cargar los álbumes.': "Couldn't load albums.",
  'No se pudieron cargar las listas.': "Couldn't load playlists.",
  'No se pudieron cargar los artistas.': "Couldn't load artists.",
  Reintentar: 'Retry',
  // Favorites
  Reproducir: 'Play',
  'Aún no tienes canciones favoritas.': "You don't have favorite songs yet.",
  'No se pudieron cargar los favoritos.': "Couldn't load favorites.",
  // Album / playlist / artist
  'No se pudo cargar el álbum.': "Couldn't load the album.",
  'No se pudo cargar la lista.': "Couldn't load the playlist.",
  'No se pudo cargar el artista.': "Couldn't load the artist.",
  Populares: 'Popular',
  'Ver más': 'Show more',
  'Ver menos': 'Show less',
  Discografía: 'Discography',
  'Mostrar todo': 'Show all',
  'Mostrar todos': 'Show all',
  'Artistas similares': 'Similar artists',
  // Player
  REPRODUCIENDO: 'NOW PLAYING',
  'REPRODUCIENDO DESDE': 'PLAYING FROM',
  Desconocido: 'Unknown',
  Cerrar: 'Close',
  'Más opciones': 'More options',
  Aleatorio: 'Shuffle',
  Anterior: 'Previous',
  Pausar: 'Pause',
  Siguiente: 'Next',
  Repetir: 'Repeat',
  'Ver la cola': 'View queue',
  'No se pudo reproducir la canción': "Couldn't play the song",
  'No se pudo reproducir': "Couldn't play",
  // Queue
  Cola: 'Queue',
  'La cola está vacía.': 'The queue is empty.',
  // Lyrics
  Letra: 'Lyrics',
  'No hay letra disponible para esta canción.':
    'No lyrics available for this song.',
  // Song menu
  'Añadir a una playlist': 'Add to a playlist',
  'Quitar de la lista': 'Remove from playlist',
  'Quitada de la lista': 'Removed from playlist',
  'Ir al artista': 'Go to artist',
  'Ir al álbum': 'Go to album',
  'Reproducir a continuación': 'Play next',
  'Añadir a la cola': 'Add to queue',
  'Añadir a favoritos': 'Add to favorites',
  'Quitar de favoritos': 'Remove from favorites',
  Descargar: 'Download',
  'Temporizador de apagado': 'Sleep timer',
  'Temporizador ({n} min)': 'Sleep timer ({n} min)',
  'Próximamente 🚧': 'Coming soon 🚧',
  'Se pausará en {n} min': 'Will pause in {n} min',
  'Temporizador desactivado': 'Sleep timer off',
  Desactivar: 'Turn off',
  'No se pudo añadir a la lista': "Couldn't add to the playlist",
  // Settings
  Ajustes: 'Settings',
  Cuenta: 'Account',
  'Calidad y reproducción': 'Quality & playback',
  'Servidor · Cerrar sesión': 'Server · Sign out',
  'Escaneo · Limpiar caché': 'Scan · Clear cache',
  'Calidad · Crossfade · Ecualizador': 'Quality · Crossfade · Equalizer',
  'Versión · GitHub': 'Version · GitHub',
  Servidor: 'Server',
  'Estado del escaneo': 'Scan status',
  'Escaneando…': 'Scanning…',
  'Escanear ahora': 'Scan now',
  'Calidad de streaming': 'Streaming quality',
  '«Original» usa la máxima calidad; bajar el bitrate ahorra datos.':
    '“Original” uses the highest quality; a lower bitrate saves data.',
  Reproducción: 'Playback',
  Crossfade: 'Crossfade',
  Ecualizador: 'Equalizer',
  Pantalla: 'Display',
  Idioma: 'Language',
  Almacenamiento: 'Storage',
  'Limpiar caché': 'Clear cache',
  'Acerca de': 'About',
  Versión: 'Version',
  'Ver en GitHub': 'View on GitHub',
  'Cerrar sesión': 'Sign out',
  'Salir del modo sin conexión': 'Exit offline mode',
  'Escaneo iniciado': 'Scan started',
  'No se pudo iniciar el escaneo': "Couldn't start the scan",
  'Caché limpiada': 'Cache cleared',
  // Radio
  Radio: 'Radio',
  'No hay emisoras de radio.': 'No radio stations.',
  'No se pudieron cargar las emisoras.': "Couldn't load radio stations.",
  // Audio quality
  'Formato y calidad': 'Format & quality',
  'Muestra el formato de audio, bitrate y etiquetas Lossless / Hi-Res junto a cada canción.':
    'Displays the audio format, bitrate, and Lossless / Hi-Res labels next to each song.',
  No: 'No',
  'Solo reproductor': 'Player only',
  'En todas partes': 'Everywhere',
  Lossless: 'Lossless',
  'Hi-Res': 'Hi-Res',
  'Marca artistas como favoritos para verlos aquí.':
    'Star artists to see them here.',
  'Marca álbumes como favoritos para verlos aquí.':
    'Star albums to see them here.',
  // Offline specifics
  'Marca canciones con el corazón para verlas aquí.':
    'Tap the heart on songs to see them here.',
  'Las listas no están disponibles en modo sin conexión.':
    'Playlists are not available in offline mode.',
  'La letra no está disponible en modo sin conexión.':
    'Lyrics are not available in offline mode.',
  'Estás reproduciendo música almacenada en tu dispositivo.':
    'You are playing music stored on your device.',
  Origen: 'Source',
  // Error boundary
  'Algo ha fallado': 'Something went wrong',
  // Misc placeholders / dynamic
  '{n} elementos': '{n} items',
  'Calidad: {label}': 'Quality: {label}',
  'Añadida a «{name}»': 'Added to “{name}”',
  '{n} min': '{n} min',
  '{n} minutos': '{n} minutes',
};

/** Diccionarios por idioma. El español es la clave, así que no lleva tabla. */
const dictionaries: Partial<Record<Language, Record<string, string>>> = {
  en,
};

type Vars = Record<string, string | number>;

function translate(text: string, lang: Language, vars?: Vars): string {
  const table = dictionaries[lang];
  let out = table?.[text] ?? text;
  if (vars) {
    for (const key of Object.keys(vars)) {
      out = out.split(`{${key}}`).join(String(vars[key]));
    }
  }
  return out;
}

/** Traducción fuera de componentes (p. ej. en stores). Lee el idioma actual. */
export function tg(text: string, vars?: Vars): string {
  return translate(text, useSettings.getState().language, vars);
}

export type TFunction = (text: string, vars?: Vars) => string;

/** Hook reactivo: devuelve `t` ligada al idioma actual. */
export function useT(): TFunction {
  const lang = useSettings((s) => s.language);
  return useCallback((text: string, vars?: Vars) => translate(text, lang, vars), [lang]);
}

/**
 * Formas singular/plural por idioma para los contadores. El español ('es')
 * es obligatorio (fallback); el resto son opcionales.
 */
const PLURALS: Record<string, Partial<Record<Language, [string, string]>>> = {
  song: { es: ['canción', 'canciones'], en: ['song', 'songs'] },
  album: { es: ['álbum', 'álbumes'], en: ['album', 'albums'] },
};

function countLabel(kind: keyof typeof PLURALS, n: number, lang: Language): string {
  const forms = PLURALS[kind][lang] ?? PLURALS[kind].es!;
  return `${n} ${forms[n === 1 ? 0 : 1]}`;
}

/** "N canción/canciones" (o su equivalente) según idioma. */
export function songsLabel(n: number, lang: Language): string {
  return countLabel('song', n, lang);
}

/** "N álbum/álbumes" (o su equivalente) según idioma. */
export function albumsLabel(n: number, lang: Language): string {
  return countLabel('album', n, lang);
}
