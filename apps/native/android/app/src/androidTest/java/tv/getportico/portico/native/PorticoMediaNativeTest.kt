package tv.getportico.portico.native

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import androidx.media3.common.MimeTypes
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class PorticoMediaNativeTest {
  private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
  private fun fixture(name: String): File = File(instrumentation.targetContext.cacheDir,"r29-$name").also { file -> instrumentation.context.assets.open(name).use { input -> file.outputStream().use(input::copyTo) } }
  @Test fun compiledFfmpegActuallyContainsTheRequiredAudioDecoders() {
    for(mime in listOf("audio/true-hd","audio/vnd.dts","audio/vnd.dts.hd","audio/ac3","audio/eac3","audio/alac","audio/flac","audio/opus")) assertTrue(mime,PorticoFfmpegDecoders.supports(mime))
    for(mime in listOf(MimeTypes.AUDIO_AC4,MimeTypes.AUDIO_DTS_EXPRESS)) assertTrue(mime,PorticoFfmpegDecoders.supports(mime))
    assertFalse(PorticoFfmpegDecoders.supports("audio/not-a-codec"))
  }
  @Test fun generatedPgsIsClockedCroppedAndClearedByItsOwnComposition() {
    assertTrue(PorticoSubtitleNative.available)
    val file=fixture("generated.sup");val bitmap=Bitmap.createBitmap(1280,720,Bitmap.Config.ARGB_8888)
    val handle=PorticoSubtitleNative.create("pgs",file.path,emptyArray());assertTrue(handle!=0L)
    try {
      assertTrue(PorticoSubtitleNative.render(handle,500_000,bitmap,1280,720));assertEquals(0,bitmap.getPixel(20,20))
      assertTrue(PorticoSubtitleNative.render(handle,1_100_000,bitmap,1280,720));assertTrue(android.graphics.Color.alpha(bitmap.getPixel(20,20))>250);assertEquals(0,bitmap.getPixel(19,20));assertEquals(0,bitmap.getPixel(30,20))
      assertTrue(PorticoSubtitleNative.render(handle,2_100_000,bitmap,1280,720));assertEquals(0,bitmap.getPixel(20,20))
      assertTrue(PorticoSubtitleNative.render(handle,1_100_000,bitmap,1280,720));assertTrue(android.graphics.Color.alpha(bitmap.getPixel(20,20))>250)
    } finally { PorticoSubtitleNative.destroy(handle);bitmap.recycle();file.delete() }
  }
  @Test fun libassLoadsAttachedFontAndAnimatesOnThePlaybackClock() {
    val file=fixture("animated.ass");val font=File(instrumentation.targetContext.cacheDir,"r29-Manrope.ttf")
    instrumentation.targetContext.assets.open("fonts/Manrope-Regular.ttf").use { input -> font.outputStream().use(input::copyTo) }
    val bitmap=Bitmap.createBitmap(1280,720,Bitmap.Config.ARGB_8888);val pixels=IntArray(1280*720)
    val handle=PorticoSubtitleNative.create("ass",file.path,arrayOf(font.path));assertTrue(handle!=0L)
    try {
      assertTrue(PorticoSubtitleNative.render(handle,700_000,bitmap,1280,720));bitmap.getPixels(pixels,0,1280,0,0,1280,720);val first=pixels.contentHashCode();assertTrue(pixels.any { it!=0 })
      assertTrue(PorticoSubtitleNative.render(handle,1_700_000,bitmap,1280,720));bitmap.getPixels(pixels,0,1280,0,0,1280,720);assertNotEquals(first,pixels.contentHashCode())
      assertTrue(PorticoSubtitleNative.render(handle,3_000_000,bitmap,1280,720));bitmap.getPixels(pixels,0,1280,0,0,1280,720);assertTrue(pixels.all { it==0 })
    } finally { PorticoSubtitleNative.destroy(handle);bitmap.recycle();file.delete();font.delete() }
  }
}
