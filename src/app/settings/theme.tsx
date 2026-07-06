/**
 * Ajustes › Tema: placeholder por ahora. La personalización de tema (claro /
 * oscuro, colores de acento…) llegará en una versión futura; de momento la
 * sección existe pero no tiene funcionalidad.
 */
import { ScrollView } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';

export default function ThemeSettings() {
  const t = useT();
  return (
    <SettingsPage title={t('Theme')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <EmptyState
          icon="color-palette-outline"
          title={t('Coming soon')}
          subtitle={t('Theme customization is on the way.')}
        />
      </ScrollView>
    </SettingsPage>
  );
}
