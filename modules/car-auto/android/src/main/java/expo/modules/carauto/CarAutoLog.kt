// Adaptado de wavio (github.com/Joel-Mercier/wavio, MIT) para Resonus.
package expo.modules.carauto

import android.util.Log

/**
 * Punto único de logcat para el módulo de Android Auto. Las llamadas pasan por
 * aquí para poder activar/desactivar el trazado verboso sin tocar cada sitio.
 * Pon `verbose = true` mientras depuras el flujo de browse/play.
 */
object CarAutoLog {
  private const val TAG = "CarAuto"
  var verbose: Boolean = false

  fun d(msg: String) {
    if (verbose) Log.d(TAG, msg)
  }

  fun w(msg: String, t: Throwable? = null) {
    if (t != null) Log.w(TAG, msg, t) else Log.w(TAG, msg)
  }
}
