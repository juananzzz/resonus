/** Full-screen player (modal): cover art, progress and controls. */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { COVER, songCoverUrl, type Song } from '@/api/data';
import { ArtistPlayerCard } from '@/components/ArtistPlayerCard';
import { AudioQualityBadge } from '@/components/AudioQualityBadge';
import { Cover, useRedrawOnReturn, useSettledSource } from '@/components/Cover';
import { ExplicitBadge } from '@/components/ExplicitBadge';
import { FavoriteButton } from '@/components/FavoriteButton';
import { CoverLyrics, LyricsCard } from '@/components/LyricsCard';
import { MarqueeText } from '@/components/MarqueeText';
import { OutputSheet } from '@/components/OutputSheet';
import { SpeedSheet } from '@/components/SpeedSheet';
import { StarRating } from '@/components/StarRating';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useLyrics } from '@/hooks/useLyrics';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { artistTargets } from '@/lib/artistNav';
import { formatDuration, formatGroupedDeviceLabel } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { localHttpAvailable } from '@/lib/localHttp';
import { pushOnce } from '@/lib/pushOnce';
import { useArtistPicker } from '@/store/artistPicker';
import { useAuthStore } from '@/store/auth';
import { useJukebox } from '@/store/jukebox';
import {
  currentSong,
  mixSeedOf,
  playingQueued,
  SOURCE_FAVORITES,
  SOURCE_HISTORY,
  useLiveInfo,
  usePlayerStore,
} from '@/store/player';
import { useSettings } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { useToast } from '@/store/toast';
import { useUpnp } from '@/store/upnp';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';

/** Floor: below this the cover stops giving up space and the page scrolls. */
const COVER_MIN = 200;
/**
 * Share of the spare height that goes ABOVE the cover; the rest falls below it,
 * between the artwork and the info block. With few options enabled there is a
 * lot of spare height and it has to go somewhere: piling it all on one side
 * left an obvious hole there, so it gets split. Slightly under half so the
 * cover sits a touch high, which reads better than dead centre.
 */
const COVER_TOP_SHARE = 0.4;
/** How far a finger has to travel across the cover to count as a skip. */
const SWIPE_SHARE = 0.25;
const DISMISS_THRESHOLD = 120;
/**
 * What the player measured last time it was open, so the next one can draw the
 * cover at its final size instead of waiting a layout pass for it (#155). None
 * of it belongs to the song; `for` is the screen height it does belong to, and
 * on another one it would size the page for a screen nobody is on (#131).
 */
let lastLayout: {
  for: number;
  pageH: number;
  coverH: number;
  coverW: number;
  starsH: number;
} | null = null;
// How much of the lyrics card peeks below the first page (invites swipe).
const LYRICS_PEEK = 58;
/**
 * Crossfade between one blurred backdrop and the next. Long on purpose: the
 * background changing is not an event, it is the room's light following the
 * song. Nothing is ever asked to fade while this one is still running (see
 * `useSettledSource`).
 */
const BACKDROP_FADE = 600;

function CircleButton({
  name,
  label,
  onPress,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: (e: GestureResponderEvent) => void;
}) {
  return (
    <Pressable
      style={styles.circle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Ionicons name={name} size={22} color={colors.text} />
    </Pressable>
  );
}

/**
 * Position and opacity of a carousel panel (recycled).
 *
 * The 3 panels form an infinite strip: panel `k` is placed at the nearest
 * multiple of 3 screens to the center, so it always stays ≤1.5 screens away
 * and the jump from one end to the other happens off-screen. Everything is
 * calculated on the UI thread from `offset` (which accumulates, never resets),
 * so committing a swipe doesn't move any visible panel: the one that was the
 * neighbor stays centered and only the hidden panel's content changes.
 */
function usePaneStyle(offset: SharedValue<number>, k: number, step: SharedValue<number>) {
  return useAnimatedStyle(() => {
    // A screen's width, and it is a shared value rather than a constant
    // because the screen can be turned while the player is open: read once,
    // the strip would keep parking its neighbours a portrait width away (#131).
    const w = step.value;
    const m = k + 3 * Math.round((-offset.value / w - k) / 3);
    const x = m * w + offset.value;
    return {
      transform: [{ translateX: x }],
      opacity: interpolate(Math.abs(x), [0, w * 0.6], [1, 0.4], Extrapolation.CLAMP),
    };
  });
}

/**
 * Slider and times, kept apart on purpose.
 *
 * `positionSec` moves twice a second while music plays, and this screen is one
 * large component: cover, gradient, quality badge, controls, queue sheet. It
 * was repainting all of it on every tick, which is the one thing the mini
 * player has always been careful not to do (#50). The seek buttons read the
 * position when they are pressed instead of subscribing to it.
 */
function PlayerProgress({
  duration,
  onSeek,
}: {
  duration: number;
  onSeek: (sec: number) => void;
}) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const dragging = useRef(false);
  const dragValue = useRef(positionSec);
  const [, forceUpdate] = useState(0);
  return (
    <View style={styles.progress}>
      <Slider
        style={[styles.slider, { height: 24, marginHorizontal: 0 }]}
        thumbSize={12}
        minimumValue={0}
        maximumValue={duration}
        value={dragging.current ? dragValue.current : positionSec}
        onSlidingStart={() => { dragging.current = true; }}
        onValueChange={(v) => { dragValue.current = v; }}
        onSlidingComplete={(v) => { dragging.current = false; forceUpdate((n) => n + 1); onSeek(v); }}
        minimumTrackTintColor={colors.text}
        maximumTrackTintColor={colors.mediaTrack}
        thumbTintColor={colors.text}
      />
      <View style={styles.times}>
        <Text style={styles.time}>{formatDuration(positionSec)}</Text>
        <Text style={styles.time}>{formatDuration(duration)}</Text>
      </View>
    </View>
  );
}

