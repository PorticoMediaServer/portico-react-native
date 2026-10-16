package tv.getportico.portico.native

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The subtitle font rules that need no device: which scripts a line holds, and a face's family name as libass reads it. */
class PorticoMpvFontsTest {
  @Test
  fun everyScriptTheOrdinaryFaceDoesNotDrawIsFoundMostLettersFirst() {
    assertTrue(PorticoMpvFonts.scriptsOf("Hello, Привет, Γειά 123").isEmpty())
    assertEquals(listOf(Character.UnicodeScript.ARABIC), PorticoMpvFonts.scriptsOf("مرحبا John"))
    assertEquals(listOf(Character.UnicodeScript.HEBREW, Character.UnicodeScript.ARABIC), PorticoMpvFonts.scriptsOf("שלום עולם مرحبا"))
    // Chinese, Japanese and Korean count as one: one face draws them all.
    assertEquals(listOf(Character.UnicodeScript.HAN), PorticoMpvFonts.scriptsOf("東京へようこそ 서울"))
    assertEquals(Character.UnicodeScript.ARABIC, PorticoMpvFonts.scriptOf("Hi مرحبا"))
  }

  @Test
  fun theFamilyNameIsTheWindowsEnglishNameOfTheFirstFace() {
    val font = File.createTempFile("face", ".ttf")
    try {
      font.writeBytes(sfnt(listOf(Triple(1, 0, "Mac Name"), Triple(3, 0x40C, "Nom"), Triple(3, 0x409, "Roboto"))))
      assertEquals("Roboto", PorticoMpvFonts.familyName(font))
      font.writeBytes(sfnt(listOf(Triple(3, 0x40C, "Nom"))))
      assertEquals("another language's name when there is no English one", "Nom", PorticoMpvFonts.familyName(font))
      font.writeBytes(sfnt(listOf(Triple(1, 0, "Mac Name"))))
      assertNull("only a Mac name: libass does not read it either", PorticoMpvFonts.familyName(font))
      font.writeBytes(ByteArray(40) { 0x7f })
      assertNull(PorticoMpvFonts.familyName(font))
      font.writeBytes(ByteArray(3))
      assertNull(PorticoMpvFonts.familyName(font))
    } finally {
      font.delete()
    }
  }

  /** A font file with one table, `name`, holding family names (ID 1) as (platform, language, text). */
  private fun sfnt(names: List<Triple<Int, Int, String>>): ByteArray {
    val strings = ByteArrayOutputStream()
    val records = ByteArrayOutputStream()
    DataOutputStream(records).use { out ->
      for ((platform, language, text) in names) {
        val bytes = if (platform == 3) text.toByteArray(Charsets.UTF_16BE) else text.toByteArray(Charsets.ISO_8859_1)
        out.writeShort(platform); out.writeShort(if (platform == 3) 1 else 0); out.writeShort(language); out.writeShort(1)
        out.writeShort(bytes.size); out.writeShort(strings.size())
        strings.write(bytes)
      }
    }
    val table = ByteArrayOutputStream()
    DataOutputStream(table).use { out ->
      out.writeShort(0); out.writeShort(names.size); out.writeShort(6 + names.size * 12)
      out.write(records.toByteArray()); out.write(strings.toByteArray())
    }
    val file = ByteArrayOutputStream()
    DataOutputStream(file).use { out ->
      out.writeInt(0x00010000); out.writeShort(1); out.writeShort(16); out.writeShort(0); out.writeShort(0)
      out.writeInt(0x6e616d65); out.writeInt(0); out.writeInt(28); out.writeInt(table.size())
      out.write(table.toByteArray())
    }
    return file.toByteArray()
  }
}
