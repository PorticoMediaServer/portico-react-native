package tv.getportico.portico.native

import org.junit.Assert.*
import org.junit.Test

class PorticoSubtitleTimingTest {
  @Test fun originalFileCorrectionIsCompleteAndNeverAddedToPlanAgain() {
    assertEquals(250_000L, PorticoSubtitleTiming.offsetUs(mapOf("timeDomain" to "source-relative", "offsetMs" to 250), "250000"))
    assertEquals(-125_000L, PorticoSubtitleTiming.offsetUs(mapOf("offsetMs" to -125), "-125000"))
    assertEquals(0L, PorticoSubtitleTiming.offsetUs(mapOf("offsetMs" to 0), "500000"))
  }
  @Test fun onlyAbsentFileCorrectionFallsBackToPlan() {
    assertEquals(250_000L, PorticoSubtitleTiming.offsetUs(emptyMap<String, Any>(), "250000"))
    assertEquals(0L, PorticoSubtitleTiming.offsetUs(emptyMap<String, Any>(), null))
    assertNull(PorticoSubtitleTiming.offsetUs(mapOf("offsetMs" to "250"), "250000"))
    assertNull(PorticoSubtitleTiming.offsetUs(mapOf("offsetMs" to null), "250000"))
  }
  @Test fun invalidTimingCannotEnterRichOverlayClock() {
    assertNull(PorticoSubtitleTiming.offsetUs(mapOf("timeDomain" to "presentation-relative", "offsetMs" to 0), null))
    assertNull(PorticoSubtitleTiming.offsetUs(mapOf("offsetMs" to Double.NaN), null))
    assertNull(PorticoSubtitleTiming.offsetUs(mapOf("offsetMs" to Double.POSITIVE_INFINITY), null))
    assertNull(PorticoSubtitleTiming.offsetUs(mapOf("offsetMs" to 86_400_001), null))
    assertNull(PorticoSubtitleTiming.offsetUs(emptyMap<String, Any>(), "garbage"))
    assertNull(PorticoSubtitleTiming.offsetUs(emptyMap<String, Any>(), "600000001"))
  }
}
