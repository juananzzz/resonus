/**
 * Botón de Google Cast para la barra del reproductor. Solo aparece si hay
 * aparatos Cast en la red; al tocarlo, el sistema muestra el selector y la
 * sesión la gestiona src/store/cast.ts. La librería nativa se carga con
 * require() perezoso para no romper web ni builds sin Google Play Services.
 */
import { Platform, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

type GoogleCastModule = typeof import('react-native-google-cast');

let castModule: GoogleCastModule | null = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    castModule = require('react-native-google-cast') as GoogleCastModule;
  } catch {
    castModule = null;
  }
}

export function CastIconButton() {
  if (!castModule) return null;
  return <NativeCastButton cast={castModule} />;
}

function NativeCastButton({ cast }: { cast: GoogleCastModule }) {
  const state = cast.useCastState();
  if (state == null || state === 'noDevicesAvailable') return null;
  const CastButton = cast.CastButton;
  return (
    <View style={styles.circle}>
      <CastButton style={{ width: 24, height: 24, tintColor: colors.text }} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
