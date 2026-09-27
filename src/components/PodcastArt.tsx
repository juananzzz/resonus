/**
 * Cover art for the Podcasts entry point: a warm gradient with a headset, so it
 * reads as its own thing next to the indigo Favorites square. Drawn rather than
 * borrowed from a subscription, because it has to be there before you have one.
 */
import Icon from '@/components/Icon';
import { LinearGradient } from 'expo-linear-gradient';

import { radius } from '@/theme';

/** `square` for when a container rounds it from outside. */
export function PodcastArt({ size, square }: { size: number; square?: boolean }) {
  return (
    <LinearGradient
      colors={['#c2410c', '#f59e0b'] as const}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: square ? 0 : radius.md,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="headset" size={size * 0.45} color="#fff" />
    </LinearGradient>
  );
}
