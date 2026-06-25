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
