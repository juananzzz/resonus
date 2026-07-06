/**
 * Layout raíz: proveedores globales y control de sesión. Las rutas se protegen
 * según haya o no sesión iniciada, usando Stack.Protected de expo-router.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ArtistPickerSheet } from '@/components/ArtistPickerSheet';
import { CarAutoSync } from '@/components/CarAutoSync';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { GlobalMiniPlayer } from '@/components/GlobalMiniPlayer';
import { MediaMenuSheet } from '@/components/MediaMenuSheet';
import { SongMenuSheet } from '@/components/SongMenuSheet';
import { Toast } from '@/components/Toast';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useLastPlayed } from '@/store/lastPlayed';
import { usePins } from '@/store/pins';
import { initRemoteIntegration, usePlayerStore } from '@/store/player';
import { usePlayCounts } from '@/store/playCounts';
import { usePlayHistory } from '@/store/playHistory';
import { useRecentSearches } from '@/store/recentSearches';
import { useSettings } from '@/store/settings';
import { useSortPrefs } from '@/store/sortPrefs';
import { colors } from '@/theme';

export default function RootLayout() {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const offlineSource = useAuthStore((s) => s.offlineSource);
  const hydrating = useAuthStore((s) => s.hydrating);
  const hydrate = useAuthStore((s) => s.hydrate);
  // Con descargas, el perfil local funciona sin haber elegido origen de música.
  const hasDownloads = useDownloads((s) => Object.keys(s.files).length > 0);
  const ready = !!auth || (offline && (!!offlineSource || hasDownloads));
  // Perfil activo identificado para recargar búsquedas recientes al cambiar
  const activeProfile = auth ? `${auth.serverUrl}|${auth.username}` : offline ? 'offline' : '';

  useEffect(() => {
    hydrate();
    useSettings.getState().hydrate();
    useRecentSearches.getState().hydrate();
    usePlayCounts.getState().hydrate();
    usePlayHistory.getState().hydrate();
    useSortPrefs.getState().hydrate();
    void useLastPlayed.getState().hydrate();
    void usePins.getState().hydrate();
    void useDownloads.getState().hydrate();
    initRemoteIntegration();
  }, [hydrate, activeProfile]);

  // Al entrar en un perfil (servidor o local), retoma la cola guardada
  // (sin reproducir): primero la copia del dispositivo, si no la del servidor.
  useEffect(() => {
    if (ready) void usePlayerStore.getState().restoreQueue();
  }, [ready, activeProfile]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        {hydrating ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.background,
            }}
          >
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : (
          <ErrorBoundary>
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerShown: false,
                // Fundido rápido entre pantallas: en Android la duración de las
                // transiciones nativas no se puede tocar y los empujes laterales
                // (slide/ios_from_right) se sentían lentos.
                animation: 'fade',
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Protected guard={ready}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="album/[id]" />
                <Stack.Screen name="playlist/[id]" />
                <Stack.Screen name="artist/[id]" />
                <Stack.Screen name="artist/discography/[id]" />
                <Stack.Screen name="browse/albums" />
                <Stack.Screen name="browse/artists" />
                <Stack.Screen name="genres" />
                <Stack.Screen name="genre/[name]" />
                <Stack.Screen name="radio" />
                <Stack.Screen name="favorites" />
                <Stack.Screen name="history" />
                <Stack.Screen name="settings/index" />
                <Stack.Screen name="settings/library" />
                <Stack.Screen name="settings/playback" />
                <Stack.Screen name="settings/language" />
                <Stack.Screen name="settings/personalization" />
                <Stack.Screen name="settings/theme" />
                <Stack.Screen name="settings/about" />
              </Stack.Protected>
              <Stack.Protected guard={offline && !offlineSource && !hasDownloads}>
                <Stack.Screen name="offline" />
              </Stack.Protected>
              <Stack.Protected guard={!auth && !offline}>
                <Stack.Screen name="login" />
              </Stack.Protected>
              {/* Modales compartidos por servidor y offline (requieren canción
                  activa). Suben desde abajo pero con la variante corta
                  (fade_from_bottom): el slide_from_bottom nativo dura ~350 ms
                  fijos y abrir el player se sentía lento. */}
              <Stack.Screen
                name="player"
                options={{ presentation: 'modal', animation: 'fade_from_bottom' }}
              />
              <Stack.Screen
                name="queue"
                options={{ presentation: 'modal', animation: 'fade_from_bottom' }}
              />
              <Stack.Screen
                name="lyrics"
                options={{ presentation: 'modal', animation: 'fade_from_bottom' }}
              />
            </Stack>
            {auth || offline ? <GlobalMiniPlayer /> : null}
            {auth || offline ? <SongMenuSheet /> : null}
            {auth || offline ? <ArtistPickerSheet /> : null}
            {auth || offline ? <MediaMenuSheet /> : null}
            {auth || offline ? <CarAutoSync /> : null}
            <Toast />
          </View>
          </ErrorBoundary>
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
