package expo.modules.upnpcast

/**
 * What one track has done on an ordinary renderer, poll after poll, and what
 * that adds up to: still going, ended, or stopped halfway.
 *
 * UPnP has no "track ended" event and no state for it. A renderer that reaches
 * the end of a song stops, or unloads it, or pauses on the last second, or
 * keeps saying PLAYING with the clock stuck at the end (#285). So the end is
 * read off the clock as much as off the state: a stop near the end, or a clock
 * that has not moved for a while near the end, whatever the state says.
 */
internal class TrackWatch(private val clock: () -> Long = System::currentTimeMillis) {
  enum class Verdict {
    /** Playing, paused, between tracks, or stopped by us: nothing to do. */
    NONE,
    /** The track is over and the next one is due. */
    ENDED,
    /** Stopped halfway, by nobody here: the renderer gave up on the stream or was told to stop by someone else. */
    INTERRUPTED,
  }

  /** PLAYING has been seen since the track was loaded: only then can it end. */
  var observedPlaying = false
    private set
  var lastPositionMs = 0L
    private set
  var lastDurationMs = 0L
    private set
  /** Consecutive polls that found the renderer stopped. */
  var stoppedPolls = 0
    private set

  private var lastSeenPositionMs = -1L
  private var lastSeenPlayback = ""
  private var frozenSinceMs = 0L
  private var playingSeenAtMs = 0L
  /** How far the track can have got by the first poll that found it stopped. */
  private var reachedMs = 0L

  fun reset(positionMs: Long = 0) {
    playingSeenAtMs = 0
    reachedMs = 0
    observedPlaying = false
    lastPositionMs = positionMs.coerceAtLeast(0)
    lastDurationMs = 0
    stoppedPolls = 0
    lastSeenPositionMs = -1
    lastSeenPlayback = ""
    frozenSinceMs = 0
  }

  /** Takes one poll; `playback` is PLAYING, PAUSED, TRANSITIONING or STOPPED. */
  fun observe(playback: String, positionMs: Long, durationMs: Long) {
    if (positionMs > 0) lastPositionMs = positionMs
    if (durationMs > 0) lastDurationMs = durationMs
    if (playback == PLAYING) observedPlaying = true
    if (playback == STOPPED) stoppedPolls++ else if (playback != TRANSITIONING) stoppedPolls = 0

    // Polls can be missing for a long while (Wi-Fi napping, phone dozing), and
    // the last position seen then says nothing about where the stop happened.
    if (playback == STOPPED && stoppedPolls == 1) {
      reachedMs = lastPositionMs + if (playingSeenAtMs > 0) clock() - playingSeenAtMs else 0
    }
    if (playback != STOPPED) playingSeenAtMs = if (playback == PLAYING) clock() else 0

    // The clock counts as stuck only for as long as the state holds: a pause
    // near the end, played again, is not a track that has been over for as
    // long as it was paused.
    if (playback == STOPPED || positionMs != lastSeenPositionMs || playback != lastSeenPlayback) {
      frozenSinceMs = 0
    } else if (frozenSinceMs == 0L) {
      frozenSinceMs = clock()
    }
    lastSeenPositionMs = positionMs
    lastSeenPlayback = playback
  }

  /** Forgets that the track was ever played, so the same stop is not acted on twice. */
  fun settle() {
    observedPlaying = false
    stoppedPolls = 0
    frozenSinceMs = 0
  }

  fun verdict(playback: String, expectedDurationMs: Long, stoppedByController: Boolean): Verdict {
    if (!observedPlaying || stoppedByController) return Verdict.NONE
    if (playback == STOPPED) {
      if (GenericQueueProgression.isNearEnd(maxOf(lastPositionMs, reachedMs), lastDurationMs, expectedDurationMs)) {
        return Verdict.ENDED
      }
      return if (stoppedPolls >= INTERRUPTED_POLLS) Verdict.INTERRUPTED else Verdict.NONE
    }
    // Not stopped, yet the clock has stood still near the end for longer than
    // what is left to play: whatever the renderer says, the song is over. A
    // clock that is not known to be near any end is a stream buffering, and
    // is left alone.
    val frozenFor = if (frozenSinceMs == 0L) 0L else clock() - frozenSinceMs
    if (frozenFor < STALLED_MS) return Verdict.NONE
    val reference = GenericQueueProgression.referenceDurationMs(lastDurationMs, expectedDurationMs)
    if (reference <= 0) return Verdict.NONE
    return if (lastPositionMs >= reference - STALLED_WINDOW_MS) Verdict.ENDED else Verdict.NONE
  }

  companion object {
    const val PLAYING = "PLAYING"
    const val PAUSED = "PAUSED"
    const val TRANSITIONING = "TRANSITIONING"
    const val STOPPED = "STOPPED"

    /** Polls a stop in the middle of a song has to last before it counts. */
    const val INTERRUPTED_POLLS = 3

    /** How long a clock stuck near the end takes to count as the end. */
    const val STALLED_MS = 6_000L

    /** How near the end a stuck clock has to be. */
    const val STALLED_WINDOW_MS = 5_000L

    /** The renderer's own words for its state, in the four above. */
    fun normalize(rendererState: String): String {
      val state = rendererState.trim().uppercase()
      return when {
        state == PLAYING -> PLAYING
        state == TRANSITIONING -> TRANSITIONING
        state.startsWith("PAUSED") -> PAUSED
        // A renderer that unloads the track when it ends reports no media
        // rather than stopped; for telling an end apart they are the same.
        else -> STOPPED
      }
    }
  }
}
