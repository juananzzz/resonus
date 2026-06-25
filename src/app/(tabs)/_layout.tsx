/**
 * Navegación principal por pestañas: Inicio, Buscar y Biblioteca.
 * Estilo Spotify: barra sin borde con un degradado que se funde a oscuro
 * abajo para que los iconos se lean bien sobre el contenido.
 */
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
          tabBarInactiveTintColor: colors.textSecondary,
          sceneStyle: { backgroundColor: colors.background },
          tabBarBackground: () => (
            <LinearGradient
              colors={['transparent', colors.background, colors.background] as const}
              locations={[0, 0.4, 1]}
              style={StyleSheet.absoluteFill}
            />
          ),
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
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
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: 'Buscar',
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? 'search' : 'search-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: 'Biblioteca',
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? 'library' : 'library-outline'} color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
