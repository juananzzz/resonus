/**
 * Color de acento actual, reactivo. Léelo en el render (estilos inline) para
 * que los componentes se recoloreen al cambiar el acento en Ajustes → Theme.
 * (El acento no puede vivir solo en `colors.accent` porque los estilos de
 * `StyleSheet.create` se congelan al cargar el módulo.)
 */
import { useSettings } from '@/store/settings';

export function useAccent(): string {
  return useSettings((s) => s.accentColor);
}
