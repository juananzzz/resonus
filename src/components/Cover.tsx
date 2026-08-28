/** Square cover art with placeholder when no image. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AppState, View, type StyleProp, type ViewStyle } from 'react-native';

import { CACHED_COVER, COVER } from '@/api/data';
import { bump } from '@/lib/perfLog';
import { colors, radius } from '@/theme';

interface Props {
  uri?: string;
  size: number;
  rounded?: boolean;
  /** Fade when loading/switching the image (ms). 0 for instant changes. */
  transition?: number;
  /** Placeholder icon when no image (e.g. radio). */
  placeholderIcon?: keyof typeof Ionicons.glyphMap;
  /**
   * How the artwork fills its square. Defaults to `cover` (fills and crops),
   * which is what every list, card and grid wants. The player can ask for
   * `contain` so non-square artwork is shown whole, letterboxed.
   */
  contentFit?: ImageContentFit;
  /**
   * Whether animated images (GIF, animated WebP) should auto-play. Disabling
   * this on off-screen or blurred copies avoids running multiple decoders for
   * the same animation, which would cause frame drops.
   */
  autoplay?: boolean;
  style?: StyleProp<ViewStyle | ImageStyle>;
  /**
   * Called once the picture has loaded, with the `uri` it was asked for and
   * whether the decoder found it animated. The player reads it to move an
   * animated cover to the background (see `useAnimatedCover`); the `uri` comes
   * back with it because by then the song may have changed.
   */
  onAnimatedDetected?: (uri: string, isAnimated: boolean) => void;
}

/**
 * Sizes to look for a marked cover at, and there are more of them than the app
 * asks for on purpose.
 *
 * The same picture at a different size is a different URL and so a different
 * entry in the image loader's cache. The first three are what the app asks for
 * now (see `COVER`); the rest are what older versions asked for, and the cache
 * on somebody's phone was filled by those. Dropping them from this list is what
 * made covers disappear offline after an update: the pictures were still there,
 * under names we had stopped saying.
 *
 * The size asked for is tried on its own first, and the rest only on a miss and
 * all at once, so the length of this list costs one round trip, not six.
 */
const CACHE_SIZES = [COVER.card, COVER.full, COVER.thumb, 500, 300, 100] as const;

/**
 * What each marked cover was found to be, so a lookup is done once.
 *
 * Every one of these is a call into the image loader, and a screen is thirty
 * rows: without this, a list asked a hundred and fifty times on the way in, and
 * again on the way back, and again for every row scrolling recycled. On a
 * fifteen thousand song library most of them miss, which is the expensive case.
 *
 * A hit is kept for good, since a file in the cache does not leave while the
 * app is running. A miss is kept for a minute: offline nothing new arrives, but
 * back online the mirror does save covers, and a miss remembered for ever would
 * hold a placeholder over one that is now there.
 */
const MISS_TTL = 60_000;
const memo = new Map<string, { path?: string; at: number }>();

async function cachedPath(url: string): Promise<string | undefined> {
  const seen = memo.get(url);
  if (seen && (seen.path || Date.now() - seen.at < MISS_TTL)) return seen.path;
  const sized = (n: number) => url.replace(/([?&](?:size|fillWidth|fillHeight)=)\d+/g, `$1${n}`);
  const look = async (candidate: string) => {
    const path = await Image.getCachePathAsync(candidate).catch(() => null);
    return path ? (path.startsWith('file://') ? path : `file://${path}`) : undefined;
  };
  // The size asked for first, on its own: that is the one that hits when the
  // cover was already seen at this size, and it costs one call. Only when it
  // misses are the other sizes worth asking for, and then all at once rather
  // than one after another, in the order that prefers scaling down to up.
  let found = await look(url);
  // Counted, because this is where the covers went missing twice already: once
  // when the sizes the app asks for changed under a cache filled by an older
  // one, and once when a picture was saved under a name the row never asks by.
  // "asked for" against "another size" against "missing" says which it is
  // without anybody having to guess from a screenshot.
  if (found) {
    bump('cover cache · asked for');
  } else {
    const others = await Promise.all(CACHE_SIZES.map((n) => look(sized(n))));
    found = others.find(Boolean);
    bump(found ? 'cover cache · another size' : 'cover cache · missing');
  }
  memo.set(url, { path: found, at: Date.now() });
  return found;
}

/**
 * Covers still waiting to draw the picture they were last given, so they can be
 * told to ask again when the app comes back.
 *
 * A load started while the app is away does not finish there: the image loader
 * is tied to the activity and holds its requests until it is on screen again.
 * That on its own would be harmless —the request would run on the way back—
 * except that the view has already written down which source it is loading, so
 * nothing on the way back looks like a change to it, and it goes on showing the
 * last picture it managed to draw. Playing a playlist with the player open and
 * the phone in a pocket, that is a cover from some song several tracks ago,
 * under the right title, until something makes the view load again.
 *
 * `reloadAsync` is that something, and it is the only thing that is: it asks
 * for the same source the view believes it already has, which a re-render by
 * itself will not do. One subscription for all of them, since a list on screen
 * is thirty of these and the answer to the question is the same for every one.
 */
