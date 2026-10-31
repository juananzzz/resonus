package expo.modules.upnpcast

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** What the renderer is told about the track it is about to play. */
class TrackInfo(
  @Field val mime: String = "audio/mpeg",
  @Field val title: String = "",
  @Field val artist: String? = null,
  @Field val albumArtist: String? = null,
  @Field val album: String? = null,
  @Field val artworkUrl: String? = null,
  @Field val durationSec: Double? = null
) : Record

/** Long enough for a missed poll or two; every poll renews it. */
private const val AWAKE_TIMEOUT_MS = 60_000L

private const val POLL_INTERVAL_MS = 1_000L

/** Every this many polls, the repeat mode and the volume are read too. */
private const val EXTRAS_EVERY_POLLS = 3

/**
 * Loads of the next track tried at one track end before giving up. A load that
 * fails is mostly the network not being there yet, a phone waking from standby
 * (#271), and the next poll tries again.
 */
private const val MAX_ADVANCE_ATTEMPTS = 5

/** Failed polls in a row before the renderer counts as not answering. */
private const val UNREACHABLE_POLLS = 2

/** Every this many failed polls, the device's description is read again. */
private const val RECOVER_EVERY_POLLS = 3

/** Failed polls before the network is searched for the device elsewhere. */
private const val REDISCOVER_AFTER_POLLS = 6

private const val REDISCOVER_MS = 3_000L

/**
 * How long a renderer can go without answering before the session is given up
 * and playback comes back to the phone (#285). Long enough for a Wi-Fi hiccup
 * or a renderer restarting, short enough not to leave a dead session up.
 */
private const val LOST_AFTER_MS = 30_000L

/**
 * Polls in a row a renderer that reports what it plays has to be playing
 * something not in this queue before it counts as taken over by another app.
 */
private const val FOREIGN_POLLS = 3

/**
 * Stopped polls a renderer that took the next track in advance gets to start
 * it on its own before the module loads it itself.
 */
private const val HANDOFF_GRACE_POLLS = 2

/**
 * Playing polls after a load in which a renderer that reports what it plays has
 * to report what it was given, before it stops being believed.
 */
private const val ECHO_POLLS = 10

/** Addresses kept as this session's own, besides the queue's (see `recentUris`). */
private const val RECENT_URIS = 8

/** After a load, how long a renderer that has not started yet reads as starting. */
private const val LOAD_GRACE_MS = 15_000L

/**
 * Expo bridge to UPnPCast (DLNA/UPnP). Finds renderers on the local network and
 * drives playback over AVTransport. UPnP has no reliable way of pushing events,
 * so state and progress are polled once a second for as long as there is a
 * session and sent to JS as a "state" event.
 *
 * The poll is also what keeps the session honest (#285): a renderer that stops
 * answering is looked for again, and given up after `LOST_AFTER_MS` with a
 * "lost" event, so playback comes back to the phone instead of hanging. The
 * same goes for one another app has taken over. The things worth knowing about
 * afterwards go to JS as "note" events, for the diagnostics report.
 */

class UpnpCastModule : Module() {
  private enum class NextUriCapability { UNKNOWN, SUPPORTED, UNSUPPORTED }

  /**
   * Whether the renderer reports the address of what it plays (TrackURI).
   *
   * Only a renderer that does can be handed the next track in advance: its
   * address is the one way to see it start, and a renderer that took the next
   * track without saying so left the queue a track behind what was sounding,
   * the wrong song on screen and a stall at the end (#285). Learned from the
   * first track it plays; one that does not is loaded track by track.
   */
  private enum class UriTrust { UNKNOWN, TRUSTED, UNTRUSTED }

  private data class QueueRequest(
    val tracks: List<Track>,
    val currentIndex: Int,
    val positionMs: Long,
    val playMode: String,
    val autoplay: Boolean,
  )

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  @Volatile private var pollJob: Job? = null
  private val transportMutex = Mutex()

  private val known = ConcurrentHashMap<String, RendererSession>()
  @Volatile private var session: RendererSession? = null

