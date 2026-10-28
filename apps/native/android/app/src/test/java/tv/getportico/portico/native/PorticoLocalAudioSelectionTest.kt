package tv.getportico.portico.native

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PorticoLocalAudioSelectionTest {
  private val command = mapOf<String, Any?>("revision" to 1.0, "catalogRevision" to 2.0, "trackId" to "local-audio-2-1")

  @Test
  fun localChoiceRequiresItsExactCatalogueAndCommandRevisions() {
    assertTrue(PorticoLocalAudioSelection.valid(null))
    assertTrue(PorticoLocalAudioSelection.valid(command))
    assertTrue(PorticoLocalAudioSelection.valid(command + mapOf("revision" to 9007199254740991.0)))
    for (key in command.keys) assertFalse(PorticoLocalAudioSelection.valid(command - key))
    assertFalse(PorticoLocalAudioSelection.valid(command + mapOf("streamIndex" to 1)))
    assertFalse(PorticoLocalAudioSelection.valid(emptyList<Any>()))
  }

  @Test
  fun malformedOrUnsafeValuesCannotReachTrackSelection() {
    for (key in listOf("revision", "catalogRevision")) for (value in listOf(null, true, "1", 0, -1, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 9007199254740992.0))
      assertFalse(PorticoLocalAudioSelection.valid(command + mapOf(key to value)))
    for (id in listOf(null, 1, "", "a".repeat(257)))
      assertFalse(PorticoLocalAudioSelection.valid(command + mapOf("trackId" to id)))
  }
}
