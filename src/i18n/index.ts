/**
 * i18n mínimo y reactivo. El texto en español es la clave; aquí solo se
 * mantiene la traducción al inglés. `useT()` devuelve una función `t` ligada
 * al idioma actual (del store de ajustes), por lo que cambiar el idioma
 * re-renderiza y traduce al vuelo.
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
  'Tus cuentas': 'Your accounts',
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
  // Home
  'Tu música': 'Your music',
  'Reproducido recientemente': 'Recently played',
  'Añadido recientemente': 'Recently added',
  'Más escuchados': 'Most played',
  Favoritos: 'Favorites',
  // Search
  'Canciones, álbumes, artistas': 'Songs, albums, artists',
  Artistas: 'Artists',
  Álbumes: 'Albums',
  Canciones: 'Songs',
  // Library
  Listas: 'Playlists',
  'No hay listas de reproducción.': 'No playlists.',
  'No hay artistas.': 'No artists.',
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
  'Artistas similares': 'Similar artists',
  // Player
  REPRODUCIENDO: 'NOW PLAYING',
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
  'Escaneo iniciado': 'Scan started',
  'No se pudo iniciar el escaneo': "Couldn't start the scan",
  'Caché limpiada': 'Cache cleared',
  // Error boundary
  'Algo ha fallado': 'Something went wrong',
  // Misc placeholders / dynamic
  '{n} elementos': '{n} items',
  'Calidad: {label}': 'Quality: {label}',
  'Añadida a «{name}»': 'Added to “{name}”',
  '{n} min': '{n} min',
  '{n} minutos': '{n} minutes',
};

type Vars = Record<string, string | number>;

function translate(text: string, lang: Language, vars?: Vars): string {
  let out = lang === 'en' ? (en[text] ?? text) : text;
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

/** "N canción/canciones" según idioma. */
export function songsLabel(n: number, lang: Language): string {
  return lang === 'en'
    ? `${n} song${n === 1 ? '' : 's'}`
    : `${n} canción${n === 1 ? '' : 'es'}`;
}

/** "N álbum/álbumes" según idioma. */
export function albumsLabel(n: number, lang: Language): string {
  return lang === 'en'
    ? `${n} album${n === 1 ? '' : 's'}`
    : `${n} álbum${n === 1 ? '' : 'es'}`;
}
