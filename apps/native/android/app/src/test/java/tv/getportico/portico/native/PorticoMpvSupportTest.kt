package tv.getportico.portico.native

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** The mpv engine's rules that need no libmpv and no device: values, track matching, languages, caption style. */
class PorticoMpvSupportTest {
  private val support = PorticoMpvSupport

  @Test
  fun valuesFromJavaScriptAreTakenOnlyAsWhatTheyAre() {
    assertEquals(true, support.boolean(true))
    assertNull(support.boolean(1))
    assertEquals(2.0, support.number(2)!!, 0.0)
    assertNull(support.number(Double.NaN))
    assertNull(support.number("2"))
    assertEquals(3L, support.integer(3.0))
    assertNull("below the minimum", support.integer(0.0))
    assertEquals(0L, support.integer(0.0, 0.0))
    assertNull("not whole", support.integer(1.5))
    assertNull("past 2^53-1", support.integer(9007199254740992.0))
    assertNull(support.integer(true))
  }

  @Test
  fun aNewerGenerationOfTheSamePlaybackIsAReplanNotAStaleCommand() {
    val bound = mapOf("lease" to "L", "intentId" to 1.0, "sessionId" to "s", "generation" to 1.0, "itemId" to "i")
    // A subtitle or quality change: the server's next presentation of the same session.
    assertTrue(support.replannedInPlace(bound, bound + ("generation" to 2.0)))
    assertFalse("the same generation", support.replannedInPlace(bound, bound))
    assertFalse("an older generation", support.replannedInPlace(bound + ("generation" to 2.0), bound))
    assertFalse("another session", support.replannedInPlace(bound, bound + mapOf("generation" to 2.0, "sessionId" to "t")))
    assertFalse("another title", support.replannedInPlace(bound, bound + mapOf("generation" to 2.0, "itemId" to "j")))
    assertFalse("another intent", support.replannedInPlace(bound, bound + mapOf("generation" to 2.0, "intentId" to 2.0)))
    assertFalse("another lease", support.replannedInPlace(bound, bound + mapOf("generation" to 2.0, "lease" to "M")))
    assertFalse("not a whole number", support.replannedInPlace(bound, bound + ("generation" to 2.5)))
  }

  @Test
  fun renditionsMapByStreamIndexThenNameThenPosition() {
    val audio = listOf(mapOf("id" to 1, "ff-index" to 1), mapOf("id" to 2, "ff-index" to 2))
    assertEquals(mapOf("a" to 1, "b" to 2), support.mapRenditions(listOf(mapOf("id" to "a", "streamIndex" to 1.0), mapOf("id" to "b", "streamIndex" to 2.0)), audio))

    val named = listOf(mapOf("id" to 5, "title" to "French"), mapOf("id" to 6, "metadata" to mapOf("comment" to "English")))
    assertEquals(mapOf("en" to 6, "fr" to 5), support.mapRenditions(listOf(mapOf("id" to "en", "name" to "English"), mapOf("id" to "fr", "name" to "French")), named))

    // Nothing to match by: the order is trusted only when the counts agree.
    assertEquals(mapOf("x" to 3, "y" to 4), support.mapRenditions(listOf(mapOf("id" to "x"), mapOf("id" to "y")), listOf(mapOf("id" to 3), mapOf("id" to 4))))
    assertNull(support.mapRenditions(listOf(mapOf("id" to "x")), listOf(mapOf("id" to 1), mapOf("id" to 2))))

    // Two renditions that would take one track fall back to position.
    val one = listOf(mapOf("id" to 1, "title" to "English"), mapOf("id" to 2, "title" to "Commentary"))
    assertEquals(mapOf("a" to 1, "b" to 2), support.mapRenditions(listOf(mapOf("id" to "a", "name" to "English"), mapOf("id" to "b", "name" to "English")), one))
  }

  @Test
  fun renditionsThatCannotBeTrustedMapNothing() {
    val audio = listOf(mapOf("id" to 1), mapOf("id" to 2))
    assertNull("none", support.mapRenditions(emptyList(), audio))
    assertNull("a repeated id", support.mapRenditions(listOf(mapOf("id" to "a"), mapOf("id" to "a")), audio))
    assertNull("an empty id", support.mapRenditions(listOf(mapOf("id" to ""), mapOf("id" to "b")), audio))
    assertNull("too many", support.mapRenditions((0..64).map { mapOf("id" to "r$it") }, audio))
  }

