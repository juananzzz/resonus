/**
 * Navegación principal por pestañas: Inicio, Buscar y Biblioteca.
 * El MiniPlayer se coloca flotando justo encima de la barra de pestañas.
 */
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from '@/components/MiniPlayer';
import { colors } from '@/theme';

const TAB_BAR_HEIGHT = 60;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textMuted,
          sceneStyle: { backgroundColor: colors.background },
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Inicio',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: 'Buscar',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="search" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: 'Biblioteca',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="library" color={color} size={size} />
            ),
          }}
        />
      </Tabs>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: TAB_BAR_HEIGHT + insets.bottom,
        }}
        pointerEvents="box-none"
      >
        <MiniPlayer />
      </View>
    </View>
  );
}
