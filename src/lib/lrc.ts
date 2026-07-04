/**
 * Formato LRC (letras con timestamps `[mm:ss.xx]`). Se usa para los ficheros
 * `.lrc` junto a la música local, la letra embebida USLT (que a menudo trae
 * timestamps) y para cachear en disco las letras del servidor o de LRCLIB.
 * Un texto sin timestamps también vale: sale como letra sin sincronizar.
 */
import { type LyricLine, type SongLyrics } from '@/api/subsonic';

/** Tags de metadatos LRC que se ignoran (menos `offset`, que sí se aplica). */
const META_RE = /^\[(ar|ti|al|au|by|la|re|ve|tool|length|id|#):[^\]]*\]$/i;
const STAMP_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/y;

export function parseLrc(text: string): SongLyrics | null {
  const timed: LyricLine[] = [];
  const plain: LyricLine[] = [];
  let offset = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (META_RE.test(line)) continue;
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
    if (off) {
      offset = parseInt(off[1], 10) || 0;
      continue;
    }
    // Timestamps al inicio (una línea puede llevar varios: estribillos).
    const starts: number[] = [];
    let pos = 0;
    for (;;) {
      STAMP_RE.lastIndex = pos;
      const m = STAMP_RE.exec(line);
      if (!m) break;
      const frac = m[3] ?? '';
      // 1 dígito = décimas, 2 = centésimas, 3 = milisegundos.
      const ms = frac ? parseInt(frac, 10) * [100, 10, 1][frac.length - 1] : 0;
      starts.push((parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000 + ms);
      pos = STAMP_RE.lastIndex;
    }
    const value = line.slice(pos).trim();
    if (starts.length === 0) {
      plain.push({ value: line });
    } else {
      for (const start of starts) timed.push({ start, value });
    }
  }

  if (timed.length > 0) {
    // `offset` positivo = la letra debe aparecer antes (misma convención que
    // el offset de OpenSubsonic).
    timed.sort((a, b) => a.start! - b.start!);
    return {
      synced: true,
      lines: timed.map((l) => ({ ...l, start: Math.max(0, l.start! - offset) })),
    };
  }
  if (plain.length > 0) return { synced: false, lines: plain };
  return null;
}

/** Serializa a texto LRC (o texto plano si la letra no está sincronizada). */
export function serializeLrc(lyrics: SongLyrics): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return lyrics.lines
    .map((l) => {
      if (!lyrics.synced || l.start === undefined) return l.value;
      const ms = Math.max(0, Math.round(l.start));
      const min = Math.floor(ms / 60000);
      const sec = Math.floor((ms % 60000) / 1000);
      const cs = Math.floor((ms % 1000) / 10);
      return `[${pad(min)}:${pad(sec)}.${pad(cs)}]${l.value}`;
    })
    .join('\n');
}
