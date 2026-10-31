import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { Cover } from './Cover';
import { AnimatedArtworkBackground } from './AnimatedArtworkView';
import { transparentOf } from '@/theme';
import { useArtworkMotionAllowed } from '@/hooks/useArtworkMotionAllowed';

/** A single artwork surface; callers choose its frame, colour and animation owner. */
export function BleedArtwork({ uri, width, height, color, topColor, autoplay = true, video, onAnimatedDetected }: {
  uri?: string; width: number; height: number; color: string; topColor?: string;
  video?: string | null; autoplay?: boolean; onAnimatedDetected?: (uri: string, animated: boolean) => void;
}) {
  const motionAllowed = useArtworkMotionAllowed();
  return (
    <View pointerEvents="none" style={{ width, height, overflow: 'hidden' }}>
      <Cover uri={uri} size={width} contentFit="contain" autoplay={autoplay && motionAllowed && !video}
        onAnimatedDetected={onAnimatedDetected} style={{ height, borderRadius: 0 }} />
      {video ? <AnimatedArtworkBackground key={video} square={video} fallbackUri={uri} frame={{ width, height }} /> : null}
      {topColor ? <LinearGradient colors={[topColor, transparentOf(topColor)]}
        style={[StyleSheet.absoluteFill, { bottom: undefined, height: height * 0.28 }]} /> : null}
      <LinearGradient colors={[transparentOf(color), color]} locations={[0.72, 1]}
        style={StyleSheet.absoluteFill} />
    </View>
  );
}
