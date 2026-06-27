// Adaptado de wavio (github.com/Joel-Mercier/wavio, MIT) para Resonus.
package expo.modules.carauto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.media3.common.MediaMetadata
import java.io.ByteArrayOutputStream

/**
 * Puente de carátulas para Android Auto. El host de AA dibuja las carátulas en
 * su *propio* proceso: puede descargar una artworkUri http(s) por su cuenta,
 * pero NO puede leer nuestras carátulas file:// privadas de la app. Para los
 * ficheros locales decodificamos + reescalamos el bitmap en proceso y enviamos
 * los bytes JPEG vía setArtworkData, que viaja por el binder para que el host la
 * dibuje sin acceso al sistema de archivos. Las URLs remotas siguen usando
 * setArtworkUri (pequeñas, las descarga el host).
 *
 * Los bytes se mantienen pequeños (máx 320px, JPEG q80 → ~20-40KB) y se cachean
 * por ruta para que ítems de álbum/cola que comparten carátula se decodifiquen
 * una sola vez. `apply` devuelve el nº de bytes embebidos (0 para uri/ninguna)
 * para que quien llama acote una transacción binder — ver el guard de JsProxyPlayer.
 */
internal object CarArtwork {
  private const val MAX_DIM = 320
  private const val QUALITY = 80
  private val cache = object : LruCache<String, ByteArray>(8 * 1024 * 1024) {
    override fun sizeOf(key: String, value: ByteArray): Int = value.size
  }

  /**
   * Pone la carátula en [builder]. Si [embed] es false, el fichero local nunca
   * se decodifica — se usa la uri tal cual — para que quien llama pueda acotar
   * cuánta carátula embebe por transacción. Devuelve el nº de bytes embebidos.
   */
  fun apply(builder: MediaMetadata.Builder, artworkUrl: String?, embed: Boolean = true): Int {
    if (artworkUrl == null) return 0
    val bytes = if (embed) localArtworkData(artworkUrl) else null
    if (bytes != null) {
      builder.setArtworkData(bytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
      return bytes.size
    }
    builder.setArtworkUri(Uri.parse(artworkUrl))
    return 0
  }

  private fun localArtworkData(uri: String): ByteArray? {
    if (!uri.startsWith("file://")) return null
    val path = Uri.parse(uri).path ?: return null
    cache.get(path)?.let { return it }
    return runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      val opts = BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
      }
      val bmp = BitmapFactory.decodeFile(path, opts) ?: return null
      val out = ByteArrayOutputStream()
      bmp.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
      bmp.recycle()
      out.toByteArray().also { cache.put(path, it) }
    }.getOrNull()
  }

  // Mayor submuestreo potencia-de-dos que mantenga ambas dimensiones >= MAX_DIM.
  private fun sampleSize(width: Int, height: Int): Int {
    var sample = 1
    var w = width
    var h = height
    while (w / 2 >= MAX_DIM && h / 2 >= MAX_DIM) {
      w /= 2
      h /= 2
      sample *= 2
    }
    return sample
  }
}
