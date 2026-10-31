package expo.modules.upnpcast

import org.junit.Assert.assertEquals
import org.junit.Test

class TrackWatchTest {
  private var now = 1_000L
  private val watch = TrackWatch { now }

  private fun poll(playback: String, positionMs: Long, durationMs: Long = 200_000) {
    watch.observe(playback, positionMs, durationMs)
    now += 1_000
  }

  private fun verdict(playback: String, expectedMs: Long = 200_000, stoppedByUs: Boolean = false) =
    watch.verdict(playback, expectedMs, stoppedByUs)

  @Test fun aStopNearTheEndIsTheEnd() {
    poll("PLAYING", 196_000)
    poll("STOPPED", 0, 0)
    assertEquals(TrackWatch.Verdict.ENDED, verdict("STOPPED"))
  }

  @Test fun aStopWeAskedForIsNothing() {
    poll("PLAYING", 196_000)
    poll("STOPPED", 0, 0)
    assertEquals(TrackWatch.Verdict.NONE, verdict("STOPPED", stoppedByUs = true))
  }

  @Test fun aStopBeforeAnythingPlayedIsNothing() {
    poll("STOPPED", 0, 0)
    poll("STOPPED", 0, 0)
    poll("STOPPED", 0, 0)
    assertEquals(TrackWatch.Verdict.NONE, verdict("STOPPED"))
  }

  @Test fun aTrackThatEndedWhileNoPollGotThroughIsTheEnd() {
    poll("PLAYING", 60_000)
    now += 150_000
    poll("STOPPED", 0, 0)
    assertEquals(TrackWatch.Verdict.ENDED, verdict("STOPPED"))
  }

  @Test fun aStopAfterAPauseIsNotCountedAsTimePlayed() {
    poll("PLAYING", 60_000)
    poll("PAUSED", 60_000)
    now += 150_000
    repeat(TrackWatch.INTERRUPTED_POLLS) { poll("STOPPED", 0, 0) }
    assertEquals(TrackWatch.Verdict.INTERRUPTED, verdict("STOPPED"))
  }

  @Test fun aStopHalfwayIsAnInterruptionOnceItLasts() {
    poll("PLAYING", 60_000)
    poll("STOPPED", 0, 0)
    assertEquals(TrackWatch.Verdict.NONE, verdict("STOPPED"))
    poll("STOPPED", 0, 0)
    poll("STOPPED", 0, 0)
    assertEquals(TrackWatch.Verdict.INTERRUPTED, verdict("STOPPED"))
  }

  @Test fun aRendererGuessingTheLengthLongStillEnds() {
    // The renderer thinks 300 s; the song is 240 s and the stream runs out there.
    poll("PLAYING", 238_000, 300_000)
    poll("STOPPED", 0, 0)
    assertEquals(TrackWatch.Verdict.ENDED, verdict("STOPPED", expectedMs = 240_000))
  }

  @Test fun aClockStuckAtTheEndWhilePlayingIsTheEnd() {
    poll("PLAYING", 198_000)
    repeat(8) { poll("PLAYING", 200_000) }
    assertEquals(TrackWatch.Verdict.ENDED, verdict("PLAYING"))
  }

  @Test fun aClockStuckAtTheEndWhilePausedByTheRendererIsTheEnd() {
    poll("PLAYING", 199_000)
    repeat(8) { poll("PAUSED", 200_000) }
    assertEquals(TrackWatch.Verdict.ENDED, verdict("PAUSED"))
  }

  @Test fun aClockStuckForAMomentIsNothing() {
    poll("PLAYING", 198_000)
    repeat(3) { poll("PLAYING", 199_000) }
    assertEquals(TrackWatch.Verdict.NONE, verdict("PLAYING"))
  }

  @Test fun aClockStuckInTheMiddleIsBuffering() {
    poll("PLAYING", 50_000)
    repeat(20) { poll("PLAYING", 60_000) }
    assertEquals(TrackWatch.Verdict.NONE, verdict("PLAYING"))
  }

  @Test fun aStuckClockWithNoLengthIsBuffering() {
    poll("PLAYING", 50_000, 0)
    repeat(20) { poll("PLAYING", 60_000, 0) }
    assertEquals(TrackWatch.Verdict.NONE, verdict("PLAYING", expectedMs = 0))
  }

  @Test fun aLongPauseNearTheEndPlayedAgainIsNotAnEnd() {
    poll("PLAYING", 190_000)
    watch.settle()
    repeat(30) { poll("PAUSED", 190_000) }
    poll("PLAYING", 190_000)
    assertEquals(TrackWatch.Verdict.NONE, verdict("PLAYING"))
  }

  @Test fun anEndActedOnIsNotActedOnAgain() {
    poll("PLAYING", 196_000)
    poll("STOPPED", 0, 0)
    watch.settle()
    poll("STOPPED", 0, 0)
    assertEquals(TrackWatch.Verdict.NONE, verdict("STOPPED"))
  }

  @Test fun rendererStatesFoldIntoFour() {
    assertEquals("PLAYING", TrackWatch.normalize("playing"))
    assertEquals("PAUSED", TrackWatch.normalize("PAUSED_PLAYBACK"))
    assertEquals("TRANSITIONING", TrackWatch.normalize("TRANSITIONING"))
    assertEquals("STOPPED", TrackWatch.normalize("NO_MEDIA_PRESENT"))
    assertEquals("STOPPED", TrackWatch.normalize("STOPPED"))
  }
}
