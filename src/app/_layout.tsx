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

import { CarAutoSync } from '@/components/CarAutoSync';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { GlobalMiniPlayer } from '@/components/GlobalMiniPlayer';
import { SongMenuSheet } from '@/components/SongMenuSheet';
import { Toast } from '@/components/Toast';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { usePlayCounts } from '@/store/playCounts';
import { useRecentSearches } from '@/store/recentSearches';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

export default function RootLayout() {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const offlineSource = useAuthStore((s) => s.offlineSource);
  const hydrating = useAuthStore((s) => s.hydrating);
  const hydrate = useAuthStore((s) => s.hydrate);
  const ready = !!auth || (offline && !!offlineSource);
  // Perfil activo identificado para recargar búsquedas recientes al cambiar
  const activeProfile = auth ? `${auth.serverUrl}|${auth.username}` : offline ? 'offline' : '';

  useEffect(() => {
    hydrate();
    useSettings.getState().hydrate();
    useRecentSearches.getState().hydrate();
    usePlayCounts.getState().hydrate();
  }, [hydrate, activeProfile]);

  // Al iniciar sesión en un servidor, retoma la cola guardada (sin reproducir).
  useEffect(() => {
    if (auth) void usePlayerStore.getState().restoreFromServer();
  }, [auth]);

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
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
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
                <Stack.Screen name="settings/index" />
                <Stack.Screen name="settings/account" />
                <Stack.Screen name="settings/library" />
                <Stack.Screen name="settings/playback" />
                <Stack.Screen name="settings/language" />
                <Stack.Screen name="settings/personalization" />
                <Stack.Screen name="settings/about" />
              </Stack.Protected>
              <Stack.Protected guard={offline && !offlineSource}>
                <Stack.Screen name="offline" />
              </Stack.Protected>
              <Stack.Protected guard={!auth && !offline}>
                <Stack.Screen name="login" />
              </Stack.Protected>
              {/* Modales compartidos por servidor y offline (requieren canción activa). */}
              <Stack.Screen name="lyrics" options={{ presentation: 'modal' }} />
              <Stack.Screen name="player" options={{ presentation: 'modal' }} />
              <Stack.Screen name="queue" options={{ presentation: 'modal' }} />
            </Stack>
            {auth || offline ? <GlobalMiniPlayer /> : null}
            {auth || offline ? <SongMenuSheet /> : null}
            {auth || offline ? <CarAutoSync /> : null}
            <Toast />
          </View>
          </ErrorBoundary>
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
