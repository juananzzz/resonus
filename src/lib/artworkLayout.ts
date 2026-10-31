export type AnimatedArtworkMode = 'cover' | 'background' | 'fullBleed';

export function isAnimatedArtworkMode(value: unknown): value is AnimatedArtworkMode {
  return value === 'cover' || value === 'background' || value === 'fullBleed';
}

/** Preserve the effective layout of both upstream and earlier local settings. */
export function savedAnimatedArtworkMode(saved: {
  animatedArtworkMode?: unknown; animatedCoverBackground?: unknown; playerFullBleed?: unknown;
}): AnimatedArtworkMode | undefined {
  if (isAnimatedArtworkMode(saved.animatedArtworkMode)) return saved.animatedArtworkMode;
  if (saved.animatedArtworkMode !== undefined) return undefined;
  if (saved.playerFullBleed === true) return 'fullBleed';
  if (typeof saved.animatedCoverBackground === 'boolean') return saved.animatedCoverBackground ? 'background' : 'cover';
  if (saved.playerFullBleed === false) return 'cover';
  return undefined;
}

/** Motion owns its layout; the independent still-cover switch cannot override it. */
export function playerArtworkLayout({ motionMode, hasMotion, staticFullBleed, hasCover, landscape }: {
  motionMode: AnimatedArtworkMode; hasMotion: boolean; staticFullBleed: boolean; hasCover: boolean; landscape: boolean;
}): AnimatedArtworkMode {
  if (!hasCover) return 'cover';
  if (hasMotion) return motionMode === 'fullBleed' && landscape ? 'cover' : motionMode;
  return staticFullBleed && !landscape ? 'fullBleed' : 'cover';
}