const waiting = new Set<() => void>();
AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  for (const askAgain of [...waiting]) askAgain();
});

/**
 * Ties one `expo-image` view to the above: give it the view's `ref`, put the
 * `onDisplay` it hands back on the same view, and it will ask again for
 * anything it was given while the app was away and never got to draw.
 *
 * Exported because the player's blurred backdrop is an `Image` of its own,
 * outside this component and deliberately so (it keeps the previous artwork up
 * while the next one decodes, which is what stops a black frame between
 * songs), and it goes stale by exactly the same route.
 */
export function useRedrawOnReturn(
  ref: RefObject<Image | null>,
  shown: string | undefined,
): { nonce: number; onDisplay: () => void } {
  // Which picture the view has actually drawn, which is not the same question
  // as which one it was asked for.
  const drawn = useRef<string | undefined>(undefined);
  /**
   * Whether this view was handed a different picture while nobody was looking.
   *
   * Asking only when the view never reported drawing was not enough, and the
   * report is why: the covers here are files on the phone, so the loader
   * answers out there without a network and says it drew — and the screen still
   * comes back showing the picture before it. So what decides is not what the
   * view claims, it is whether the question changed while the app was away.
   * That is true of the player's cover and of nothing else on screen: a list
   * does not scroll in a pocket.
   */
  const changedWhileAway = useRef(false);
  useEffect(() => {
    if (AppState.currentState !== 'active') changedWhileAway.current = true;
  }, [shown]);
  /**
   * Bumped to build the view again: a fresh one remembers nothing — no source
   * it believes it has already loaded, no picture left over from before. It is
   * what leaving the player and opening it once more does, which is the one
   * thing the report confirms comes back right.
   *
   * It is used rather than merely asking the view to load again whenever the
   * picture changed out there, and the reason is that the view's own account
   * of itself cannot be checked from here. It already said it had drawn a
   * cover it was not showing, which is how the first attempt at this went
   * wrong; deciding whether asking had worked would mean believing the same
   * claim twice. The blink it costs falls inside the system's own animation
   * for opening the app, and it is one view, once, on the way back.
   */
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const askAgain = () => {
      if (!shown) return;
      const changed = changedWhileAway.current;
      changedWhileAway.current = false;
      // Counted three ways, because "it still happens" cannot say which of
      // these ran, and they want different fixes.
      if (changed) {
        bump('cover · rebuilt on return');
        setNonce((n) => n + 1);
      } else if (drawn.current !== shown) {
        // Never drew what it was given, and the picture is still the same one:
        // asking is enough here and does not blink.
        bump('cover · asked again on return');
        void ref.current?.reloadAsync().catch(() => {});
      } else {
        bump('cover · looked fine on return');
      }
    };
    waiting.add(askAgain);
    return () => {
      waiting.delete(askAgain);
    };
  }, [ref, shown]);
  // Fired when a picture is put on screen, and only for the real source: a
  // placeholder is not an answer to the question above.
  const onDisplay = useCallback(() => {
    drawn.current = shown;
  }, [shown]);
  return { nonce, onDisplay };
}

/**
 * How long a source is given to appear before the next one is let through.
 *
 * The wait below ends when the picture is drawn, and one that has to be fetched
 * can be a while — that part is fine and is the whole point. This is for the
 * one that never arrives at all: a cover that is neither on the phone nor
 * reachable, or a load the system is sitting on because the app is in the
 * background. Without a cap those would hold the queue for good and leave the
 * view a song behind.
 */
const SETTLE_CAP = 4000;

/**
 * Hands an `expo-image` view one source at a time, holding the next one back
 * until the fade into the current one has finished.
 *
 * expo-image crossfades between two views of its own, and it chooses which one
 * to draw into by asking whether the other still holds a picture. Halfway
 * through a fade both of them do, so a source arriving there is written into
 * the view that is fading IN: the picture it was carrying is dropped without
 * ever being seen, the one underneath is snapped back to full opacity, and the
 * new fade starts from that. The view it reuses is also the one whose fade-out
 * was about to clear it, and that clearing still runs, so some of those land on
 * an empty view instead.
 *
 * On the player's backdrop, which is a full-screen blurred cover with a long
 * fade, that is what skipping through a queue looks like: the background jumps
 * back to the cover you started from, or flashes to nothing, before settling on
 * the one you stopped at.
 *
 * So the target is kept here and only handed over once nothing is in flight. At
 * worst the view is one picture behind for a moment and then catches up in a
 * single clean fade, which is the right thing to look at while somebody is
 * still skipping.
 */
