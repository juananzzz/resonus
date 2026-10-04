/** UI-thread frame counts for the diagnostics report. Off unless measuring:
 *  a running frame callback keeps the UI thread drawing. */
import { useSegments } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { addUiFrames, AWAY_GAP_MS, LATE_MS, setPerfScreen, VERY_LATE_MS } from '@/lib/perfLog';
import { useSettings } from '@/store/settings';

const FLUSH_MS = 1000;

export function FrameMeter() {
  const enabled = useSettings((s) => s.diagnostics);
  // The UI thread keeps drawing with the app away and the screen on, and those
  // frames were landing on whatever screen was left open: a report had 200k of
  // them against one minute on screen.
  const [active, setActive] = useState(AppState.currentState === 'active');
  const on = enabled && active;
  const segments = useSegments() as string[];
  const screen = segments.filter((s) => !s.startsWith('(')).join('/') || 'home';

  const frames = useSharedValue(0);
  const late = useSharedValue(0);
  const veryLate = useSharedValue(0);
  const worst = useSharedValue(0);
  const read = useRef({ frames: 0, late: 0, veryLate: 0 });

  const meter = useFrameCallback((info) => {
    'worklet';
    const dt = info.timeSincePreviousFrame;
    if (dt === null || dt > AWAY_GAP_MS) return;
    frames.set(frames.get() + 1);
    if (dt > LATE_MS) late.set(late.get() + 1);
    if (dt > VERY_LATE_MS) veryLate.set(veryLate.get() + 1);
    if (dt > worst.get()) worst.set(dt);
  }, false);

  // Totals are cumulative so a read never races a reset; only `worst` resets.
  const flush = () => {
    const now = { frames: frames.get(), late: late.get(), veryLate: veryLate.get() };
    const prev = read.current;
    addUiFrames({
      frames: now.frames - prev.frames,
      late: now.late - prev.late,
      veryLate: now.veryLate - prev.veryLate,
      worstMs: Math.round(worst.get()),
    });
    worst.set(0);
    read.current = now;
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    meter.setActive(on);
    if (!on) return;
    const id = setInterval(flush, FLUSH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  useEffect(() => {
    if (on) flush();
    setPerfScreen(screen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  return null;
}
