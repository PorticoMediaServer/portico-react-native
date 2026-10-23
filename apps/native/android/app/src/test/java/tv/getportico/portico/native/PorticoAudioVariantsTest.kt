package tv.getportico.portico.native

import android.media.AudioFormat
import org.junit.Assert.*
import org.junit.Test

class PorticoAudioVariantsTest {
  @Test fun baseTransportDoesNotInventObjectOrLosslessExtensions() {
    val truehd=PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DOLBY_TRUEHD,36)!!
    assertEquals(setOf("truehd"),truehd.variants);assertTrue(truehd.objects.isEmpty())
    val eac3=PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_E_AC3,36)!!
    assertEquals(setOf("eac3"),eac3.variants);assertTrue(eac3.objects.isEmpty())
    assertEquals(setOf("dts_core"),PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DTS,36)!!.variants)
    assertEquals(setOf("dts_hd_hra"),PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DTS_HD,36)!!.variants)
  }

  @Test fun onlyTheSpecificPlatformEncodingsPublishTheExtensions() {
    assertEquals(setOf("eac3","eac3_joc"),PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_E_AC3_JOC,36)!!.variants)
    assertNull(PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DTS_HD_MA,33))
    assertEquals(setOf("dts_hd_ma"),PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DTS_HD_MA,34)!!.variants)
    assertNull(PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DTS_UHD_P1,30))
    assertEquals(setOf("dtsx"),PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DTS_UHD_P1,31)!!.variants)
    assertNull(PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DTS_UHD_P2,33))
    assertEquals(setOf("dtsx"),PorticoAudioVariants.fromEncoding(AudioFormat.ENCODING_DTS_UHD_P2,34)!!.variants)
  }
}
