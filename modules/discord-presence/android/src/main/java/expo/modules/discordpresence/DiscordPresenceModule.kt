package expo.modules.discordpresence

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Process
import com.discord.socialsdk.rpc.IDiscordRpcCallback
import com.discord.socialsdk.rpc.IDiscordRpcConnection
import com.discord.socialsdk.rpc.IDiscordRpcService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * The song playing, shown on the user's Discord profile through the Discord
 * app on the same phone: the binder service its Social SDK talks to, as worked
 * out by antisocialcord (see THIRD_PARTY_NOTICES.md). No account or token goes
 * through here, only an application id.
 *
 * Connects on the first activity, sends what is pending once Discord says it
 * is ready, and lets go a minute after the activity clears. Everything runs on
 * the main thread; binder callbacks are posted to it.
 */
class DiscordPresenceModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var appId: Long? = null
  private var bound = false
  private var ready = false
  private var connection: IDiscordRpcConnection? = null
  /** The latest frame not yet sent: an older one is never worth sending. */
  private var pending: String? = null
  private val release = Runnable { disconnect() }
  private val giveUp = Runnable { if (!ready) disconnect() }

  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("DiscordPresence")

    Function("isInstalled") { context?.let { serviceIntent(it) } != null }

    Function("setActivity") { id: String, activity: Map<String, Any?> ->
      val frame = frame(activity)
      main.post { set(id.toLongOrNull(), frame) }
    }

    Function("clear") {
      main.post { clear() }
    }

    OnDestroy {
      main.post { disconnect() }
    }
  }

  private fun set(id: Long?, frame: String) {
    if (id == null) return
    main.removeCallbacks(release)
    if (appId != null && appId != id) disconnect()
    appId = id
    pending = frame
    flush()
  }

  private fun clear() {
    pending = null
    if (ready) send(frame(null))
    // Not keeping Discord bound for nothing while paused.
    main.removeCallbacks(release)
    main.postDelayed(release, RELEASE_AFTER_MS)
  }

  private fun flush() {
    val frame = pending ?: return
    if (ready) {
      if (send(frame)) pending = null
    } else {
      connect()
    }
  }

  private fun send(frame: String): Boolean =
    try {
      connection?.sendFrame(frame)
      connection != null
    } catch (_: Exception) {
      false
    }

  private fun connect() {
    if (bound) return
    val ctx = context ?: return
    val intent = serviceIntent(ctx) ?: return
    bound =
      try {
        ctx.bindService(intent, service, Context.BIND_AUTO_CREATE)
      } catch (_: SecurityException) {
        false
      }
    if (!bound) return
    main.removeCallbacks(giveUp)
    main.postDelayed(giveUp, CONNECT_TIMEOUT_MS)
  }

  private fun disconnect() {
    main.removeCallbacks(giveUp)
    main.removeCallbacks(release)
    runCatching { connection?.disconnect() }
    connection = null
    ready = false
    if (bound) {
      runCatching { context?.unbindService(service) }
      bound = false
    }
  }

  private val service =
    object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        main.post {
          val id = appId
          val rpc = IDiscordRpcService.Stub.asInterface(binder)
          connection = if (id == null) null else runCatching { rpc.connect(id, RPC_VERSION, callback) }.getOrNull()
          if (connection == null) disconnect()
        }
      }

      override fun onServiceDisconnected(name: ComponentName?) {
        // Still bound: Android brings it back and Discord says READY again.
        main.post {
          connection = null
          ready = false
        }
      }
    }

  private val callback =
    object : IDiscordRpcCallback.Stub() {
      override fun onFrame(str: String?) {
        val json = runCatching { JSONObject(str ?: return) }.getOrNull() ?: return
        if (json.optString("cmd") == "DISPATCH" && json.optString("evt") == "READY") {
          main.post {
            ready = true
            main.removeCallbacks(giveUp)
            flush()
          }
        }
      }

      override fun onClose(i: Int, str: String?) {
        main.post { disconnect() }
      }
    }

  private fun serviceIntent(ctx: Context): Intent? =
    DISCORD_PACKAGES.map { Intent(SERVICE_ACTION).setPackage(it) }
      .firstOrNull { ctx.packageManager.resolveService(it, 0) != null }

  /** A SET_ACTIVITY frame; a null activity clears it. */
  private fun frame(a: Map<String, Any?>?): String {
    val activity =
      a?.let {
        JSONObject().apply {
          put("name", field(it["name"]) ?: "Resonus")
          put("type", LISTENING)
          // The profile says "Listening to <title>" instead of the app's name.
          put("status_display_type", DISPLAY_DETAILS)
          field(it["title"])?.let { v -> put("details", v) }
          field(it["artist"])?.let { v -> put("state", v) }
          val start = (it["start"] as? Number)?.toLong()
          val end = (it["end"] as? Number)?.toLong()
          if (start != null && end != null) put("timestamps", JSONObject().put("start", start).put("end", end))
          val image = field(it["image"])
          val album = field(it["album"])
          if (image != null || album != null) {
            put(
              "assets",
              JSONObject().apply {
                image?.let { v -> put("large_image", v) }
                album?.let { v -> put("large_text", v) }
              },
            )
          }
        }
      }
    val args = JSONObject().put("pid", Process.myPid()).put("activity", activity ?: JSONObject.NULL)
    return JSONObject().put("cmd", "SET_ACTIVITY").put("args", args).toString()
  }

  /** Discord takes 2 to 128 characters. */
  private fun field(v: Any?): String? {
    val s = (v as? String)?.trim().orEmpty()
    if (s.isEmpty()) return null
    return s.padEnd(2, ' ').take(128)
  }

  private companion object {
    const val SERVICE_ACTION = "com.discord.socialsdk.rpc.IDiscordRpcService"
    /** The official app first, then the client mods antisocialcord knows of. */
    val DISCORD_PACKAGES = listOf("com.discord", "app.revenge", "cocobo1.pupu.app")
    const val RPC_VERSION = "1"
    const val LISTENING = 2
    const val DISPLAY_DETAILS = 2
    const val CONNECT_TIMEOUT_MS = 15_000L
    const val RELEASE_AFTER_MS = 60_000L
  }
}
