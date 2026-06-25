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

import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/theme';

export default function RootLayout() {
  const auth = useAuthStore((s) => s.auth);
  const hydrating = useAuthStore((s) => s.hydrating);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
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
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Protected guard={!!auth}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="album/[id]" />
              <Stack.Screen name="playlist/[id]" />
              <Stack.Screen name="player" options={{ presentation: 'modal' }} />
            </Stack.Protected>
            <Stack.Protected guard={!auth}>
              <Stack.Screen name="login" />
            </Stack.Protected>
          </Stack>
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
