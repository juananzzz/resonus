/**
 * Cliente mínimo de la API nativa de Navidrome (no Subsonic). Solo se usa
 * para lo que la API Subsonic no cubre: hoy, la carátula personalizada de
 * playlists (Navidrome ≥ 0.61). Necesita usuario y contraseña en claro para
 * obtener un JWT (`auth.ndPassword`); ver SubsonicAuth.
 */
import { type SubsonicAuth } from './subsonic';

/** Error tipado para poder dar mensajes útiles en la UI. */
export class NavidromeError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'forbidden' | 'unsupported' | 'other',
  ) {
    super(message);
  }
}

/** Inicia sesión en la API nativa y devuelve el JWT. */
async function ndLogin(auth: SubsonicAuth): Promise<string> {
  if (!auth.ndPassword) throw new NavidromeError('Sin contraseña guardada', 'auth');
  let res: Response;
  try {
    res = await fetch(`${auth.serverUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: auth.username, password: auth.ndPassword }),
    });
  } catch {
    throw new NavidromeError('No se pudo conectar con el servidor', 'other');
  }
  if (res.status === 401) throw new NavidromeError('Credenciales incorrectas', 'auth');
  if (!res.ok) throw new NavidromeError(`Error de red (${res.status})`, 'other');
  const json = (await res.json()) as { token?: string };
  if (!json.token) throw new NavidromeError('Respuesta inesperada del servidor', 'other');
  return json.token;
}

/** Petición autenticada a la API nativa, con errores mapeados a NavidromeError. */
async function ndFetch(auth: SubsonicAuth, path: string, init: RequestInit): Promise<void> {
  const token = await ndLogin(auth);
  let res: Response;
  try {
    res = await fetch(`${auth.serverUrl}${path}`, {
      ...init,
      headers: { ...init.headers, 'x-nd-authorization': `Bearer ${token}` },
    });
  } catch {
    throw new NavidromeError('No se pudo conectar con el servidor', 'other');
  }
  if (res.ok) return;
  if (res.status === 401) throw new NavidromeError('Credenciales incorrectas', 'auth');
  if (res.status === 403) throw new NavidromeError('Subida de carátulas deshabilitada', 'forbidden');
  if (res.status === 404 || res.status === 405) {
    throw new NavidromeError('El servidor no soporta carátulas de playlist', 'unsupported');
  }
  throw new NavidromeError(`Error del servidor (${res.status})`, 'other');
}

/**
 * Sube una imagen local como carátula de la playlist.
 * Endpoint: POST /api/playlist/{id}/image, multipart con campo "image"
 * (jpeg/png/gif/webp). 403 si el upload está deshabilitado o la playlist no
 * es del usuario; 404 en servidores sin soporte (< 0.61).
 */
export async function uploadPlaylistImage(
  auth: SubsonicAuth,
  playlistId: string,
  image: { uri: string; name: string; type: string },
): Promise<void> {
  const form = new FormData();
  // RN admite ficheros locales en FormData con {uri, name, type}.
  form.append('image', image as unknown as Blob);
  await ndFetch(auth, `/api/playlist/${encodeURIComponent(playlistId)}/image`, {
    method: 'POST',
    body: form,
  });
}

/** Quita la carátula personalizada; Navidrome vuelve al mosaico por defecto. */
export async function deletePlaylistImage(
  auth: SubsonicAuth,
  playlistId: string,
): Promise<void> {
  await ndFetch(auth, `/api/playlist/${encodeURIComponent(playlistId)}/image`, {
    method: 'DELETE',
  });
}