  // Guarded by transportMutex. Sonos keeps using its renderer-side queue; this
  // state is authoritative only for ordinary AVTransport renderers.
  private var nativeQueue: List<Track> = emptyList()
  private var nativeQueueIndex = -1
  private var nativePlayMode = "NORMAL"
  private var nativeQueueManaged = false
  private var lastPlaybackState = ""
  private val watch = TrackWatch()
  private var stoppedByUs = false
  private var transitionInProgress = false
  private var advanceAttempts = 0
  private var stagedNextIndex: Int? = null
  private var stagedNextUrl: String? = null
  private var nextUriCapability = NextUriCapability.UNKNOWN
  private var uriTrust = UriTrust.UNKNOWN
  /** What was just loaded, until the renderer is seen playing it. */
  private var expectedUri: String? = null
  private var echoPolls = 0
  private var foreignPolls = 0
  /**
   * The last few addresses handed to the renderer. One of these playing is
   * this queue being out of step for a moment, never another app.
   */
  private val recentUris = ArrayDeque<String>()
  private var loadedAtMs = 0L
  /** Stopped halfway by nobody here; Play picks it up where it stopped. */
  private var interrupted = false
  /** The last track of the queue ended; Play starts it again. */
  private var endedAtQueueEnd = false
  /** Set under the lock by a poll that found the session taken over. */
  private var lossReason: String? = null

  // The poll below is what notices a track ending and loads the next one, and
  // a coroutine `delay` does not keep the CPU up: with the screen off the phone
  // dozed between polls and the next track started 15-20 s late (#246). Held
  // only while the renderer plays or is between tracks, with a timeout that
  // every poll renews, so a stalled loop cannot keep the phone awake.
  private var wakeLock: PowerManager.WakeLock? = null
  // The CPU awake is not the radio awake: in standby the Wi-Fi naps between
  // beacons, and the SOAP call loading the next track could fail or arrive
  // late (#271). Held and dropped together with the wake lock.
  private var wifiLock: WifiManager.WifiLock? = null

  private fun parseQueueRequest(payloadJson: String): QueueRequest {
    val payload = JSONObject(payloadJson)
    val tracksJson = payload.getJSONArray("tracks")
    val tracks = mutableListOf<Track>()
    for (i in 0 until tracksJson.length()) {
      val item = tracksJson.getJSONObject(i)
      tracks.add(
        Track(
          url = item.getString("url"),
          mime = item.optString("mime", "audio/mpeg"),
          title = item.optString("title", ""),
          artist = item.optString("artist").takeIf { it.isNotBlank() },
          albumArtist = item.optString("albumArtist").takeIf { it.isNotBlank() },
          album = item.optString("album").takeIf { it.isNotBlank() },
          artworkUrl = item.optString("artworkUrl").takeIf { it.isNotBlank() },
          durationSeconds = item.optInt("durationSec", 0),
          id = item.optString("id").takeIf { it.isNotBlank() }
        )
      )
    }
    return QueueRequest(
      tracks = tracks,
      currentIndex = payload.optInt("currentIndex", 0),
      positionMs = payload.optDouble("positionMs", 0.0).toLong(),
      playMode = payload.optString("playMode", "NORMAL"),
      autoplay = payload.optBoolean("autoplay", false),
    )
  }

