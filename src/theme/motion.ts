/**
 * How long things take, and on what curve.
 *
 * The app had all of this already and had it written down nowhere: sheets
 * rising in 240 and leaving in 160, fades of 200, the player moving things in
 * 220, placeholders breathing every 700, `Easing.out(Easing.cubic)` for
 * anything arriving and `Easing.in` for anything going. Sane numbers, chosen
 * once and then copied by eye, which is how a fade of 150 and a fade of 200
 * end up next to each other meaning the same thing.
 *
 * So it lives here for the same reason `radius` and `fontSize` do: a value
 * with a name can be changed for the whole app at once, and the next person
 * who animates something has somewhere to look instead of a number to invent.
 *
 * Not exported through `@/theme`. That barrel is imported by code with no
 * screen behind it, and this one pulls Reanimated in with it.
 */
import { Easing, ReduceMotion } from 'react-native-reanimated';

export const motion = {
  /**
   * Leaving is quicker than arriving, always. What is on its way in is
   * something to look at; what is on its way out has already been decided
   * about, and a slow exit is a wait.
   */
  duration: {
    /** Appearing or going without moving: the mini player, the tab bar. */
    fade: 200,
    /** Arriving: a sheet up from the bottom, a panel in from the side. */
    enter: 240,
    /** Going, by the same road. */
    exit: 160,
    /** Travelling somewhere the eye follows across the screen. */
    move: 220,
    /** A line of lyrics walking up to its place, which is further than it
     *  looks and reads as a jump if it is hurried. */
    scroll: 540,
    /** A colour settling in behind everything else, slow enough that nobody
     *  catches it changing. */
    tint: 600,
    /** Lyrics moving gently between sharp and out-of-focus depth planes. */
    depth: 720,
    /** One breath of a placeholder, or one rise of the bars on a playing row. */
    pulse: 700,
    /**
     * How long a finger has to stay down before a row admits it was touched.
     *
     * A row lighting up the instant it is touched lights up on the way past
     * while somebody is scrolling, which reads as taps nobody made — the
     * reason the song rows had no press feedback at all. The touch that starts
     * a scroll is over well inside this, so the row never gets as far as
     * showing anything.
     */
    press: 90,
  },
  easing: {
    /** Arriving: fast at first, easing into place. */
    enter: Easing.out(Easing.cubic),
    /** Going: gathering speed on the way out. */
    exit: Easing.in(Easing.cubic),
    /** Crossing the screen, which is an arrival to whoever is watching. */
    move: Easing.out(Easing.cubic),
    /** Depth needs a soft departure as well as a soft arrival. */
    depth: Easing.inOut(Easing.quad),
    /** Something that never arrives, so it may not slow down at either end. */
    loop: Easing.inOut(Easing.quad),
  },
  /**
   * Whether the phone's "remove animations" setting is obeyed, which is not
   * one answer.
   *
   * `essential` is for the movement that carries meaning: without it a sheet
   * appears on top of the screen with a visible jump, and lyrics teleport
   * rather than scroll. Reanimated also reads that setting once at startup, so
   * it would not even follow somebody who changed their mind.
   *
   * Everything decorative takes the default and stops. The row that is playing
   * is still marked without its bars moving.
   */
  reduceMotion: {
    essential: ReduceMotion.Never,
    decorative: ReduceMotion.System,
  },
} as const;

/** The two halves of a sheet's travel, which every sheet in the app shares. */
export const SHEET_IN = {
  duration: motion.duration.enter,
  easing: motion.easing.enter,
  reduceMotion: motion.reduceMotion.essential,
} as const;

export const SHEET_OUT = {
  duration: motion.duration.exit,
  easing: motion.easing.exit,
  reduceMotion: motion.reduceMotion.essential,
} as const;
