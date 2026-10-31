/**
 * HLS covers over their still ones: the still image underneath is the poster
 * the clip fades in over, so a missing or loading clip simply shows the
 * cover as before. Mounted only when a clip URL is known.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { useEffect, useState } from 'react';
import { Animated, AppState, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Cover } from './Cover';

import { useSettings } from '@/store/settings';
import { useArtworkMotionAllowed } from '@/hooks/useArtworkMotionAllowed';

let VideoView: React.ComponentType<any> | null = null;
let useVideoPlayer: ((source: string, setup?: (player: any) => void) => any) | null = null;
try {
  const mod = require('expo-video');
  VideoView = mod.VideoView ?? null;
  useVideoPlayer = mod.useVideoPlayer ?? null;
} catch {
  VideoView = null;
  useVideoPlayer = null;
}

/**
 * The layer-backed clip view (CoverClip module, device builds only): an
 * AVPlayer behind an AVPlayerLayer, never an AVPlayerViewController. The
 * controller is what breaks the song's lock screen once it has presented
 * video - muted or not - while the bare layer leaves the audio session,
 * Now Playing and the remote commands alone.
 */
let CoverClipNativeView: React.ComponentType<any> | null = null;
if (Platform.OS === 'ios') {
  try {
    const { requireNativeViewManager, requireOptionalNativeModule } = require('expo-modules-core');
    // The view manager never throws for a missing module - it renders an
    // "Unimplemented component" stub instead. The module itself is the real
    // capability check: null on runtimes without it (Expo Go).
    if (requireOptionalNativeModule('CoverClip')) {
      CoverClipNativeView = requireNativeViewManager('CoverClip', 'CoverClipView');
    }
  } catch {
    CoverClipNativeView = null;
  }
}

/**
 * True on builds that can play HLS covers: the layer view on iOS device
 * builds, expo-video on Android, nothing on runtimes without them (Expo Go).
 */
export function canPlayAnimatedCovers(): boolean {
  if (Platform.OS === 'ios') return !!CoverClipNativeView;
  return !!VideoView && !!useVideoPlayer;
}

/**
 * Whether the app is truly in the background (locked or minimized - not just
 * Control Center pulled over it). Cover clips only exist while there is
 * something to watch: behind the lock screen the song's session must stand
 * alone, or the system keeps preferring the video surface and the audio
 * controls never show. Inactive (Control Center, switcher peek) keeps the
 * video mounted, so pulling those down no longer stutters and restarts it.
 */
function useIsBackground(): boolean {
  const [bg, setBg] = useState(AppState.currentState === 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setBg(state === 'background');
    });
    return () => sub.remove();
  }, []);
  return bg;
}

/**
 * A native call that may land nowhere: on teardown (Expo Go most of all)
 * the shared object can be gone while JS still holds it. Those calls are
 * best-effort by design — the still cover underneath covers for them.
 */
function callPlayer(fn: () => void): void {
  try {
    fn();
  } catch {
    // The native player is already gone; nothing to pause or start.
  }
}

/** A looping muted clip player that sleeps with the app: no decoding behind
 *  the lock screen, where only the audio keeps going. */
function useClipPlayer(uri: string): any {
  const player = useVideoPlayer!(uri, (p) => {
    p.loop = true;
    p.muted = true;
    // Never the music's audio focus: a clip that took it would pause the song
    // it decorates. Said outright rather than left to the muted default.
    p.audioMixingMode = 'mixWithOthers';
    callPlayer(() => p.play());
  });
  useEffect(() => {
    callPlayer(() => player.play());
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') callPlayer(() => player.play());
      else callPlayer(() => player.pause());
    });
    return () => {
      sub.remove();
      callPlayer(() => player.pause());
    };
  }, [player]);
  return player;
}

function ClipVideo({ uri, size, corner }: { uri: string; size: number; corner: number }) {
  const player = useClipPlayer(uri);
  if (!VideoView) return null;
  const VV = VideoView;
  return (
    <VV
      style={{ width: size, height: size, borderRadius: corner }}
      player={player}
      contentFit="cover"
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}

export function AnimatedArtworkView({
  square,
  size,
  corner,
}: {
  /** Square HLS clip, or null while unknown: renders nothing then. */
  square: string | null | undefined;
  size: number;
  corner: number;
}) {
  // Only iOS offers the switch (see the Player settings).
  const videoOn = useSettings((s) => s.animatedCoverVideo || Platform.OS !== 'ios');
  const bg = useIsBackground();
  const motionAllowed = useArtworkMotionAllowed();
  if (!videoOn || !square || bg || !motionAllowed) return null;
  if (Platform.OS === 'ios') {
    if (!CoverClipNativeView) return null;
    const CCV = CoverClipNativeView;
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
        <CCV style={{ width: size, height: size, borderRadius: corner }} uri={square} />
      </View>
    );
  }
  if (!VideoView || !useVideoPlayer) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <ClipVideo uri={square} size={size} corner={corner} />
    </View>
  );
}

/** Full-screen clip behind everything, like the animated image background. */
export function AnimatedArtworkBackground({ square, fallbackUri, frame, enabled }: { square: string | null | undefined; fallbackUri?: string; frame?: { width: number; height: number }; enabled?: boolean }) {
  const screen = useWindowDimensions();
  const { width, height } = frame ?? screen;
  const poster = <Cover uri={fallbackUri} size={width} style={{ height, borderRadius: 0 }} contentFit="cover" autoplay={false} />;
  // Only iOS offers the switch (see the Player settings).
  const videoOn = useSettings((s) => s.animatedCoverVideo || Platform.OS !== 'ios');
  const bg = useIsBackground();
  const motionAllowed = useArtworkMotionAllowed();
  if (!(enabled ?? videoOn) || !square || bg || !motionAllowed) return null;
  if (Platform.OS === 'ios') {
    if (!CoverClipNativeView) return null;
    const CCV = CoverClipNativeView;
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {poster}
        <CCV style={StyleSheet.absoluteFill} uri={square} />
      </View>
    );
  }
  if (!VideoView || !useVideoPlayer) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {poster}
      <BackgroundClip uri={square} fit={frame ? 'contain' : 'cover'} />
    </View>
  );
}

function BackgroundClip({ uri, fit }: { uri: string; fit: 'contain' | 'cover' }) {
  const player = useClipPlayer(uri);
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    opacity.setValue(0);
    const sub = player.addListener('statusChange', ({ status }: { status: string }) => {
      if (status === 'error') {
        opacity.stopAnimation();
        opacity.setValue(0);
      }
    });
    return () => sub.remove();
  }, [uri, player, opacity]);
  if (!VideoView) return null;
  const VV = VideoView;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
    <VV
      style={StyleSheet.absoluteFill}
      surfaceType="textureView"
      onFirstFrameRender={() => Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }).start()}
      player={player}
      contentFit={fit}
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
    </Animated.View>
  );
}