export default function PlayerScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  useSettings((s) => s.appFont); // re-render when font changes
  const router = useRouter();
  const isFocused = useIsFocused();
  const song = usePlayerStore(currentSong);
  const live = useLiveInfo(song);
  const source = usePlayerStore((s) => s.source);
  const sourceHref = usePlayerStore((s) => s.sourceHref);
  // Set once playback crosses into what autoplay added on its own: from there
  // the album or the playlist the queue started as is not what is playing.
  const mixSeed = usePlayerStore(mixSeedOf);
  // Set only while what plays is a song someone added to the queue by hand.
  const queuedNow = usePlayerStore(playingQueued);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const rateSong = usePlayerStore((s) => s.rateSong);
  const speed = usePlayerStore((s) => s.speed);
  const openMenu = useSongMenu((s) => s.open);
  const openArtistPicker = useArtistPicker((s) => s.open);
  const t = useT();
  const showQualityBadge = useSettings((s) => s.showAudioQuality);
  const showRating = useSettings((s) => s.showRating);
  const showAlbumInfo = useSettings((s) => s.showAlbumInfo);
  const showLyricsCard = useSettings((s) => s.showLyricsCard);
  // Ignored on a local profile over a server: there is no heart there, so there
  // is nothing to swap and moving the ⋯ down would just leave the corner empty.
  const swapButtons = useSettings((s) => s.swapPlayerButtons);
  // Only the player honours this: in lists and grids letterboxing every cover
  // would leave each row a different size and look ragged.
  const fitCoverArt = useSettings((s) => s.fitCoverArt);
  const coverTapAction = useSettings((s) => s.coverTapAction);
  const marqueeTitles = useSettings((s) => s.marqueeTitles);
  const showQueueButton = useSettings((s) => s.showQueueButton);
  const local = useLocalProfile();
  // The local profile can cast now that the phone serves its own files
  // (`lib/localHttp`), so the only reason left to hide the button there is a
  // build without the native module behind it.
  const showDevicesButton =
    useSettings((s) => s.showDevicesButton) && (!local || localHttpAvailable);
  const showSpeedButton = useSettings((s) => s.showSpeedButton);
  const seekButtonsSec = useSettings((s) => s.seekButtonsSec);
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const hasAccount = useAuthStore((s) => !!s.auth);
  const upnpDevices = useUpnp((s) => s.devices);
  const upnpConnectedDevice = useUpnp((s) =>
    s.connected ? s.devices.find((device) => device.id === s.deviceId) ?? null : null,
  );
  const upnpDevice = useMemo(() => {
    if (!upnpConnectedDevice) return null;
    if (!upnpConnectedDevice.isSonos) return upnpConnectedDevice.name;
    const groupKey = upnpConnectedDevice.groupId ?? upnpConnectedDevice.id;
    const groupName = formatGroupedDeviceLabel(
      upnpDevices
        .filter((device) => device.isSonos && (device.groupId ?? device.id) === groupKey)
        .map((device) => device.name),
    );
    if (groupName) return groupName;
    return upnpConnectedDevice.name;
  }, [upnpConnectedDevice, upnpDevices]);
  const jukeboxActive = useJukebox((s) => s.active);
  const remoteDevice = upnpDevice ?? (jukeboxActive ? t('Server speakers (Jukebox)') : null);
  const [outputOpen, setOutputOpen] = useState(false);
  // The speed sheet holds its own visibility (see `SheetModal`): opening it
  // repaints the modal and not this screen, which is the whole reason the
  // player's other menus are built this way.
  const openSpeedSheet = useRef<() => void>(() => {});
  // With local lyrics (.lrc/USLT/LRCLIB) offline mode also has lyrics;
  // only radio (direct url) is excluded. Hiding the card (setting) doesn't
  // disable lyrics: tapping cover art still opens the full screen.
  const canLyrics = !song?.url;
  // Stars (setRating) are a Subsonic thing: enabled in Settings and require
  // a non-Jellyfin server account; not applicable to radio (direct url) or
  // the local profile (no account). Offline queues and uploads on reconnect.
  // Read up here because the slot's measurements depend on whether this row
  // exists, and those are settled before the screen is shown.
  const canRate = showRating && hasAccount && serverType !== 'jellyfin' && !song?.url;
  // Whether the lyrics card is wanted for this song at all: a setting, and not
  // a radio. Whether it is actually shown is `showsLyricsCard` below, which
  // also needs there to be lyrics.
  const wantsLyricsCard = canLyrics && showLyricsCard;
  /**
   * The heart's state, and it does not ask whether the file is on the phone.
   *
   * That question used to be in here as `!song.localUri || offline`, and it is
   * not the same one: `markUnplayableOffline` stamps `localUri` onto every
   * downloaded song in a list built offline, so a server song wears the mark
   * too, and the queue is saved with it on. Once the network is back the mark
   * stays and `offline` does not, and this went quiet against a song that has a
   * server and a starred list like any other — leaving the heart on whatever
   * `song.starred` said whenever the queue happened to be recorded.
   *
   * Where to fetch a starred list from at all is the hook's own question (it
   * takes the local profile's), so all that is left to ask here is whether
   * there is a song.
   */
  const favIds = useFavoriteIds(!!song);

  // The data layer resolves the cover: from the server (online) or from the
  // local index by album (offline). Base64 is no longer stored per song.
  // A radio has no album, but the station may carry its own image (the server
  // holds it, so it's the same one every client shows).
  const coverOf = (s?: Song | null) =>
    s ? songCoverUrl(s, COVER.card) : undefined;
  const cover = coverOf(song);
  // Spotify-style background: gradient from the cover's dominant color
  // (toggle in Settings → Theme). The color transitions smoothly on song
  // change: a flat color is animated and the gradient toward the background is
  // a fixed overlay (same look as animating the gradient, which can't be done).
  const background = useSettings((s) => s.playerBackground);
  const colorBackground = background === 'color';
  // The backdrop holds the previous artwork on purpose while the next decodes,
  // so on its own it cannot tell "not decoded yet" from "never will be". Coming
  // back from the background is the second case (see `useRedrawOnReturn`), and
  // here it would be the whole screen wearing another song's colours.
  const backdropRef = useRef<Image>(null);
  // One cover at a time, and never mid-fade: skipping through a queue is faster
  // than the fade is long, and handing them over as they come is what made the
  // background jump back to the cover you started from.
  const backdropSource = useSettledSource(
    background === 'cover' ? cover : undefined,
    BACKDROP_FADE,
  );
  const backdrop = useRedrawOnReturn(backdropRef, backdropSource.shown);
  const dominant = useDominantColor(colorBackground ? cover : undefined);
  // Under the blurred artwork the flat colour is irrelevant, but it still
  // paints the frame before the image decodes, so it stays dark rather than
  // flashing the old grey.
  const targetBg = colorBackground ? dominant : background === 'cover' ? colors.background : colors.playerPlain;
  const bgColor = useSharedValue(targetBg);
  useEffect(() => {
    // reduceMotion Never: the color fade is part of the look and some devices
    // (battery saver / "reduce motion") would skip it.
    bgColor.value = withTiming(targetBg, { duration: 600, reduceMotion: ReduceMotion.Never });
  }, [targetBg, bgColor]);
  const bgStyle = useAnimatedStyle(() => ({ backgroundColor: bgColor.value }));
  // Same query used by the lyrics card (cached): here only to know if there
  // are lyrics and let the card peek below the first page.
  const { data: lyrics } = useLyrics(canLyrics ? (song ?? undefined) : undefined);
  // The only reason this screen scrolls at all: the room left under the first
  // page and the card itself both read this, and they must stay in step or the
  // player can be dragged for no reason (#107). What does NOT read it is the
  // room kept for the peek, which is `wantsLyricsCard`: see the first page's
  // height below.
  const showsLyricsCard = wantsLyricsCard && !!lyrics;

  // The player is scrollable (like Spotify): the first "page" fills the
  // screen and the lyrics card peeks below. The real height comes from the
  // ScrollView's onLayout, or from the open before this one (`lastLayout`).
  // Only on the very first open of a run is there nothing to go on, and then
  // it is approximated from the safe-area inset: the top one only, since the
  // ScrollView runs to the bottom edge of the screen so the lyrics card does
  // too, and it is the controls that keep clear of the navigation bar (see
  // `styles.bottom` below).
  const insets = useSafeAreaInsets();
  // Measured as it draws, so turning the phone while the player is open lays
  // it out for the screen it is on now (#131).
  const { width: screenW, height: screenH, landscape } = useScreenSize();
  const approxPageH = screenH - insets.top;
  /** What the open before this one measured, if it was on this screen. */
  const remembered = lastLayout?.for === screenH ? lastLayout : null;
  const [pageH, setPageH] = useState(remembered?.pageH ?? 0);
  /**
   * Height left over for the cover once everything else has taken its share.
   * The cover is the ONLY elastic piece of the player: the title, the optional
   * rows (rating, album, quality badge) and the controls all have a fixed
   * height, so with every option enabled they stopped fitting. `coverWrap` is
   * `flex: 1`, so this measurement already discounts whatever is above and
   * below it — including any row added in the future, with no constants to
   * keep in sync.
   */
  const [coverBoxH, setCoverBoxH] = useState(remembered?.coverH ?? 0);
  /** And how wide it is, which stops being the screen the moment the cover and
   *  the controls sit side by side. */
  const [coverBoxW, setCoverBoxW] = useState(remembered?.coverW ?? 0);
  /** Height of the rating row, measured so it can be subtracted from the slot. */
  const [starsH, setStarsH] = useState(remembered?.starsH ?? 0);
  /** The layout has run, so the numbers above are measured and not remembered.
   *  What is remembered may be wrong, and the cover must not be seen correcting
   *  itself: that is the jump. */
  const [laidOut, setLaidOut] = useState(false);
  // Another screen under an open player: what was measured describes the old
  // one, so it goes and the page falls back to the estimate.
  useEffect(() => {
    if (lastLayout?.for === screenH) return;
    setPageH(0);
    setCoverBoxH(0);
    setCoverBoxW(0);
    setStarsH(0);
  }, [screenH]);
  // The cover's size and vertical offset both come from the measured slot
  // (`coverBoxH`) and the page height (`pageH`), neither known on the first
  // paint. Rendered eagerly, the cover flashes full-width pinned to the top and
  // then resizes/drops into place once measured — the visible "jump" on open.
  // Keep it hidden until the slot has been measured UNDER THE REAL page height
  // (not the first-paint approximation): revealing on the approximate measure
  // makes the cover settle a few px on screen on a fast reopen. We flip `stable`
  // from the cover slot's onLayout once the ScrollView's real height is known
  // (or right away if the approximation already matched it); a timeout is a
  // safety net so the cover can never stay hidden if the callbacks don't line up.
  const [coverStable, setCoverStable] = useState(false);
  const coverAppear = useSharedValue(0);
  /** The numbers this open started with, to know later whether they held. */
  const startedWith = useRef(remembered);
  /** So the reveal below happens once, whatever moves after it. */
  const revealed = useRef(false);
  useEffect(() => {
    if (!coverStable || revealed.current) return;
    revealed.current = true;
    // Confirmed what it was drawn at: nothing to reveal, so no fade. The fade
    // is for a size nobody has seen yet.
    const g = startedWith.current;
    const asRemembered =
      !!g && g.pageH === pageH && g.coverH === coverBoxH && g.coverW === coverBoxW && g.starsH === starsH;
    if (asRemembered) coverAppear.set(1);
    else coverAppear.value = withTiming(1, { duration: 200, reduceMotion: ReduceMotion.Never });
  }, [coverStable, pageH, coverBoxH, coverBoxW, starsH, coverAppear]);
  useEffect(() => {
    const id = setTimeout(() => setCoverStable(true), 300);
    /**
     * A timer is no safety net while the app is away: React Native stops
     * firing them in the background, and no layout happens there either, so a
     * player mounted on the way out had nothing left to reveal it. It came
     * back with the artwork at zero opacity and stayed that way, through track
     * changes and all, until the screen was closed and opened again, which
     * mounts it afresh (reported by @ztx-lyghters).
     *
     * Coming back to the foreground is the other moment worth revealing at. By
     * then the measurements this waits for have either happened or are about
     * to, and the jump it exists to prevent belongs to opening the screen, not
     * to returning to an app that was already showing it.
     */
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setCoverStable(true);
    });
    return () => {
      clearTimeout(id);
      sub.remove();
    };
  }, []);
  /**
   * Everything the slot is made of has to be known before any of it is shown,
   * and there are two measurements, not one. The page's real height is the
   * obvious one. The other is the rating row, which starts at zero and is
   * subtracted from the cover: until it has been measured the cover is drawn a
   * row too tall and then shrinks, and the stars under it move up by the
   * difference. That is the jump, and it happens on every open with the rating
   * on, whatever the page height turns out to be.
   */
  useEffect(() => {
    if (laidOut && pageH > 0 && coverBoxH > 0 && (!canRate || starsH > 0)) setCoverStable(true);
  }, [laidOut, pageH, coverBoxH, starsH, canRate]);
  /** Kept for the next open, and only whole: half a layout is a memory that
   *  draws the next one wrong. */
  useEffect(() => {
    if (!laidOut || pageH <= 0 || coverBoxH <= 0 || coverBoxW <= 0) return;
    if (canRate && starsH <= 0) return;
    lastLayout = { for: screenH, pageH, coverH: coverBoxH, coverW: coverBoxW, starsH };
  }, [laidOut, screenH, pageH, coverBoxH, coverBoxW, starsH, canRate]);
  /**
   * Coming back to the player from the queue or the lyrics screen, which open
   * on top of it as native modals. The player is not unmounted there, so
   * everything it had worked out is still worked out — but Android detaches the
   * screen under a modal, and what came back was a player with no artwork in it
   * and swipes that seemed to do nothing, because the covers were being dragged
   * around invisible. Written straight, with no fade: this cover was already on
   * screen before leaving, so there is nothing to reveal, only to re-assert.
   * The first focus is the screen opening and belongs to the reveal above.
   */
  const wasFocused = useRef(false);
  const wasBlurred = useRef(false);
  useEffect(() => {
    if (!isFocused) {
      // Only after the screen has been focused once: the first focus is this
      // one opening, whenever it arrives, and revealing there would skip the
      // wait that keeps the cover from settling into place.
      if (wasFocused.current) wasBlurred.current = true;
      return;
    }
    const returning = wasFocused.current && wasBlurred.current;
    wasFocused.current = true;
    wasBlurred.current = false;
    if (!returning) return;
    setCoverStable(true);
    coverAppear.set(1);
  }, [isFocused, coverAppear]);
  const coverAppearStyle = useAnimatedStyle(() => ({ opacity: coverAppear.value }));
  // The swipe-to-close gesture should only work when scrolled to the top;
  // otherwise it would steal the gesture when returning from the lyrics card.
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);

  // Cover art swipe: left → next, right → previous. It mirrors the prev/next
  // buttons, which don't wrap: you can't go back before the first track, and
  // forward stops at the last one — except with repeat 'all', which wraps
  // forward (same rule as `nextIndex` in the store). Wrapping backwards was
  // especially bad with autoplay on: from the first track it jumped to the last
  // (a freshly autoplay-added one), stranding the user far from the start (#35).
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const index = usePlayerStore((s) => s.index);
  const queueLen = usePlayerStore((s) => s.queue.length);
  const canPrev = queueLen > 1 && index > 0;
  const canNext = queueLen > 1 && (index < queueLen - 1 || repeat === 'all');
  // Neighbors in the queue, so the carousel can show them when dragging. Absent
  // at the edges (no wrap), so there's nothing to drag toward past the ends.
  // Stable references: only re-renders if the song changes.
  const prevSong = usePlayerStore((s) =>
    s.queue.length > 1 && s.index > 0 ? s.queue[s.index - 1] : undefined,
  );
  const nextSong = usePlayerStore((s) => {
    if (s.queue.length <= 1) return undefined;
    if (s.index < s.queue.length - 1) return s.queue[s.index + 1];
    return s.repeat === 'all' ? s.queue[0] : undefined;
  });
  const prevCover = coverOf(prevSong);
  const nextCover = coverOf(nextSong);
  /**
   * Net committed advances of the carousel: integer mirror of `-offset/W` at
   * rest. It is kept twice on purpose. `spins` is React's, because it decides
   * which song each panel shows; `spinsSV` is the gesture's, and the one all
   * the arithmetic uses.
   *
   * They are the same number, but not at the same time: a swipe reaches React
   * one render later, and a second swipe landing before that render measured
   * its travel from a count one behind. The strip then came to rest a screen
   * away from the song it was showing — the cover of the following track, on
   * every song from then on, while the title and the music were right.
   */
  const [spins, setSpins] = useState(0);
  const spinsSV = useSharedValue(0);
  const offset = useSharedValue(0);
  const dragBase = useSharedValue(0);
  /**
   * The width the strip of covers travels by, on the UI thread.
   *
   * `offset` counts in screens, so when the screen changes width the strip is
   * resting at a distance that no longer means what it meant: turning the
   * phone left the cover parked off to one side. Both are put back in step
   * here, which is instant and invisible because nothing is moving at the time.
   */
  const stepSV = useSharedValue(screenW);
  useEffect(() => {
    stepSV.value = screenW;
    offset.value = -spinsSV.value * screenW;
  }, [screenW, stepSV, offset, spinsSV]);
  /**
   * The strip travelled, so the song follows it. Where to is worked out here
   * and not in the gesture: `canNext` and `canPrev` are as old as the closure
   * that captured them, and counting an advance the queue can't make would
   * leave the strip off by a screen just the same. With nowhere to go, the
   * travel is given back instead.
   */
  const commitSwipe = (advance: 1 | -1) => {
    const { queue, index: i, repeat: r } = usePlayerStore.getState();
    const to =
      advance === 1
        ? i < queue.length - 1
          ? i + 1
          : r === 'all' && queue.length > 1
            ? 0
            : -1
        : i > 0
          ? i - 1
          : -1;
    if (to < 0) {
      spinsSV.value -= advance;
      offset.value = withSpring(-spinsSV.value * screenW, { damping: 20, stiffness: 200 });
      return;
    }
    setSpins((n) => n + advance);
    // A swipe across the cover is ⏭ with a finger, not picking a song out of a
    // list, and it is the very gesture #110 is about: stepping past a track in
    // the car without the room hearing it.
    jumpTo(to, 'skip');
  };
  const coverPan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onStart(() => {
      dragBase.value = offset.value;
    })
    .onUpdate((e) => {
      // Dragging right reveals the previous track, left reveals the next. Past
      // the first/last track there's nowhere to go: the drag gets friction and
      // is clamped so no (absent) neighbor panel can slide into view.
      const goingPrev = e.translationX > 0;
      const blocked = goingPrev ? !canPrev : !canNext;
      const raw = dragBase.value + (blocked ? e.translationX / 4 : e.translationX);
      const rest = spinsSV.value;
      const min = canNext ? -(rest + 1) * screenW : -rest * screenW;
      const max = canPrev ? -(rest - 1) * screenW : -rest * screenW;
      offset.value = Math.min(max, Math.max(min, raw));
    })
    .onEnd((e) => {
      const swipe = screenW * SWIPE_SHARE;
      const wantNext = canNext && (e.translationX < -swipe || e.velocityX < -600);
      const wantPrev = canPrev && (e.translationX > swipe || e.velocityX > 600);
      const advance = wantNext ? 1 : wantPrev ? -1 : 0;
      const base = spinsSV.value;
      const target = -(base + advance) * screenW;
      if (advance !== 0) {
        // The carousel finishes the travel with the neighbor centered; the
        // track changes at the end. If React lags, it's not noticeable: the
        // centered panel already shows the right cover and the swap happens
        // in the hidden panel.
        offset.value = withTiming(
          target,
          { duration: 220, easing: Easing.out(Easing.cubic) },
          (finished) => {
            // Counted where the strip actually arrived, and only if it did: a
            // travel cut short by the next swipe never happened.
            if (finished) {
              spinsSV.value = base + advance;
              scheduleOnRN(commitSwipe, advance as 1 | -1);
            }
          },
        );
      } else {
        offset.value = withSpring(target, { damping: 20, stiffness: 200 });
      }
    });
  // Cover tap shows lyrics (if any). Coexists with swipe: tap only wins if
  // there was no drag. `hasLyrics` is a boolean so it can be read from the
  // gesture's UI thread.
  const hasLyrics = !!lyrics;
  // What tap does based on setting: «inline» shows lyrics in place of the
  // cover (toggle), «screen» opens the full screen, «none» nothing.
  const [inlineLyrics, setInlineLyrics] = useState(false);
  // When the song changes, go back to the cover (each song is tapped separately).
  useEffect(() => {
    setInlineLyrics(false);
  }, [song?.id]);
  const openLyrics = () => {
    if (coverTapAction === 'inline') setInlineLyrics((v) => !v);
    else if (coverTapAction === 'screen') pushOnce('/lyrics');
  };
  const coverTap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((_e, success) => {
      if (success && hasLyrics) scheduleOnRN(openLyrics);
    });
  const coverGesture = Gesture.Race(coverPan, coverTap);
  const paneStyles = [
    usePaneStyle(offset, 0, stepSV),
    usePaneStyle(offset, 1, stepSV),
    usePaneStyle(offset, 2, stepSV),
  ];
  // Which song (current, next or previous) belongs to each panel based on
  // committed advances; same recycling formula as the UI position.
  const paneRel = (k: number) => k + 3 * Math.round((spins - k) / 3) - spins;

  // Swiping down closes the player (our own gesture: the native modal
  // doesn't support it on Android).
  const transY = useSharedValue(0);
  const closePlayer = () => router.back();
  const dismissPan = Gesture.Pan()
    .enabled(atTop)
    .activeOffsetY(15)
    .failOffsetX([-25, 25])
    .onUpdate((e) => {
      transY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_THRESHOLD || e.velocityY > 800) {
        transY.value = withTiming(screenH, { duration: 220 }, (f) => {
          if (f) scheduleOnRN(closePlayer);
        });
      } else {
        transY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });
  const rootStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: transY.value }],
  }));

  // If there's no song (e.g. after emptying the queue), close the player. In an
  // effect (not in render) to avoid updating the Stack while painting another
  // component, and only if the player is the visible screen: if the queue
  // screen is on top, let it show its empty state instead of closing it.
  useEffect(() => {
    if (!song && isFocused) router.back();
  }, [song, isFocused, router]);

  if (!song) return null;

  // The central list wins when loaded (refreshes when starred from any
  // screen); `song.starred` from the queue becomes stale, so it only serves
  // as a fallback for local songs or while loading.
  const favorited = favIds ? favIds.has(song.id) : !!song.starred;
  // What the header announces, most specific first (#65). A song added by hand
  // is the queue's own, so the queue is what it says, and only for as long as
  // that song plays. A mix that autoplay grew takes over next, since by then
  // the source underneath is the album that ran out. Otherwise it is the source
  // as before: a station says "Radio", the two sentinels are translated, and a
  // queue that never had a source (one recovered from the server) leaves
  // "NOW PLAYING" as it did.
  const sourceLabel = queuedNow
    ? t('Queue')
    : mixSeed
      ? t('Mix of “{name}”', { name: mixSeed.title })
      : !source
        ? null
        : song.url
          ? t('Radio')
          : source === SOURCE_FAVORITES
            ? t('Favorites')
            : source === SOURCE_HISTORY
              ? t('History')
              : source;
  // The header leads wherever it says it is playing from, so while it names the
  // queue it opens the queue. A mix is the one thing with nowhere to go: the
  // songs playing are not in that album, so it stops being a link until the
  // queue goes back into it.
  const canOpenSource = queuedNow || (!!sourceHref && !mixSeed);
  // Artist · Album · Year on a single line, but with two tap targets: the
  // artist name goes to the artist, and «Album · Year» to the album.
  // A radio announcing what it plays takes over both lines, same as it does
  // everywhere else. A stream that announces nothing leaves them as they were:
  // the station's name and "Radio".
  const title = live?.title ?? song.title;
  const artistName = live?.artist ?? song.artist ?? t('Unknown artist');
  // With the two lines above taken by the track, this one is all that is left to
  // say which station it is, so a radio puts its name here and does it whether
  // or not album info is on: this is not album info.
  const albumInfo = live
    ? song.title
    : showAlbumInfo
      ? [song.album, song.year].filter(Boolean).join(' · ')
      : '';
  // Square, capped at the width of the slot it sits in: it only shrinks when
  // the height demands it, so on a tall screen with few options it looks
  // exactly as it did before. The rating row shares the slot, so it comes off
  // the top first. Side by side the slot is half the screen, which is why the
  // cap is measured rather than taken from the screen (#131).
  const coverMax = (landscape ? screenW / 2 : screenW) - spacing.xl * 2;
  const coverSize = coverBoxH
    ? Math.max(COVER_MIN, Math.min(coverBoxW || coverMax, coverBoxH - (canRate ? starsH : 0)))
    : coverMax;
  // Left-over height once the cover and the stars have taken their share, split
  // between the two sides. Padding doesn't feed back into the measurement: the
  // slot's height comes from `flex: 1`, not from its contents.
  const coverSlack = Math.max(0, coverBoxH - coverSize - (canRate ? starsH : 0));
  const coverTopPad = Math.round(coverSlack * COVER_TOP_SHARE);
  const duration = durationSec || song.duration || 0;
  const repeatActive = repeat !== 'off';
  /**
   * The speed button, off by default and turned on in Settings › Player.
   *
   * It shows up uninvited in one case: a speed that is not 1. Somebody who
   * turns the button off while a record is playing at three quarters would
   * otherwise be left with no way back to normal, and nothing on screen saying
   * why the music sounds like that.
   *
   * Both cases still need the speed to be able to do anything: a station
   * arrives in real time and a renderer plays at its own pace, so there is
   * nothing to offer while either is what is playing.
   */
  const showSpeed = (showSpeedButton || speed !== 1) && !song.url && !remoteDevice;

  return (
    <GestureDetector gesture={dismissPan}>
      <Animated.View style={[styles.root, rootStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, bgStyle]} />
        {background === 'cover' && backdropSource.shown ? (
          <>
            {/* The artwork itself, blurred, filling the screen. No
                `recyclingKey`: it blanks the view the moment the song changes,
                which is what put a black frame between one cover and the next.
                Left alone, the previous one stays up until the new one has
                decoded and the transition dissolves between the two. */}
            <Image
              key={backdrop.nonce}
              ref={backdropRef}
              source={{ uri: backdropSource.shown }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              blurRadius={60}
              transition={BACKDROP_FADE}
              onDisplay={() => {
                backdrop.onDisplay();
                backdropSource.onDisplay();
              }}
            />
            {/* Wash: blurring alone doesn't guarantee contrast — a busy cover
                would swallow the text. It darkens under the dark appearance
                and lightens under the light one, since what has to survive it
                is the page's own text colour either way. */}
            <View style={styles.coverScrim} />
          </>
        ) : null}
        <LinearGradient
          colors={[colors.background + '00', colors.background] as const}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          style={{ flex: 1 }}
          // Keeps the lyrics card clear of the navigation bar, and only then:
          // with no card below it the first page is the whole content and it is
          // shorter than the screen, so this padding was pure overflow and the
          // player scrolled by that much for nothing (#107).
          contentContainerStyle={
            showsLyricsCard ? { paddingBottom: Math.max(insets.bottom, spacing.md) } : undefined
          }
          // Only the measurement. Whether the slot is ready to be shown is
          // decided in one place above, since it takes more than this one
          // number: revealing from here, as soon as the approximation turned
          // out to be right, is what let the stars appear before they had been
          // measured and then move.
          onLayout={(e) => {
            setPageH(e.nativeEvent.layout.height);
            setLaidOut(true);
          }}
          onScroll={(e) => {
            const next = e.nativeEvent.contentOffset.y <= 4;
            if (next !== atTopRef.current) {
              atTopRef.current = next;
              setAtTop(next);
            }
          }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
        <View
          style={{
            // The peek's room is kept for every song that could have lyrics, not
            // only for the ones that turn out to have them (`showsLyricsCard`).
            // Tying it to the actual lyrics moved the whole player: skipping
            // through a queue where some songs have lyrics and some don't, the
            // cover resized and the title, the slider and the controls slid up
            // and down a peek's worth on every track. Everything is at the same
            // height now, whoever is playing.
            //
            // The cost is the strip of empty background under a song with no
            // lyrics. That is the same trade as before, taken the other way: the
            // gap is quiet, the layout jumping on every skip is not. Only a radio
            // (no lyrics ever, `wantsLyricsCard` false) gets the room back.
            height: (pageH || approxPageH) - (wantsLyricsCard ? LYRICS_PEEK : 0),
          }}
        >
        <View style={styles.topBar}>
          <CircleButton name="chevron-down" label={t('Close')} onPress={() => router.back()} />
          <Pressable
            style={styles.topTitleWrap}
            disabled={!canOpenSource}
            accessibilityRole={canOpenSource ? 'button' : undefined}
            onPress={() => {
              if (!canOpenSource) return;
              // The queue goes on top of the player, like its own button does:
              // you are looking at where this song sits, not leaving for
              // another screen. Anywhere else replaces the player, since the
              // album or the playlist is somewhere to stay.
              if (queuedNow) {
                pushOnce('/queue');
                return;
              }
              router.back();
              router.navigate(sourceHref as never);
            }}
          >
            {sourceLabel ? (
              <>
                <Text style={styles.topLabel}>{t('PLAYING FROM')}</Text>
                <Text style={styles.topSource} numberOfLines={1}>
                  {sourceLabel}
                </Text>
              </>
            ) : (
              <Text style={styles.topTitle}>{t('NOW PLAYING')}</Text>
            )}
          </Pressable>
          {/* Both of these used to sit behind `song.localUri && !offline`, meant
              to read as "the phone's own library, which has no server to favourite
              against or open a menu on". It never read as that. `markUnplayableOffline`
              puts `localUri` on every downloaded song in a list built offline, so a
              server song carries it too and the queue is saved with it on; that is
              what the `&& !offline` was patched in for when the ⋯ went missing
              offline. What it left is the same thing the other way round: a queue
              built offline, the network back, `offline` false and the mark still
              there — and then the corner button and the one under the title both
              disappear, together, for as long as those songs are queued. Nothing
              takes the mark off, so closing the player and opening it again shows
              exactly the same thing.

              There is no condition left because there was never a real one: the
              phone's own library is a profile with no account, and that profile is
              always in offline mode (see `switchProfile`), so the old test could
              only ever be true about a song it was wrong about. */}
          {swapButtons ? (
            // Swapped: the heart takes the corner. It only reports state here —
            // tapping it still works, it's just the awkward spot to reach.
            <View style={styles.topFavorite}>
              <FavoriteButton id={song.id} starred={favorited} size={24} />
            </View>
          ) : (
            <CircleButton name="ellipsis-vertical" label={t('More options')} onPress={() => openMenu(song, undefined, { showLyrics: hasLyrics })} />
          )}
        </View>

        {/* Side by side once the screen is wider than it is tall: the cover
            takes the left and everything that is not the cover takes the
            right. Stacked, a phone lying on its side has some 330 points of
            height for a square picture AND a title AND a slider AND the
            controls, and what happens is that the controls go off the bottom
            of a page that cannot scroll. In portrait this is one more box
            around what was already a column, and nothing moves (#131). */}
        <View style={landscape ? styles.pageColumns : styles.pageStack}>
        <View
          style={[
            styles.coverWrap,
            landscape && styles.coverColumn,
            {
              paddingTop: coverTopPad,
              // Side by side the cover is the thing that reaches the bottom
              // edge, and the navigation bar is down there: in a column it was
              // the block of controls that kept clear of it for both.
              paddingBottom: landscape ? insets.bottom + spacing.md : 0,
            },
          ]}
          onLayout={(e) => {
            setCoverBoxH(e.nativeEvent.layout.height);
            setCoverBoxW(e.nativeEvent.layout.width - spacing.xl * 2);
            setLaidOut(true);
          }}
        >
          <GestureDetector gesture={coverGesture}>
            {/* Recycled carousel: the current cover centered and the neighbors at
                one screen, already entering on drag. No fade (transition 0): a
                panel's content only changes off-screen and a fade is pointless
                here. */}
            <Animated.View style={[{ width: coverSize, height: coverSize }, coverAppearStyle]}>
              {paneStyles.map((paneStyle, k) => {
                const rel = paneRel(k);
                const paneSong = rel === 0 ? song : rel === 1 ? nextSong : prevSong;
                const paneCover = rel === 0 ? cover : rel === 1 ? nextCover : prevCover;
                return (
                  <Animated.View key={k} style={[styles.coverPane, paneStyle]}>
                    {/* With lyrics in place the cover is hidden: the lyrics
                        (transparent background) sit on top of the player background. */}
                    {paneSong && !inlineLyrics ? (
                      <Cover
                        uri={paneCover}
                        size={coverSize}
                        contentFit={fitCoverArt ? 'contain' : 'cover'}
                        transition={0}
                        placeholderIcon={paneSong.url ? 'radio' : 'musical-notes'}
                      />
                    ) : null}
                  </Animated.View>
                );
              })}
            </Animated.View>
          </GestureDetector>
          {/* Lyrics in place of the cover (setting): same frame, on top. */}
          {inlineLyrics && hasLyrics ? (
            <View style={[styles.lyricsOverlay, { height: coverSize }]}>
              <CoverLyrics size={coverSize} onClose={() => setInlineLyrics(false)} />
            </View>
          ) : null}
          {/* Inside the slot and right after the cover, so it hangs from the
              artwork instead of from the title: the spare height falls below
              both. Its measured height is discounted from `coverSize`. */}
          {canRate ? (
            // Faded in with the cover, not before it: it is measured on the
            // first pass whatever its opacity, and showing it while the cover
            // above it is still resolving is what put the stars on screen at
            // one height and then moved them.
            <Animated.View
              style={[styles.belowCover, coverAppearStyle]}
              onLayout={(e) => setStarsH(e.nativeEvent.layout.height)}
            >
              <StarRating
                id={song.id}
                rating={song.userRating}
                size={20}
                onRated={(r) => rateSong(song.id, r)}
              />
            </Animated.View>
          ) : null}
        </View>

        {/* The safe area is kept here rather than on the SafeAreaView: the
            scroll has to reach the bottom edge for the lyrics card, and it is
            this block, the last thing on the first page, that must not end up
            under the navigation bar. */}
        <View
          style={[
            styles.bottom,
            landscape && styles.bottomColumn,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.meta}>
            <View style={{ flex: 1 }}>
              {song.albumId ? (
                <Pressable
                  style={styles.tapText}
                  hitSlop={6}
                  onPress={() => router.push(`/album/${song.albumId}` as never)}
                >
                  <MarqueeText text={title} style={styles.title} enabled={marqueeTitles} />
                </Pressable>
              ) : (
                <MarqueeText text={title} style={styles.title} enabled={marqueeTitles} />
              )}
              {(() => {
                const targets = artistTargets(song);
                const goArtist =
                  targets.length === 0
                    ? undefined
                    : () =>
                        targets.length > 1
                          ? openArtistPicker(targets)
                          : router.push(`/artist/${targets[0].id}`);
                const goAlbum = song.albumId
                  ? () => router.push(`/album/${song.albumId}` as never)
                  : undefined;
                return (
                  <>
                    {/* The badge sits beside the artist and not the title: the
                        title is a marquee, and anything sharing a row with it
                        would be dragged along by the scroll. */}
                    <View style={styles.artistRow}>
                      <ExplicitBadge status={song.explicitStatus} />
                      <Text
                        style={styles.artist}
                        numberOfLines={1}
                        onPress={goArtist}
                        suppressHighlighting
                      >
                        {artistName}
                      </Text>
                    </View>
                    {/* Its own line: next to the artist the two ran together and
                        the album was hard to pick out. */}
                    {albumInfo ? (
                      <Text
                        style={styles.album}
                        numberOfLines={1}
                        onPress={goAlbum}
                        suppressHighlighting
                      >
                        {albumInfo}
                      </Text>
                    ) : null}
                  </>
                );
              })()}
            </View>
            {swapButtons ? (
              <CircleButton
                name="ellipsis-vertical"
                label={t('More options')}
                onPress={() => openMenu(song, undefined, { showLyrics: hasLyrics })}
              />
            ) : (
              <FavoriteButton id={song.id} starred={favorited} size={26} />
            )}
          </View>

          {showQualityBadge ? (
            <View style={styles.subInfo}>
              <AudioQualityBadge song={song} />
            </View>
          ) : null}

          <PlayerProgress duration={duration} onSeek={seekTo} />

          <View style={styles.controls}>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Shuffle')}
              onPress={toggleShuffle}
            >
              <Ionicons
                name="shuffle"
                size={26}
                color={shuffle ? colors.accent : colors.text}
              />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Previous')}
              onPress={previous}
            >
              <Ionicons name="play-skip-back" size={34} color={colors.text} />
            </Pressable>
            {seekButtonsSec > 0 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Back {n} seconds', { n: seekButtonsSec })}
                onPress={() =>
                  seekTo(
                    Math.max(0, usePlayerStore.getState().positionSec - seekButtonsSec),
                  )
                }
              >
                <MaterialIcons
                  name={`replay-${seekButtonsSec}` as 'replay-10'}
                  size={28}
                  color={colors.text}
                />
              </Pressable>
            ) : null}
            <Pressable
              style={styles.playButton}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('Pause') : t('Play')}
              onPress={toggle}
               // Real stop: stops and clears queue, mini player and
               // notification. No need to close the player manually: the
               // "no song" effect already closes it, and the Undo toast stays
               // on the screen underneath.
              onLongPress={() => {
                haptic('medium');
                void usePlayerStore
                  .getState()
                  .stopAndClear()
                  .then((undo) => {
                    if (!undo) return;
                    useToast.getState().show(t('Playback stopped'), { label: t('Undo'), run: undo });
                  });
              }}
            >
              {isBuffering ? (
                <ActivityIndicator size="small" color={colors.onInverse} />
              ) : (
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={34}
                  color={colors.onInverse}
                  style={!isPlaying && { marginLeft: 3 }}
                />
              )}
            </Pressable>
            {seekButtonsSec > 0 ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('Forward {n} seconds', { n: seekButtonsSec })}
                onPress={() =>
                  // Cap before the end: skipping past didJustFinish manually
                  // would leave auto-advance without triggering.
                  seekTo(
                    duration > 0
                      ? Math.min(duration - 1, usePlayerStore.getState().positionSec + seekButtonsSec)
                      : usePlayerStore.getState().positionSec + seekButtonsSec,
                  )
                }
              >
                <MaterialIcons
                  name={`forward-${seekButtonsSec}` as 'forward-10'}
                  size={28}
                  color={colors.text}
                />
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Next')}
              onPress={next}
            >
              <Ionicons name="play-skip-forward" size={34} color={colors.text} />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Repeat')}
              onPress={cycleRepeat}
            >
              <MaterialIcons
                name={repeat === 'one' ? 'repeat-one' : 'repeat'}
                size={26}
                color={repeatActive ? colors.accent : colors.text}
              />
            </Pressable>
          </View>

          {showDevicesButton || showQueueButton || remoteDevice || showSpeed ? (
            <View style={styles.bottomRow}>
              <View style={styles.bottomSlot}>
                {/* Connected to a remote device it's always shown: it's the
                    only way to disconnect the cast.
                    Never disabled any more. It was, without a connection, back
                    when a renderer could only be given a URL on the server:
                    downloads cast from the phone now, so offline there is
                    something to send. And it left the way out drawn and barred
                    — going offline mid-cast used to leave the cast on with
                    nothing that could end it. */}
                {showDevicesButton || remoteDevice ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('Devices')}
                    onPress={() => setOutputOpen(true)}
                    style={styles.deviceRow}
                  >
                    <MaterialIcons
                      name="devices"
                      size={22}
                      color={remoteDevice ? colors.accent : colors.text}
                    />
                    {remoteDevice ? (
                      <Text style={[styles.deviceName, { color: colors.accent }]} numberOfLines={1}>
                        {remoteDevice}
                      </Text>
                    ) : null}
                  </Pressable>
                ) : null}
              </View>
              {/* Dead centre of the row, between the devices and the queue: it
                  is about the music itself rather than about where it goes or
                  what comes next, and it is the one of the three you reach for
                  while the song plays. */}
              {showSpeed ? (
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('Playback speed')}
                  onPress={() => openSpeedSheet.current()}
                  style={styles.speedButton}
                >
                  <MaterialIcons
                    name="speed"
                    size={24}
                    color={speed === 1 ? colors.text : colors.accent}
                  />
                  {/* The number only once it says something. Beside the icon in
                      the accent, like the device name next to its own. */}
                  {speed === 1 ? null : (
                    <Text style={styles.speedText}>{`${speed}×`}</Text>
                  )}
                </Pressable>
              ) : null}
              {/* Same width as the slot on the left, so what sits between them
                  is centred on the screen and not on what is left over. */}
              <View style={styles.bottomSlotEnd}>
                {showQueueButton ? (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('View queue')}
                    onPress={() => pushOnce('/queue')}
                  >
                    <MaterialIcons name="queue-music" size={24} color={colors.text} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
        </View>
        </View>
        {showsLyricsCard ? <LyricsCard /> : null}
        <ArtistPlayerCard />
        </ScrollView>
        </SafeAreaView>
        <OutputSheet visible={outputOpen} onClose={() => setOutputOpen(false)} />
        <SpeedSheet openRef={openSpeedSheet} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = themed((colors) => ({
  root: { flex: 1, backgroundColor: colors.background },
  // Darkens the blurred artwork so the white text keeps its contrast whatever
  // the cover is. Tuned by eye: any lighter and pale covers wash the title out.
  coverScrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.coverWash },
  // Horizontal padding lives in each section (not here): so the slider can
  // overshoot its internal margin without the ScrollView clipping the thumb.
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  circle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitleWrap: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  topTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  topLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  topSource: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  // The elastic slot: takes whatever the rest leaves over, and `coverSize` is
  // measured from here. `minHeight: 0` so it can actually shrink.
  // `flex-start` plus a computed `paddingTop` instead of `center`: this way the
  // split of the spare height is ours to decide (see COVER_TOP_SHARE) rather
  // than a fixed 50/50, which left too big a hole above the cover.
  coverWrap: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: spacing.lg,
  },
  /** Everything under the top bar, stacked, which is what it has always been. */
  pageStack: { flex: 1, minHeight: 0 },
  /** And the same two blocks turned into columns (#131). */
  pageColumns: { flex: 1, minHeight: 0, flexDirection: 'row', alignItems: 'stretch' },
  /** The cover's half: it no longer hangs from the top, it sits in the middle
   *  of its own column, and the split of the spare height above and below
   *  (`coverTopPad`) does the rest. */
  coverColumn: { marginTop: 0, justifyContent: 'center' },
  /**
   * And the other half, with what is left of it centred: a title and a slider
   * pinned to the bottom of a short screen read as an afterthought.
   *
   * It stops growing well before the column does. Across half a tablet the
   * shuffle and the repeat end up a forearm apart with the play button alone
   * in the middle, which is not a set of controls, it is five buttons that
   * happen to be on the same line.
   */
  bottomColumn: { flex: 1, justifyContent: 'center', maxWidth: 560, alignSelf: 'center' },
  // Carousel panels are absolute (usePaneStyle positions them); the row that
  // reserves the cover art slot is sized inline, since it's dynamic now.
  coverPane: { position: 'absolute', top: 0, left: 0 },
  // Lyrics overlay on top of the cover frame: same height (set inline, it
  // follows the cover) and horizontally centered (coverWrap is wider than the
  // cover; without this the lyrics would be left-aligned).
  lyricsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // Natural height (no `flex: 1`): the slack goes to `coverWrap`, which is what
  // gives it up when the options don't fit. `paddingBottom` is overridden at
  // the call site to add the safe area on top of it.
  bottom: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  // The tappable area fits the text (not the full width), to avoid navigating
  // when tapping the empty space on the right.
  // Hugs the text: the tappable area is just the title/artist, not the row.
  tapText: { alignSelf: 'flex-start', maxWidth: '100%' },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '600' },
  // The gap the artist line used to keep for itself now belongs to the row it
  // shares with the badge, so the two line up on their middles.
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    flexShrink: 1,
  },
  // A step below the artist so the three lines read as a hierarchy
  // (title → artist → album) instead of three rows of the same weight.
  album: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  subInfo: { marginTop: -spacing.sm, marginBottom: spacing.xs },
  progress: { marginBottom: spacing.xs },
  // Compensates for the slider's internal margin (~15px, where the thumb is
  // centered at the extremes): the visible track goes edge to edge of the
  // content, like Spotify, and the thumb extends into the gap without being
  // clipped.
  slider: { marginHorizontal: -15 },
  // Snug against the bar: the slider brings lots of vertical space (touch area).
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  time: { color: colors.textMuted, fontSize: fontSize.xs },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  playButton: {
    backgroundColor: colors.text,
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stars centered below the cover (optional element).
  belowCover: { alignItems: 'center', marginTop: spacing.md },
  // Same footprint as the CircleButton it replaces when swapped, so the
  // centered title doesn't shift.
  topFavorite: { width: 40, alignItems: 'center', justifyContent: 'center' },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
  },
  // Flexible slot for the devices button: keeps the queue in place even if
  // the button is hidden, and lets the device name expand.
  bottomSlot: {
    flex: 1,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  // Like Spotify Connect: icon + device name in accent when casting.
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
    paddingRight: spacing.lg,
  },
  deviceName: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '600',
    flexShrink: 1,
  },
  // Mirrors `bottomSlot` on the other side, so the speed button between the two
  // sits in the middle of the screen. The queue icon ends up exactly where it
  // was before, at the right edge.
  bottomSlotEnd: {
    flex: 1,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  speedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 40,
  },
  // In the accent like the device name beside its own icon: it is a mode that
  // is on, which is what the accent means everywhere else on this screen.
  speedText: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
}));
