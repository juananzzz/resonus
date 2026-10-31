package expo.modules.signatureink

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SignatureInkTest {
  @Test fun actualDaddyAssetSurvivesWhiteAndDarkTint() {
    for (name in listOf("daddy-yankee.png")) {
      val bitmap = javaClass.classLoader!!.getResourceAsStream(name).use {
        BitmapFactory.decodeStream(requireNotNull(it))
      }
      try {
        for (tint in listOf(Color.WHITE, Color.BLACK)) {
          val drawable = BitmapDrawable(Resources.getSystem(), bitmap).mutate()
          drawable.setTint(tint)
          assertTrue("$name tint=$tint", hasVisibleInk(drawable))
        }
      } finally { bitmap.recycle() }
    }
  }

  @Test fun rejectsOpaqueEmptyAndUniformTranslucentRectangles() {
    for (alpha in listOf(0, 1, 12, 128, 254, 255)) {
      val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
      try {
        bitmap.eraseColor(Color.argb(alpha, 255, 255, 255))
        assertFalse("alpha=$alpha", hasVisibleInk(BitmapDrawable(Resources.getSystem(), bitmap)))
      } finally { bitmap.recycle() }
    }
  }

  @Test fun acceptsFineInkEvenWhenLowFrequencyHashWouldRoundItAway() {
    val bitmap = Bitmap.createBitmap(256, 128, Bitmap.Config.ARGB_8888)
    try {
      for (x in 16 until 240 step 4) bitmap.setPixel(x, 64, Color.BLACK)
      assertTrue(hasVisibleInk(BitmapDrawable(Resources.getSystem(), bitmap)))
    } finally { bitmap.recycle() }
  }

  @Test(expected = IllegalArgumentException::class)
  fun boundsNativeAllocation() {
    val bitmap = Bitmap.createBitmap(1001, 1000, Bitmap.Config.ARGB_8888)
    try { hasVisibleInk(BitmapDrawable(Resources.getSystem(), bitmap)) }
    finally { bitmap.recycle() }
  }
}