export function useSettledSource(
  uri: string | undefined,
  fade: number,
): { shown: string | undefined; onDisplay: () => void } {
  const [shown, setShown] = useState(uri);
  /** Bumped when a fade is over, to run the effect below again. */
  const [settled, setSettled] = useState(0);
  const fading = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fading.current = false;
      setSettled((n) => n + 1);
    }, ms);
  }, []);
  useEffect(() => {
    if (fading.current || uri === shown) return;
    setShown(uri);
    // Nothing to fade into and nothing to wait for. A song with no artwork
    // between two that have some would otherwise hold the next cover back for
    // the whole cap: no picture is ever drawn for an empty source, so the only
    // thing that could end the wait is the cap itself.
    if (!uri) return;
    fading.current = true;
    release(SETTLE_CAP);
  }, [uri, shown, settled, release]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /**
   * Coming back from the background, where the timers above do not run (see the
   * player's cover) and a load does not finish either. Whatever was in flight
   * when the app went away is not going to report now, so the wait is dropped
   * and the current source goes in — which is also when it matters most, the
   * song having moved on several times in a pocket.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && fading.current) release(0);
    });
    return () => sub.remove();
  }, [release]);
  // The fade starts when the picture goes up, not when the source is set.
  const onDisplay = useCallback(() => {
    if (fading.current) release(fade);
  }, [fade, release]);
  return { shown, onDisplay };
}

export function Cover({
  uri,
  size,
  rounded,
  transition = 200,
  placeholderIcon = 'musical-notes',
  contentFit = 'cover',
  autoplay = true,
  style,
  onAnimatedDetected,
}: Props) {
  // If the image fails to load (e.g. offline without cache or download), we fall
  // back to the placeholder instead of leaving a gap. Reset on `uri` change
  // because lists recycle the same instance with a different song.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  // Offline, a cover that is not downloaded arrives marked (see `CACHED_COVER`
  // in the data layer): it may be shown, but only if it is already in the image
  // cache from when it was seen online, and never fetched. This is the only
  // place that knows how to read the mark, and asking the cache is the only way
  // it can be read, so a playlist or a favourite whose cover was never seen
  // simply keeps its placeholder.
  const cacheOnly = uri?.startsWith(CACHED_COVER) ?? false;
  /**
   * What was looked up, and for which `uri`. Both halves matter: the answer on
   * its own outlives the question. This held the path alone and only wrote it
   * down on a hit, so the same instance moving to a cover that is NOT on the
   * phone — a list recycling a row, the player moving to the next song — kept
   * painting the picture resolved for the song before it. The right title over
   * somebody else's artwork, and it stayed that way until a cover that did
   * resolve came along. Keeping the question next to the answer means a stale
   * pair is simply not used, whether it lost by a miss or by still being in
   * flight.
   */
  const [cached, setCached] = useState<{ uri: string; path?: string } | undefined>(undefined);
  useEffect(() => {
    if (!uri || !uri.startsWith(CACHED_COVER)) return;
    let alive = true;
    void cachedPath(uri.slice(CACHED_COVER.length)).then((path) => {
      if (alive) setCached({ uri, path });
    });
    return () => {
      alive = false;
    };
  }, [uri]);
  const shown = cacheOnly ? (cached && cached.uri === uri ? cached.path : undefined) : uri;
  const imageRef = useRef<Image>(null);
  const redraw = useRedrawOnReturn(imageRef, shown);
  // One corner for every cover, whatever its size. Letting it climb with the
  // picture was tried and reverted: at the top of the scale the corner eats
  // into the artwork, and a sleeve is somebody else's rectangle to crop.
  // Small covers (≤56 px) sit inside the mini-player container whose own
  // radius is radius.md with spacing.sm padding; radius.sm (6) nests
  // visually without looking square or eating into the art.
  const borderRadius = rounded
    ? radius.pill
    : size <= 56
      ? radius.sm
      : radius.md;
  if (!shown || failed) {
    return (
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius,
            backgroundColor: colors.surfaceHighlight,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style as StyleProp<ViewStyle>,
        ]}
      >
        {/* The icon carries the whole placeholder: its background is the same
            grey as a Home tile or a sheet, so on those it is the icon or
            nothing, and dimmer than this it read as a picture that had failed
            rather than one that was never there. */}
        <Ionicons name={placeholderIcon} size={size * 0.4} color={colors.textSecondary} />
      </View>
    );
  }
  return (
    <Image
      key={redraw.nonce}
      ref={imageRef}
      source={{ uri: shown }}
      style={[{ width: size, height: size, borderRadius }, style as StyleProp<ImageStyle>]}
      contentFit={contentFit}
      transition={transition}
      recyclingKey={shown}
      autoplay={autoplay}
      onDisplay={redraw.onDisplay}
      onLoad={(e) => {
        if (onAnimatedDetected && uri) onAnimatedDetected(uri, !!e.source?.isAnimated);
      }}
      // expo-image defaults to 'disk', which keeps the file but not the decoded
      // image: scrolling a list back up decoded every cover again. Covers are
      // small and the same handful come round constantly, which is what a
      // memory cache is for.
      cachePolicy="memory-disk"
      onError={() => setFailed(true)}
    />
  );
}
