/**
 * Main tab navigation: Home, Search and Library.
 * Solid bottom bar over the app background.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { colors, TAB_BAR_HEIGHT } from '@/theme';

//Little bouncing when clicking a button
function AnimatedTabIcon({
  focused,
  name,
  outlineName,
  color,
  size,
}: {
  focused: boolean;
  name: keyof typeof Ionicons.glyphMap;
  outlineName: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (focused) {
      // Quando viene selezionata, si rimpicciolisce prima (0.85) e poi torna a 1 con effetto molla
      scale.value = withSequence(
        withSpring(0.85, { damping: 10, stiffness: 300 }),
        withSpring(1, { damping: 8, stiffness: 200 })
      );
    } else {
      scale.value = 1;
    }
  }, [focused, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Ionicons name={focused ? name : outlineName} color={color} size={size} />
    </Animated.View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const t = useT();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          // Short crossfade when switching tabs, instead of the default hard
          // cut ('shift' felt slow).
          animation: 'fade',
          transitionSpec: {
            animation: 'timing',
            config: { duration: 80 },
          },
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textSecondary,
          sceneStyle: { backgroundColor: colors.background },
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: colors.background,
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
            title: t('Home'),
            tabBarIcon: ({ focused, color, size }) => (
              <AnimatedTabIcon
                focused={focused}
                name="home"
                outlineName="home-outline"
                color={color}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: t('Search'),
            tabBarIcon: ({ focused, color, size }) => (
              <AnimatedTabIcon
                focused={focused}
                name="search"
                outlineName="search-outline"
                color={color}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: t('Library'),
            tabBarIcon: ({ focused, color, size }) => (
              <AnimatedTabIcon
                focused={focused}
                name="library"
                outlineName="library-outline"
                color={color}
                size={size}
              />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
