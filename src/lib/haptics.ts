/**
 * Vibración sutil al usar los controles (desactivable en Ajustes → Aspecto).
 * Centralizado para que cada llamada respete el ajuste sin repetir el check.
 */
import * as Haptics from 'expo-haptics';

import { useSettings } from '@/store/settings';

export function tapHaptic() {
  if (!useSettings.getState().hapticsEnabled) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