  override fun definition() = ModuleDefinition {
    Name("UpnpCast")

    Events("state", "lost", "note")

    OnDestroy {
      keepAwake(false)
      pollJob?.cancel()
      scope.cancel()
    }

    /**
     * Searches the network for renderers, resolving with the list once the
     * timeout is up.
     *
     * A search has to go out to the whole network, so everything on it answers,
     * and almost nothing in a house can play a note. The router is the usual
     * one: it speaks UPnP to open ports, and it ended up in a list of speakers,
     * which is all anyone without one would find there. Devices that answer
     * that they have no AVTransport are dropped; the ones that answer nothing
     * still show, since not having been able to ask is not a no.
     */
    AsyncFunction("search") { timeoutMs: Double, promise: Promise ->
      scope.launch {
        val found = Ssdp.discover(timeoutMs.toLong())
        val devices = found.map { (location, address) ->
          async {
            val description = Soap.fetch(location)?.let { DeviceDescription.parse(it, location) }
            if (description == null || !description.isRenderer) return@async null
            val sonos = SonosTopology.describe(description)
            val id = (description.udn?.removePrefix("uuid:")?.trim()?.takeIf(String::isNotEmpty)
              ?.let { if (description.isSonos) it.uppercase() else it }) ?: address
            known[id] = RendererSession(id, address, location, description)
            mapOf(
              "id" to id,
              "name" to (sonos?.name ?: description.displayName() ?: address),
              "address" to address,
              "isTV" to description.isTv,
              "isSonos" to description.isSonos,
              "groupId" to sonos?.groupId,
              "coordinatorId" to sonos?.coordinatorId,
            )
          }
        }.awaitAll().filterNotNull()
        promise.resolve(devices)
      }
    }

    AsyncFunction("connect") { deviceId: String, promise: Promise ->
      val target = known[deviceId]
      if (target == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      scope.launch {
        transportMutex.withLock {
          target.resetQueueState()
          session = target
          clearNativeQueueState()
        }
        startPolling()
        promise.resolve(true)
      }
    }

    AsyncFunction("join") { deviceId: String, targetDeviceId: String, promise: Promise ->
      val device = known[deviceId]
      val target = known[targetDeviceId]
      if (device == null || target == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      scope.launch {
        val ok = device.join(target)
        if (ok) known.values.forEach(RendererSession::invalidateCoordinatorTarget)
        promise.resolve(ok)
      }
    }

    AsyncFunction("ungroup") { deviceId: String, promise: Promise ->
      val device = known[deviceId]
      if (device == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      scope.launch {
        val ok = device.ungroup()
        if (ok) known.values.forEach(RendererSession::invalidateCoordinatorTarget)
        promise.resolve(ok)
      }
    }

    AsyncFunction("load") { url: String, track: TrackInfo, autoplay: Boolean, promise: Promise ->
      val current = session
      if (current == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      scope.launch {
        val ok = transportMutex.withLock {
          if (session !== current) return@withLock false
          clearNativeQueueState()
          stoppedByUs = !autoplay
          current.load(
            Track(
              url = url,
              mime = track.mime,
              title = track.title,
              artist = track.artist,
              albumArtist = track.albumArtist,
              album = track.album,
              artworkUrl = track.artworkUrl,
              durationSeconds = (track.durationSec ?: 0.0).toInt()
            )
          )
        }
        promise.resolve(ok)
      }
    }

    AsyncFunction("loadQueue") { payloadJson: String, promise: Promise ->
      val current = session
      if (current == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      scope.launch {
        try {
          val request = parseQueueRequest(payloadJson)
          val ok = transportMutex.withLock {
            if (session !== current) return@withLock false
            if (!current.isSonos) {
              installNativeQueue(request.tracks, request.currentIndex, request.playMode)
              stoppedByUs = !request.autoplay
              transitionInProgress = true
            }
            val loaded = current.loadQueue(
              tracks = request.tracks,
              currentIndex = request.currentIndex,
              autoplay = request.autoplay,
              positionMs = request.positionMs,
              playMode = request.playMode
            )
            if (!current.isSonos) {
              transitionInProgress = false
              if (loaded) {
                nativeQueue.getOrNull(nativeQueueIndex)?.let { markLoaded(it, request.positionMs) }
                Log.d(Soap.TAG, "Native queue loaded count=${nativeQueue.size} currentIndex=$nativeQueueIndex title=${trackLabel(nativeQueueIndex)}")
              } else {
                Log.w(Soap.TAG, "Native queue load failed currentIndex=$nativeQueueIndex")
              }
            }
            loaded
          }
          promise.resolve(ok)
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }
    }

    AsyncFunction("syncQueue") { payloadJson: String, promise: Promise ->
      val current = session
      if (current == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      scope.launch {
        try {
          val request = parseQueueRequest(payloadJson)
          val ok = transportMutex.withLock {
            if (session !== current) return@withLock false
            if (current.isSonos) {
              current.syncQueue(
                tracks = request.tracks,
                currentIndex = request.currentIndex,
                positionMs = request.positionMs,
                playMode = request.playMode
              )
            } else {
              syncNativeQueueLocked(current, request)
            }
          }
          promise.resolve(ok)
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }
    }

    AsyncFunction("play") { promise: Promise ->
      scope.launch { promise.resolve(transportMutex.withLock {
        stoppedByUs = false
        val current = session ?: return@withLock false
        // A stopped renderer that is told Play starts its track over, or
        // has nothing left to play: it is handed the track again instead.
        if (!current.isSonos && nativeQueueManaged && lastPlaybackState == TrackWatch.STOPPED) {
          resumeLocked(current)
        } else {
          current.play()
        }
      }) }
    }

    AsyncFunction("pause") { promise: Promise ->
      scope.launch { promise.resolve(transportMutex.withLock {
        stoppedByUs = true
        watch.settle()
        session?.pause() ?: false
      }) }
    }

    AsyncFunction("seek") { positionMs: Double, promise: Promise ->
      scope.launch { promise.resolve(transportMutex.withLock { session?.seek(positionMs.toLong()) ?: false }) }
    }

    AsyncFunction("getVolume") { promise: Promise ->
      scope.launch { promise.resolve(session?.getVolume() ?: -1) }
    }

    AsyncFunction("setVolume") { volume: Int, promise: Promise ->
      scope.launch { promise.resolve(session?.setVolume(volume) ?: false) }
    }

    AsyncFunction("setPlayMode") { playMode: String, promise: Promise ->
      scope.launch { promise.resolve(transportMutex.withLock {
        nativePlayMode = playMode
        stagedNextIndex = null
        stagedNextUrl = null
        val current = session ?: return@withLock false
        val accepted = if (current.isSonos) current.setPlayMode(playMode) else true
        if (!current.isSonos) stageNextLocked(current, clearIfNone = true)
        accepted
      }) }
    }

    AsyncFunction("setCrossfadeMode") { enabled: Boolean, promise: Promise ->
      scope.launch { promise.resolve(session?.setCrossfadeMode(enabled) ?: false) }
    }

    AsyncFunction("setSleepTimer") { durationSec: Double, promise: Promise ->
      val seconds = durationSec.toInt().coerceAtLeast(0)
      scope.launch { promise.resolve(session?.setSleepTimer(seconds) ?: false) }
    }

    AsyncFunction("disconnect") { promise: Promise ->
      val current = session
      pollJob?.cancel()
      pollJob = null
      session = null
      // After `session` is gone, so a poll still in flight cannot take it again.
      keepAwake(false)
      scope.launch {
        transportMutex.withLock {
          stoppedByUs = true
          clearNativeQueueState()
          current?.let {
            it.stop()
            it.resetQueueState()
          }
        }
        promise.resolve(true)
      }
    }
  }

  private fun startPolling() {
    pollJob?.cancel()
    pollJob = scope.launch {
      var failures = 0
      var failingSinceMs = 0L
      var lastDisplay = ""
      var polls = 0
      while (isActive) {
        val current = session ?: break
        var display = ""
        // The repeat mode and the volume change by hand, rarely: asked for on
        // every third poll, which keeps the others to two calls.
        val extras = polls++ % EXTRAS_EVERY_POLLS == 0
        val state = transportMutex.withLock {
          if (session !== current) return@withLock null
          val polled = current.state(extras = extras) ?: return@withLock null
          display = if (!current.isSonos && nativeQueueManaged) {
            handleGenericStateLocked(current, polled)
          } else {
            rendererDisplay(polled.playbackState)
          }
          polled
        }
        if (session !== current) break

        if (state == null) {
          failures++
          val now = System.currentTimeMillis()
          if (failures == 1) failingSinceMs = now
          val active = lastDisplay == "PLAYING" || lastDisplay == "BUFFERING"
          keepAwake(active)
          if (failures == UNREACHABLE_POLLS) note("renderer not answering")
          // Said as buffering while it was playing, so the player shows it is
          // waiting on something rather than a clock that has stopped.
          if (failures >= UNREACHABLE_POLLS && active) {
            sendEvent("state", mapOf("playbackState" to "BUFFERING", "reachable" to false))
          }
          if (now - failingSinceMs >= LOST_AFTER_MS) {
            lose(current, "unreachable")
            break
          }
          if (failures % RECOVER_EVERY_POLLS == 0) recover(current, failures)
          delay(POLL_INTERVAL_MS)
          continue
        }
        if (failures >= UNREACHABLE_POLLS) note("renderer answering again after $failures failed polls")
        failures = 0

        lossReason?.let { reason ->
          lose(current, reason)
          return@launch
        }

        lastDisplay = display
        keepAwake(display == "PLAYING" || display == "BUFFERING")
        val managed = nativeQueueManaged && !current.isSonos
        sendEvent(
          "state",
          mapOf(
            "playbackState" to display,
            "positionMs" to state.positionMs.toDouble(),
            "durationMs" to state.durationMs.toDouble(),
            "trackNumber" to (state.trackNumber?.toDouble() ?: 0.0),
            "playMode" to (state.playMode ?: ""),
            "nativeQueueManaged" to managed,
            "queueIndex" to if (managed) nativeQueueIndex.toDouble() else -1.0,
            "trackId" to if (managed) nativeQueue.getOrNull(nativeQueueIndex)?.id.orEmpty() else "",
            "volume" to (state.volume?.toDouble() ?: -1.0),
            "reachable" to true,
          ),
        )
        delay(POLL_INTERVAL_MS)
      }
    }
  }

  /** The renderer's own state in the words JS knows, for Sonos and unmanaged sessions. */
  private fun rendererDisplay(rendererState: String): String = when {
    rendererState.equals("PLAYING", ignoreCase = true) -> "PLAYING"
    rendererState.equals("TRANSITIONING", ignoreCase = true) -> "BUFFERING"
    rendererState.startsWith("PAUSED", ignoreCase = true) -> "PAUSED"
    rendererState.equals("NO_MEDIA_PRESENT", ignoreCase = true) -> "IDLE"
    rendererState.equals("STOPPED", ignoreCase = true) -> "STOPPED"
    else -> rendererState
  }

  /**
   * Tries to get a renderer that stopped answering back: its description read
   * again from where it was, and failing that, the device looked for on the
   * network under its own id, in case it came back somewhere else.
   */
  private suspend fun recover(current: RendererSession, failures: Int) {
    if (current.refreshDescription()) return
    if (failures < REDISCOVER_AFTER_POLLS) return
    val udn = current.udn ?: return
    val found = Ssdp.discover(REDISCOVER_MS)
    val match = coroutineScope {
      found.filterKeys { it != current.location }.map { (location, address) ->
        async {
          val description = Soap.fetch(location, Soap.POLL_TIMEOUT_MS)
            ?.let { DeviceDescription.parse(it, location) }
          if (description?.udn == udn) location to address else null
        }
      }.awaitAll().firstOrNull { it != null }
    } ?: return
    if (session === current && current.relocate(match.first, match.second)) {
      note("renderer found again at ${match.second}")
    }
  }

  /**
   * Ends a session the renderer is no longer part of, and says so to JS,
   * which takes playback back to the phone. Nothing is sent to the renderer:
   * it either cannot hear it or is playing for someone else now.
   */
  private suspend fun lose(current: RendererSession, reason: String) {
    if (session !== current) return
    session = null
    keepAwake(false)
    transportMutex.withLock {
      clearNativeQueueState()
      current.resetQueueState()
    }
    note("session ended: $reason")
    sendEvent("lost", mapOf("reason" to reason))
  }

  /** Something worth having in a bug report: to the log, and to JS for the diagnostics. */
  private fun note(text: String) {
    Log.i(Soap.TAG, text)
    sendEvent("note", mapOf("text" to text))
  }

  private fun installNativeQueue(tracks: List<Track>, requestedIndex: Int, playMode: String) {
    nativeQueue = tracks
    nativeQueueIndex = if (tracks.isEmpty()) -1 else requestedIndex.coerceIn(0, tracks.lastIndex)
    nativePlayMode = playMode
    nativeQueueManaged = tracks.isNotEmpty()
    stagedNextIndex = null
    stagedNextUrl = null
    advanceAttempts = 0
  }

  private fun clearNativeQueueState() {
    nativeQueue = emptyList()
    nativeQueueIndex = -1
    nativePlayMode = "NORMAL"
    nativeQueueManaged = false
    lastPlaybackState = ""
    watch.reset()
    stoppedByUs = false
    transitionInProgress = false
    advanceAttempts = 0
    stagedNextIndex = null
    stagedNextUrl = null
    nextUriCapability = NextUriCapability.UNKNOWN
    uriTrust = UriTrust.UNKNOWN
    expectedUri = null
    echoPolls = 0
    foreignPolls = 0
    recentUris.clear()
    loadedAtMs = 0
    interrupted = false
    endedAtQueueEnd = false
    lossReason = null
  }

  /** A track was just handed to the renderer: everything seen of the last one goes. */
  private fun markLoaded(track: Track, positionMs: Long) {
    watch.reset(positionMs)
    lastPlaybackState = ""
    expectedUri = track.url
    echoPolls = 0
    foreignPolls = 0
    rememberUri(track.url)
    loadedAtMs = System.currentTimeMillis()
    interrupted = false
    endedAtQueueEnd = false
  }

  private fun rememberUri(uri: String) {
    recentUris.remove(uri)
    recentUris.addLast(uri)
    while (recentUris.size > RECENT_URIS) recentUris.removeFirst()
  }

  private fun nextQueueIndex(): Int? {
    if (!nativeQueueManaged) return null
    return GenericQueueProgression.nextIndex(nativeQueue.size, nativeQueueIndex, nativePlayMode)
  }

  /**
   * Hands the renderer the next track in advance (SetNextAVTransportURI), so
   * it can go on by itself with the phone asleep. Only to a renderer that has
   * been seen to report what it plays, and only once it plays what it was
   * last given: otherwise the hand-over could not be seen (see `UriTrust`).
   */
  private suspend fun stageNextLocked(current: RendererSession, clearIfNone: Boolean = false) {
    if (!nativeQueueManaged || nextUriCapability == NextUriCapability.UNSUPPORTED || transitionInProgress) return
    if (uriTrust != UriTrust.TRUSTED || expectedUri != null) return
    // Repeat-one hands over the same address, which no TrackURI can tell
    // apart from the lap before: that one is loaded again at the end.
    val nextIndex = nextQueueIndex()?.takeIf { it != nativeQueueIndex }
    if (nextIndex == null) {
      if (clearIfNone) dropStagedLocked(current)
      return
    }
    val track = nativeQueue.getOrNull(nextIndex) ?: return
    if (stagedNextIndex == nextIndex && stagedNextUrl == track.url) return
    Log.d(Soap.TAG, "SetNextAVTransportURI attempt index=$nextIndex title=${track.title}")
    when (current.setNextUri(track)) {
      RendererSession.NextUriResult.ACCEPTED -> {
        nextUriCapability = NextUriCapability.SUPPORTED
        stagedNextIndex = nextIndex
        stagedNextUrl = track.url
        rememberUri(track.url)
        Log.d(Soap.TAG, "SetNextAVTransportURI accepted; next URI staged index=$nextIndex title=${track.title}")
      }
      RendererSession.NextUriResult.UNSUPPORTED -> {
        nextUriCapability = NextUriCapability.UNSUPPORTED
        stagedNextIndex = null
        stagedNextUrl = null
        note("renderer takes no next track in advance; each track is loaded at the end of the last")
      }
      RendererSession.NextUriResult.FAILED ->
        Log.w(Soap.TAG, "SetNextAVTransportURI transient failure index=$nextIndex; playback unchanged")
    }
  }

  /** Takes back a next track handed over in advance, when there is one. */
  private suspend fun dropStagedLocked(current: RendererSession) {
    val hadStaged = stagedNextIndex != null
    stagedNextIndex = null
    stagedNextUrl = null
    if (!hadStaged || nextUriCapability != NextUriCapability.SUPPORTED) return
    when (current.clearNextUri()) {
      RendererSession.NextUriResult.ACCEPTED -> Log.d(Soap.TAG, "Cleared staged next URI")
      RendererSession.NextUriResult.UNSUPPORTED -> nextUriCapability = NextUriCapability.UNSUPPORTED
      RendererSession.NextUriResult.FAILED -> Log.w(Soap.TAG, "Transient failure clearing staged next URI")
    }
  }

  private suspend fun syncNativeQueueLocked(current: RendererSession, request: QueueRequest): Boolean {
    if (request.tracks.isEmpty()) return false
    // The track playing keeps playing: found in the new list by its id, or by
    // its address when it has none, wherever the new order put it.
    val playing = nativeQueue.getOrNull(nativeQueueIndex)
    val kept = playing?.let { old ->
      request.tracks.indexOfFirst { if (old.id != null) it.id == old.id else it.url == old.url }.takeIf { it >= 0 }
    }
    nativeQueue = request.tracks
    nativeQueueIndex = kept ?: request.currentIndex.coerceIn(0, request.tracks.lastIndex)
    nativePlayMode = request.playMode
    nativeQueueManaged = true
    // What was handed over in advance may not be next any more.
    val staged = stagedNextUrl
    stagedNextIndex = null
    stagedNextUrl = null
    Log.d(Soap.TAG, "Native queue updated count=${nativeQueue.size} currentIndex=$nativeQueueIndex title=${trackLabel(nativeQueueIndex)}")
    if (staged != null && nextQueueIndex()?.let { nativeQueue[it].url } == staged) {
      stagedNextIndex = nextQueueIndex()
      stagedNextUrl = staged
    } else {
      if (staged != null) {
        // Marked as staged so the drop below takes it back from the renderer.
        stagedNextIndex = -1
      }
      dropStagedLocked(current)
      stageNextLocked(current)
    }
    return true
  }

  /**
   * Reads one poll of an ordinary renderer against the queue this module
   * keeps, acts on it (the next track, a renderer that moved on by itself,
   * one taken over), and says what the player should show.
   */
  private suspend fun handleGenericStateLocked(current: RendererSession, state: RendererSession.State): String {
    val playback = TrackWatch.normalize(state.playbackState)
    val uri = state.currentUri?.takeIf { it.isNotBlank() && !it.equals("NOT_IMPLEMENTED", ignoreCase = true) }

    // Whether the renderer reports what it plays, learned from what it was
    // just given; and once it is seen playing that, what comes next can be
    // handed over in advance.
    val expected = expectedUri
    if (expected != null && playback == TrackWatch.PLAYING) {
      if (GenericQueueProgression.sameUri(uri, expected)) {
        expectedUri = null
        if (uriTrust == UriTrust.UNKNOWN) {
          uriTrust = UriTrust.TRUSTED
          note("renderer reports what it plays; next tracks are handed over in advance")
        }
        stageNextLocked(current)
      } else if (uriTrust == UriTrust.UNKNOWN || ++echoPolls >= ECHO_POLLS) {
        expectedUri = null
        if (uriTrust != UriTrust.UNTRUSTED) {
          uriTrust = UriTrust.UNTRUSTED
          note("renderer does not report what it plays; each track is loaded at the end of the last")
        }
        dropStagedLocked(current)
      }
    }

    // A renderer that reports what it plays says which track that is: the one
    // handed over in advance once it starts it, or something that is not in
    // this queue at all when another app has taken it over.
    if (uriTrust == UriTrust.TRUSTED && expectedUri == null && uri != null && !transitionInProgress) {
      if (GenericQueueProgression.sameUri(uri, nativeQueue.getOrNull(nativeQueueIndex)?.url)) {
        foreignPolls = 0
      } else {
        val found = indexOfUri(uri)
        if (found != null) {
          foreignPolls = 0
          // Only once it plays. A renderer can move on to the next address and
          // sit there stopped; following it then forgot that anything had
          // played, so nothing ever loaded the track (#285). Left alone, that
          // stop reads as the end of the current one.
          if (playback == TrackWatch.PLAYING) adoptLocked(current, found, state.positionMs)
        } else if (recentUris.none { GenericQueueProgression.sameUri(uri, it) } &&
          (playback == TrackWatch.PLAYING || playback == TrackWatch.PAUSED)
        ) {
          if (++foreignPolls >= FOREIGN_POLLS) {
            lossReason = "replaced"
            return "STOPPED"
          }
        } else {
          foreignPolls = 0
        }
      }
    }

    watch.observe(playback, state.positionMs, state.durationMs)
    if (playback == TrackWatch.PLAYING) {
      stoppedByUs = false
      interrupted = false
    }

    val expectedMs = (nativeQueue.getOrNull(nativeQueueIndex)?.durationSeconds ?: 0) * 1_000L
    when (watch.verdict(playback, expectedMs, stoppedByUs)) {
      TrackWatch.Verdict.ENDED -> {
        if (stagedNextIndex != null) {
          // Its chance to start the next track by itself first.
          if (playback == TrackWatch.STOPPED && watch.stoppedPolls < HANDOFF_GRACE_POLLS) {
            lastPlaybackState = playback
            return "BUFFERING"
          }
          // It took the next track and did nothing with it: from now on it is
          // loaded at the end of each, like on a renderer that takes none.
          nextUriCapability = NextUriCapability.UNSUPPORTED
          stagedNextIndex = null
          stagedNextUrl = null
          note("renderer did not start the next track it was handed; each track is loaded at the end of the last")
        }
        if (playback != TrackWatch.STOPPED) {
          Log.d(Soap.TAG, "Track end read off a clock stuck at ${watch.lastPositionMs} ms ($playback)")
        }
        val advanced = advanceNativeQueueLocked(current, playback)
        // The STOPPED that triggered the load must not count against the new track.
        lastPlaybackState = if (advanced) TrackWatch.TRANSITIONING else playback
        return when {
          advanced -> "BUFFERING"
          endedAtQueueEnd || interrupted -> "STOPPED"
          else -> "BUFFERING"
        }
      }
      TrackWatch.Verdict.INTERRUPTED -> if (!interrupted) {
        interrupted = true
        note("renderer stopped at ${watch.lastPositionMs / 1000} s of ${expectedMs / 1000} s, by nobody here")
      }
      TrackWatch.Verdict.NONE -> Unit
    }
    lastPlaybackState = playback
    return displayFor(playback)
  }

  /** What the player shows for a managed renderer in this state. */
  private fun displayFor(playback: String): String = when (playback) {
    TrackWatch.PLAYING -> if (endedAtQueueEnd) "STOPPED" else "PLAYING"
    TrackWatch.TRANSITIONING -> "BUFFERING"
    TrackWatch.PAUSED -> "PAUSED"
    else -> when {
      transitionInProgress -> "BUFFERING"
      stoppedByUs -> "PAUSED"
      endedAtQueueEnd || interrupted -> "STOPPED"
      // A stop not judged yet: between two tracks, as far as anyone knows.
      watch.observedPlaying -> "BUFFERING"
      System.currentTimeMillis() - loadedAtMs < LOAD_GRACE_MS -> "BUFFERING"
      else -> "STOPPED"
    }
  }

  /** Where in the queue a renderer's address is: the staged track first, then the first after the current one. */
  private fun indexOfUri(uri: String): Int? {
    stagedNextIndex?.let { staged ->
      if (GenericQueueProgression.sameUri(uri, stagedNextUrl)) return staged
    }
    if (nativeQueue.isEmpty()) return null
    for (step in 1..nativeQueue.size) {
      val index = (nativeQueueIndex + step).mod(nativeQueue.size)
      if (GenericQueueProgression.sameUri(uri, nativeQueue[index].url)) return index
    }
    return null
  }

  /** The renderer moved on to `index` by itself: the queue follows it. */
  private suspend fun adoptLocked(current: RendererSession, index: Int, positionMs: Long) {
    nativeQueueIndex = index
    stagedNextIndex = null
    stagedNextUrl = null
    watch.reset(positionMs)
    stoppedByUs = false
    interrupted = false
    endedAtQueueEnd = false
    advanceAttempts = 0
    Log.d(Soap.TAG, "Renderer moved on by itself (TrackURI); native current index changed to $nativeQueueIndex title=${trackLabel(nativeQueueIndex)}")
    stageNextLocked(current)
  }

  private suspend fun advanceNativeQueueLocked(current: RendererSession, playback: String): Boolean {
    val nextIndex = nextQueueIndex()
    if (nextIndex == null) {
      stagedNextIndex = null
      stagedNextUrl = null
      endedAtQueueEnd = true
      watch.settle()
      Log.d(Soap.TAG, "Native queue reached end at index=$nativeQueueIndex")
      // One stuck on the last second is told it is over.
      if (playback != TrackWatch.STOPPED) current.stop()
      return false
    }
    val track = nativeQueue[nextIndex]
    transitionInProgress = true
    stagedNextIndex = null
    stagedNextUrl = null
    advanceAttempts++
    Log.d(Soap.TAG, "Automatic native advancement $nativeQueueIndex -> $nextIndex title=${track.title} attempt=$advanceAttempts")
    // The whole load (a refused URI is tried again after a Stop, #246), on its own.
    val loaded = current.loadQueue(listOf(track), 0, autoplay = true, positionMs = 0, playMode = nativePlayMode)
    transitionInProgress = false
    if (!loaded) {
      Log.w(Soap.TAG, "Automatic native advancement failed targetIndex=$nextIndex attempt=$advanceAttempts")
      // Still a track end, so the next poll tries again (#271); after a few,
      // it is left stopped, and Play tries once more.
      if (advanceAttempts >= MAX_ADVANCE_ATTEMPTS) {
        watch.settle()
        interrupted = true
        note("could not load the next track after $advanceAttempts attempts")
      }
      return false
    }
    nativeQueueIndex = nextIndex
    stoppedByUs = false
    advanceAttempts = 0
    markLoaded(track, 0)
    Log.d(Soap.TAG, "Native current index changed to $nativeQueueIndex title=${track.title}")
    return true
  }

  /**
   * Play on a stopped renderer: the current track handed to it again, where it
   * stopped, or from the start when what stopped was the end of the queue.
   */
  private suspend fun resumeLocked(current: RendererSession): Boolean {
    val track = nativeQueue.getOrNull(nativeQueueIndex) ?: return current.play()
    val positionMs = if (endedAtQueueEnd) 0 else watch.lastPositionMs
    Log.d(Soap.TAG, "Resuming a stopped renderer index=$nativeQueueIndex at $positionMs ms")
    transitionInProgress = true
    val loaded = current.loadQueue(listOf(track), 0, autoplay = true, positionMs = positionMs, playMode = nativePlayMode)
    transitionInProgress = false
    if (loaded) markLoaded(track, positionMs)
    return loaded
  }

  @Synchronized
  private fun keepAwake(on: Boolean) {
    if (!on || session == null) {
      wakeLock?.takeIf { it.isHeld }?.release()
      wifiLock?.takeIf { it.isHeld }?.release()
      return
    }
    val context = appContext.reactContext?.applicationContext ?: return
    try {
      val wake = wakeLock ?: (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "resonus:upnp-cast")
        .apply { setReferenceCounted(false) }
        .also { wakeLock = it }
      // Re-acquiring a non-counted lock only moves its timeout forward.
      wake.acquire(AWAKE_TIMEOUT_MS)
    } catch (e: Exception) {
      Log.w(Soap.TAG, "Could not keep the phone awake for casting", e)
    }
    try {
      // Has no timeout of its own; `keepAwake(false)` on a pause, a stop or a
      // disconnect is what lets it go.
      @Suppress("DEPRECATION")
      val wifi = wifiLock ?: (context.getSystemService(Context.WIFI_SERVICE) as WifiManager)
        .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "resonus:upnp-cast")
        .apply { setReferenceCounted(false) }
        .also { wifiLock = it }
      if (!wifi.isHeld) wifi.acquire()
    } catch (e: Exception) {
      Log.w(Soap.TAG, "Could not keep the Wi-Fi awake for casting", e)
    }
  }

  private fun trackLabel(index: Int): String = nativeQueue.getOrNull(index)?.title.orEmpty()
}