  private val subtitles = listOf(
      mapOf("id" to 1, "codec" to "subrip", "ff-index" to 2, "lang" to "eng"),
      mapOf("id" to 2, "codec" to "hdmv_pgs_subtitle", "ff-index" to 3, "lang" to "en"),
      mapOf("id" to 3, "codec" to "ass", "ff-index" to 4, "lang" to "fre", "title" to "Signs"),
      mapOf("id" to 4, "codec" to "ASS", "ff-index" to 5, "lang" to "fr", "title" to "Full"),
      mapOf("id" to 5, "codec" to "subrip", "external" to true, "lang" to "en"))

  @Test
  fun anEmbeddedSubtitleIsFoundByIndexOrdinalOrLanguage() {
    assertEquals(2, support.embeddedSubtitle(mapOf("streamIndex" to 3.0), "pgs", subtitles))
    assertEquals(1, support.embeddedSubtitle(mapOf("ordinal" to 0.0), "text", subtitles))
    assertEquals("two-letter and three-letter codes agree", 1, support.embeddedSubtitle(mapOf("language" to "en"), "text", subtitles))
    assertEquals("the title settles a shared language", 4, support.embeddedSubtitle(mapOf("language" to "fr", "title" to "full"), "ass", subtitles))
  }

  @Test
  fun anEmbeddedSubtitleThatIsNotExactlyOneTrackIsNone() {
    assertNull("another kind at that index", support.embeddedSubtitle(mapOf("streamIndex" to 3.0), "text", subtitles))
    assertNull("the ordinal names another kind", support.embeddedSubtitle(mapOf("ordinal" to 1.0), "text", subtitles))
    assertNull("two tracks share the language", support.embeddedSubtitle(mapOf("language" to "fr"), "ass", subtitles))
    assertNull("an unknown kind", support.embeddedSubtitle(mapOf("language" to "en"), "teletext", subtitles))
    assertNull("an external file is not inside the media", support.embeddedSubtitle(mapOf("ordinal" to 4.0), "text", subtitles))
  }

  @Test
  fun languagesCompareByTheirBase() {
    assertEquals("en", support.baseLanguage("en-us"))
    assertEquals("de", support.baseLanguage("ger"))
    assertEquals("pt", support.baseLanguage("pt_br"))
    assertEquals("xx", support.baseLanguage("xx"))
  }

  @Test
  fun tracksAndNames() {
    val all = listOf(mapOf("type" to "video", "albumart" to true), mapOf("type" to "audio", "id" to 1))
    assertFalse("cover art is not video", support.hasVideo(all))
    assertTrue(support.hasVideo(all + mapOf("type" to "video")))
    assertEquals(1, support.tracks(all, "audio").size)
    assertEquals(listOf("Main", "English"), support.names(mapOf("title" to "Main", "metadata" to mapOf("COMMENT" to "English", "language" to "en"))))
    assertEquals(emptyList<String>(), support.names(mapOf("title" to "")))
  }

  @Test
  fun captionStyleIsBoundedAndHasDefaults() {
    assertEquals(2.0, support.styleScale(mapOf("scale" to 2.0)), 0.0)
    assertEquals("out of range", 1.0, support.styleScale(mapOf("scale" to 4.0)), 0.0)
    assertEquals(1.0, support.styleScale(null), 0.0)
    assertEquals("opaque", support.styleBackground(mapOf("background" to "opaque")))
    assertEquals("none", support.styleBackground(mapOf("background" to "none")))
    assertEquals("translucent", support.styleBackground(mapOf("background" to "bright")))
    assertEquals("translucent", support.styleBackground(null))
  }

  @Test
  fun explicitSystemCaptionPreferenceDoesNotBorrowAnEnabledDeviceStyle() {
    assertFalse(support.usesSystemCaptionStyle(mapOf("useSystemCaptionStyle" to false), true))
    assertTrue(support.usesSystemCaptionStyle(mapOf("useSystemCaptionStyle" to true), false))
    assertTrue(support.usesSystemCaptionStyle(null, true))
    assertFalse(support.usesSystemCaptionStyle(null, false))
  }

  @Test
  fun assFileStylingIsExplicitAndCannotLeakIntoAnotherTrack() {
    val styled = mapOf("keepStyling" to true, "scale" to 1.6, "color" to "yellow", "position" to "top")
    assertEquals("preserve script styles with size scaling", "scale", support.captionAssOverride(styled, "ass"))
    assertEquals(1.6, support.styleScale(styled), 0.0)
    assertEquals("strip", support.captionAssOverride(mapOf("keepStyling" to false), "ass"))
    for (kind in listOf("pgs", "vobsub", "dvb", "text", "ssa", null)) {
      assertEquals("scale", support.captionAssOverride(mapOf("keepStyling" to false), kind))
      assertEquals("scale", support.captionAssOverride(mapOf("keepStyling" to true), kind))
    }
    for (style in listOf(null, emptyMap<String, Any>(), mapOf("keepStyling" to "false"), mapOf("keepStyling" to 0)))
      assertEquals("legacy or malformed command", "scale", support.captionAssOverride(style, "ass"))
    assertEquals("switching back restores script styling with scaling", "scale", support.captionAssOverride(mapOf("keepStyling" to true), "ass"))
  }

