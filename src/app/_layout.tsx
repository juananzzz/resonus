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

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { GlobalMiniPlayer } from '@/components/GlobalMiniPlayer';
import { SongMenuSheet } from '@/components/SongMenuSheet';
import { Toast } from '@/components/Toast';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

export default function RootLayout() {
  const auth = useAuthStore((s) => s.auth);
  const hydrating = useAuthStore((s) => s.hydrating);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    useSettings.getState().hydrate();
  }, [hydrate]);

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
              <Stack.Protected guard={!!auth}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="album/[id]" />
                <Stack.Screen name="playlist/[id]" />
                <Stack.Screen name="artist/[id]" />
                <Stack.Screen name="favorites" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="lyrics" options={{ presentation: 'modal' }} />
                <Stack.Screen name="player" options={{ presentation: 'modal' }} />
                <Stack.Screen name="queue" options={{ presentation: 'modal' }} />
              </Stack.Protected>
              <Stack.Protected guard={!auth}>
                <Stack.Screen name="login" />
              </Stack.Protected>
            </Stack>
            {auth ? <GlobalMiniPlayer /> : null}
            {auth ? <SongMenuSheet /> : null}
            <Toast />
          </View>
          </ErrorBoundary>
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
