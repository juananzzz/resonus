/**
 * Mantiene Android Auto sincronizado con la reproducción:
 *  - Empuja el árbol de navegación (al iniciar y al cambiar de perfil).
 *  - Refleja la pista actual / cola / estado hacia el módulo nativo.
 *  - Recibe los toques (play) y botones de transporte del coche y los aplica
 *    al store del reproductor (que conduce expo-audio).
 *
 * No renderiza nada. En plataformas sin el módulo nativo es un no-op.
 */
import { useEffect } from 'react';

import { coverArtUrl, type Song } from '@/api/data';
import {
  carAutoAvailable,
  onPlay,
  onTransport,
  setNodes,
  setNowPlaying,
  setPlaybackState,
  setQueue,
  type CarTrack,
} from '@/lib/carAuto';
import { buildBrowseTree, handleBrowsePlay } from '@/lib/carAutoTree';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';

const REBUILD_DEBOUNCE_MS = 600;
const POSITION_PUSH_MS = 1000;

function toCarTrack(song: Song): CarTrack {
  return {
    id: song.id,
    title: song.title || undefined,
    artist: song.artist || undefined,
    album: song.album || undefined,
    artworkUrl: coverArtUrl(song.coverArt ?? song.albumId, 300) || undefined,
    durationMs: Math.round((song.duration ?? 0) * 1000),
  };
}

export function CarAutoSync() {
  useEffect(() => {
    if (!carAutoAvailable) return;
    let cancelled = false;
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Árbol de navegación ──
    const rebuild = () => {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(async () => {
        const { auth, offline } = useAuthStore.getState();
        if (!auth && !offline) return;
        const tree = await buildBrowseTree().catch(() => null);
        if (!cancelled && tree) setNodes(tree);
      }, REBUILD_DEBOUNCE_MS);
    };
    rebuild();
    const unsubAuth = useAuthStore.subscribe(rebuild);

    // ── Espejo del estado de reproducción ──
    const pushNowPlaying = () => {
      const { queue, index } = usePlayerStore.getState();
      const current = queue[index] ?? null;
      setNowPlaying(current ? toCarTrack(current) : null);
    };
    const pushQueue = () => {
      const { queue, index } = usePlayerStore.getState();
      setQueue(queue.map(toCarTrack), index);
    };
    const pushState = () => {
      const { isPlaying, positionSec, shuffle, repeat } = usePlayerStore.getState();
      setPlaybackState({
        isPlaying,
        positionMs: Math.round(positionSec * 1000),
        shuffle,
        repeatMode: repeat,
      });
    };
    pushNowPlaying();
    pushQueue();
    pushState();

    const unsubPlayer = usePlayerStore.subscribe((state, prev) => {
      if (state.queue !== prev.queue || state.index !== prev.index) {
        pushNowPlaying();
        pushQueue();
      }
      if (
        state.isPlaying !== prev.isPlaying ||
        state.shuffle !== prev.shuffle ||
        state.repeat !== prev.repeat
      ) {
        pushState();
      }
    });
    const interval = setInterval(pushState, POSITION_PUSH_MS);

    // ── Eventos desde el coche ──
    const playSub = onPlay((e) => {
      void handleBrowsePlay(e.mediaId, e.parentId);
    });
    const transportSub = onTransport((e) => {
      const store = usePlayerStore.getState();
      switch (e.action) {
        case 'play':
          if (!store.isPlaying) store.toggle();
          break;
        case 'pause':
          if (store.isPlaying) store.toggle();
          break;
        case 'next':
          store.next();
          break;
        case 'previous':
          store.previous();
          break;
        case 'seek':
          store.seekTo((e.value ?? 0) / 1000);
          break;
        case 'seekToIndex':
          store.jumpTo(Math.round(e.value ?? 0));
          break;
        case 'shuffle':
          if (Boolean(e.value) !== store.shuffle) store.toggleShuffle();
          break;
        case 'repeat': {
          // El store cicla off→all→one; lo avanzamos hasta el objetivo.
          for (let i = 0; i < 3 && usePlayerStore.getState().repeat !== e.value; i++) {
            usePlayerStore.getState().cycleRepeat();
          }
          break;
        }
      }
    });

    return () => {
      cancelled = true;
      if (rebuildTimer) clearTimeout(rebuildTimer);
      clearInterval(interval);
      unsubAuth();
      unsubPlayer();
      playSub?.remove();
      transportSub?.remove();
    };
  }, []);

  return null;
}