  @Test
  fun actualCaptionPositionRetainsAuthoredTopAndUsesOnePaneFraction() {
    assertTrue(support.captionAtTop(mapOf("position" to "top"), false))
    assertTrue(support.captionAtTop(mapOf("position" to "bottom"), true))
    assertFalse(support.captionAtTop(mapOf("position" to "raised"), false))
    assertEquals(.20f, support.captionBottomInset(mapOf("position" to "raised")), 0f)
    assertEquals(.08f, support.captionBottomInset(mapOf("position" to "bottom")), 0f)
    assertEquals(.08f, support.captionBottomInset(null), 0f)
  }

  @Test
  fun canonicalPlainCaptionColoursAreExactAndUnknownStaysWhite() {
    val colours = mapOf("white" to 0xffffffff.toInt(), "yellow" to 0xffffff00.toInt(), "cyan" to 0xff00ffff.toInt(), "green" to 0xff00ff00.toInt(), "pink" to 0xffff80bf.toInt())
    for ((name, colour) in colours) assertEquals(colour, support.captionForeground(mapOf("color" to name)))
    assertEquals(0xffffffff.toInt(), support.captionForeground(null))
    assertEquals(0xffffffff.toInt(), support.captionForeground(mapOf("color" to "#123456")))
  }

  @Test
  fun actualCaptionFacesPreserveSystemPriorityAndNeverInventRoundedSupport() {
    val ordinary = Any(); val serif = Any(); val mono = Any(); val system = Any()
    assertSame(serif, support.captionTypeface(mapOf("font" to "serif"), null, ordinary, serif, mono))
    assertSame(mono, support.captionTypeface(mapOf("font" to "mono"), null, ordinary, serif, mono))
    assertSame(ordinary, support.captionTypeface(null, null, ordinary, serif, mono))
    for (font in listOf("default", "rounded", "file:///unknown.ttf"))
      assertSame(ordinary, support.captionTypeface(mapOf("font" to font), null, ordinary, serif, mono))
    for (font in listOf("default", "serif", "mono", "rounded"))
      assertSame(system, support.captionTypeface(mapOf("font" to font), system, ordinary, serif, mono))
  }

  @Test
  fun mpvProfileEdgesClearTheirBoxAndRestoreOnTheNextChoice() {
    val softBox = 0xb3000000.toInt()
    val outline = support.mpvCaptionEdges(mapOf("background" to "outline", "useSystemCaptionStyle" to false), softBox)
    assertEquals(0, outline.backColor); assertFalse(outline.boxed); assertEquals(3, outline.outline); assertEquals(0, outline.shadow)
    val shadow = support.mpvCaptionEdges(mapOf("background" to "shadow", "useSystemCaptionStyle" to false), softBox)
    assertEquals(0xff000000.toInt(), shadow.backColor); assertFalse(shadow.boxed); assertEquals(0, shadow.outline); assertEquals(2, shadow.shadow)
    for ((choice, box) in mapOf("translucent" to softBox, "opaque" to 0xff000000.toInt(), "unknown" to softBox)) {
      val restored = support.mpvCaptionEdges(mapOf("background" to choice, "useSystemCaptionStyle" to false), box)
      assertEquals(box, restored.backColor); assertTrue(restored.boxed); assertEquals(0, restored.outline); assertEquals(0, restored.shadow)
    }
    for (system in listOf(true, null)) {
      val retained = support.mpvCaptionEdges(mapOf("background" to "shadow", "useSystemCaptionStyle" to system), softBox)
      assertEquals(softBox, retained.backColor); assertTrue(retained.boxed); assertEquals(0, retained.outline); assertEquals(0, retained.shadow)
    }
    val oldTransparent = support.mpvCaptionEdges(null, 0)
    assertEquals(0, oldTransparent.backColor); assertFalse(oldTransparent.boxed); assertEquals(3, oldTransparent.outline); assertEquals(0, oldTransparent.shadow)
  }

  @Test
  fun numbersForMpvUseThePointWhateverTheLanguage() {
    val before = java.util.Locale.getDefault()
    try {
      java.util.Locale.setDefault(java.util.Locale.GERMANY)
      assertEquals("0.500", support.decimal(0.5))
      assertEquals("0.33", support.decimal(1.0 / 3, 2))
    } finally { java.util.Locale.setDefault(before) }
  }
}
