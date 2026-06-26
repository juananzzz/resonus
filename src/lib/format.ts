/** Convierte segundos a "m:ss" (o "h:mm:ss" si supera la hora). */
export function formatDuration(totalSeconds: number | undefined): string {
  if (!totalSeconds || totalSeconds < 0 || !Number.isFinite(totalSeconds)) {
    return '0:00';
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Duración total legible para una lista/álbum: "45 min", "1 h 30 min",
 * "2 h", "1 d 3 h 20 min". Muestra horas a partir de 60 min y días a partir
 * de 24 h. Las abreviaturas (d/h/min) son convencionales en ambos idiomas.
 */
export function formatTotalDuration(totalSeconds: number | undefined): string {
  const s = totalSeconds && Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} d`);
  if (hours > 0) parts.push(`${hours} h`);
  // Minutos: si hay, o si no hay nada más (duración menor de 1 min).
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(' ');
}
