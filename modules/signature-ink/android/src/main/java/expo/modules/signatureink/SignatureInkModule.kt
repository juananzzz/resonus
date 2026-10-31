package expo.modules.signatureink

import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import androidx.core.graphics.drawable.toBitmap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedRef

class SignatureInkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SignatureInk")

    // Inspect the same bounded, decoded image the view will display. No second
    // request, file or bitmap cache, and no lossy ThumbHash alpha coefficients.
    AsyncFunction("hasVisibleInk") { image: SharedRef<Drawable> ->
      hasVisibleInk(image.ref)
    }
  }
}

internal fun hasVisibleInk(drawable: Drawable): Boolean {
  val width = drawable.intrinsicWidth
  val height = drawable.intrinsicHeight
  require(width > 0 && height > 0 && width.toLong() * height <= 1_000_000) {
    "Signature must be decoded at a bounded size"
  }
  val original = drawable.toBitmap()
  val bitmap = if (original.config == Bitmap.Config.HARDWARE) {
    original.copy(Bitmap.Config.ARGB_8888, false)
  } else original
  try {
    // Row storage bounds the extra allocation; borrowed image pixels stay owned
    // by Expo Image. Uniform opaque, empty AND translucent rectangles fail.
    val row = IntArray(bitmap.width)
    var minAlpha = 255
    var maxAlpha = 0
    for (y in 0 until bitmap.height) {
      bitmap.getPixels(row, 0, bitmap.width, 0, y, bitmap.width, 1)
      for (pixel in row) {
        val alpha = pixel ushr 24
        minAlpha = minOf(minAlpha, alpha)
        maxAlpha = maxOf(maxAlpha, alpha)
        if (minAlpha < maxAlpha) return true
      }
    }
    return false
  } finally {
    if (bitmap !== original) bitmap.recycle()
  }
}
