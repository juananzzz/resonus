package expo.modules.upnpcast

import com.yinnho.upnpcast.DLNACast
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Puente Expo ↔ UPnPCast (DLNA/UPnP). Descubre renderers en la red local y
 * controla la reproducción por AVTransport. Como UPnP no empuja eventos de
 * forma fiable, el estado/progreso se sondea cada segundo mientras hay
 * conexión y se emite a JS con el evento "state".
 */
class UpnpCastModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var pollJob: Job? = null

  /** Aparatos vistos en la última búsqueda, por id (para conectar por id). */
  private var devices: Map<String, DLNACast.Device> = emptyMap()
  private var current: DLNACast.Device? = null

  override fun definition() = ModuleDefinition {
    Name("UpnpCast")

    Events("state")

    OnCreate {
      appContext.reactContext?.applicationContext?.let { DLNACast.init(it) }
    }

    OnDestroy {
      pollJob?.cancel()
      runCatching { DLNACast.cleanup() }
      scope.cancel()
    }

    /** Busca renderers en la red; resuelve con la lista al agotar el timeout. */
    AsyncFunction("search") { timeoutMs: Double, promise: Promise ->
      scope.launch {
        val found = runCatching { DLNACast.search(timeoutMs.toLong()) }.getOrDefault(emptyList())
        devices = devices + found.associateBy { it.id }
        promise.resolve(
          found.map {
            mapOf("id" to it.id, "name" to it.name, "address" to it.address, "isTV" to it.isTV)
          },
        )
      }
    }

    AsyncFunction("connect") { deviceId: String, promise: Promise ->
      val device = devices[deviceId]
      if (device == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      current = device
      startPolling()
      promise.resolve(true)
    }

    /**
     * Carga una URL en el renderer conectado. El renderer siempre arranca
     * reproduciendo; con startMs > 0 se busca esa posición nada más empezar.
     */
    AsyncFunction("load") { url: String, title: String, startMs: Double, promise: Promise ->
      val device = current
      if (device == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      scope.launch {
        val ok = runCatching { DLNACast.castToDevice(device, url, title) }.getOrDefault(false)
        if (ok && startMs > 0) {
          delay(800)
          runCatching { DLNACast.seek(startMs.toLong()) }
        }
        promise.resolve(ok)
      }
    }

    AsyncFunction("play") { promise: Promise ->
      scope.launch { promise.resolve(runCatching { DLNACast.play() }.getOrDefault(false)) }
    }

    AsyncFunction("pause") { promise: Promise ->
      scope.launch { promise.resolve(runCatching { DLNACast.pause() }.getOrDefault(false)) }
    }

    AsyncFunction("seek") { positionMs: Double, promise: Promise ->
      scope.launch {
        promise.resolve(runCatching { DLNACast.seek(positionMs.toLong()) }.getOrDefault(false))
      }
    }

    /** Volumen del renderer, 0..100. */
    AsyncFunction("setVolume") { volume: Int, promise: Promise ->
      scope.launch {
        promise.resolve(runCatching { DLNACast.setVolume(volume) }.getOrDefault(false))
      }
    }

    AsyncFunction("disconnect") { promise: Promise ->
      pollJob?.cancel()
      pollJob = null
      current = null
      scope.launch {
        runCatching { DLNACast.stop() }
        promise.resolve(true)
      }
    }
  }

  private fun startPolling() {
    pollJob?.cancel()
    pollJob = scope.launch {
      while (isActive) {
        val state = runCatching { DLNACast.getState() }.getOrNull()
        val progress = runCatching { DLNACast.getProgressRealtime() }.getOrNull()
        if (state != null) {
          sendEvent(
            "state",
            mapOf(
              "playbackState" to state.playbackState.name,
              "positionMs" to (progress?.first ?: 0L).toDouble(),
              "durationMs" to (progress?.second ?: 0L).toDouble(),
            ),
          )
        }
        delay(1000)
      }
    }
  }
}
