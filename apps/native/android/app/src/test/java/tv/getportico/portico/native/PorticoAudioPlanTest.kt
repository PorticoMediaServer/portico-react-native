package tv.getportico.portico.native

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The version 2 audio plan as Android reads it (Playback Protocol §18.1): what decodes, what plays, and its gain. */
class PorticoAudioPlanTest {
  private val plan = mapOf(
      "version" to 2.0, "mode" to "direct", "url" to "https://server.example/v1/media/g/a.flac",
      "container" to "flac", "codec" to "flac", "durationFrames" to 441000.0, "sampleRate" to 44100.0)

  @Test
  fun containerPairsAndOptionalDecodersStayBounded() {
    for ((container, codec) in listOf("flac" to "flac", "mp4" to "aac", "m4a" to "aac", "adts" to "aac", "mp3" to "mp3", "ogg" to "opus", "ogg" to "vorbis", "wav" to "pcm_s16le", "mkv" to "flac", "mka" to "flac"))
      assertTrue("$container/$codec", PorticoAudioPlan.decodes(mapOf("container" to container, "codec" to codec)))
    for ((container, codec) in listOf("aiff" to "pcm_s16be", "mkv" to "aac", "wav" to "flac", "ogg" to "truehd"))
      assertFalse("$container/$codec", PorticoAudioPlan.decodes(mapOf("container" to container, "codec" to codec)))
    assertEquals("ALAC needs the actual loaded extension", PorticoFfmpegDecoders.supports("audio/alac"), PorticoAudioPlan.decodes(mapOf("container" to "mp4", "codec" to "alac")))
    assertFalse(PorticoAudioPlan.decodes(mapOf("container" to "flac")))
  }

  @Test
  fun aPlanPlaysOnlyWhenItIsCompleteAndInRange() {
    assertTrue(PorticoAudioPlan.playable(plan))
    assertTrue(PorticoAudioPlan.playable(plan + ("mode" to "converted")))
    assertFalse(PorticoAudioPlan.playable(null))
    assertFalse("another version", PorticoAudioPlan.playable(plan + ("version" to 1.0)))
    assertFalse("an unknown mode", PorticoAudioPlan.playable(plan + ("mode" to "stream")))
    assertFalse("no address", PorticoAudioPlan.playable(plan - "url"))
    assertFalse("a rate below 8 kHz", PorticoAudioPlan.playable(plan + ("sampleRate" to 4000.0)))
    assertFalse("no frames", PorticoAudioPlan.playable(plan + ("durationFrames" to 0.0)))
    assertFalse("part of a frame", PorticoAudioPlan.playable(plan + ("durationFrames" to 1.5)))
    assertFalse("a boolean is not a number", PorticoAudioPlan.playable(plan + ("durationFrames" to true)))
  }

  @Test
  fun gainFollowsTheViewersNormalizationAndNeverClipsThePeak() {
    val track = mapOf("normalization" to "track")
    assertEquals("normalization off", 1f, PorticoAudioPlan.gain(plan + ("gain" to mapOf("trackDb" to -6.0)), mapOf("normalization" to "off")), 0f)
    assertEquals(0.5012f, PorticoAudioPlan.gain(plan + ("gain" to mapOf("trackDb" to -6.0)), track), 0.0001f)
    assertEquals("the preamp adds", 1f, PorticoAudioPlan.gain(plan + ("gain" to mapOf("trackDb" to -6.0)), track + ("preampDb" to 6.0)), 0.0001f)
    assertEquals("amplified only up to the peak", 1f / 0.9f, PorticoAudioPlan.gain(plan + ("gain" to mapOf("trackDb" to 6.0, "trackPeak" to 0.9)), track), 0.0001f)
    assertEquals("no peak known: never above full scale", 1f, PorticoAudioPlan.gain(plan + ("gain" to mapOf("trackDb" to 6.0)), track), 0f)
    val album = mapOf("normalization" to "album")
    assertEquals("album gain, with the track's peak when the album has none", 0.7079f, PorticoAudioPlan.gain(plan + ("gain" to mapOf("trackDb" to -9.0, "albumDb" to -3.0, "trackPeak" to 0.5)), album), 0.0001f)
    assertEquals("album asked, none known: the track's", 0.5012f, PorticoAudioPlan.gain(plan + ("gain" to mapOf("trackDb" to -6.0)), album), 0.0001f)
    assertEquals("no gain in the plan", 1f, PorticoAudioPlan.gain(plan, track), 0f)
    assertEquals("a separate preamp does not erase normalization provenance", 0.5012f,
        PorticoAudioPlan.normalizationGain(plan + ("gain" to mapOf("trackDb" to -6.0)), track + ("preampDb" to 6.0)), 0.0001f)
    assertEquals("user attenuation alone is not normalization", 1f,
        PorticoAudioPlan.normalizationGain(plan + ("gain" to mapOf("trackDb" to 0.0)), track + ("preampDb" to -6.0)), 0f)
  }

  @Test
  fun durationComesFromFramesAndRate() {
    assertEquals(10.0, PorticoAudioPlan.durationSeconds(plan), 0.0)
    assertEquals(0.0, PorticoAudioPlan.durationSeconds(plan - "sampleRate"), 0.0)
    assertEquals(0.0, PorticoAudioPlan.durationSeconds(null), 0.0)
  }
}
