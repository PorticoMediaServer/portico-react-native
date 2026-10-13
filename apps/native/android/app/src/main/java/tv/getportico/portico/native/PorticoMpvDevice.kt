package tv.getportico.portico.native

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.hardware.display.DisplayManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.os.Build
import android.os.Bundle
import android.system.Os
import android.view.Display
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import java.io.File
import tv.getportico.portico.TelevisionDisplay

/**
 * What this device gives the mpv engine: which codecs its chip decodes (everything else mpv
 * decodes in software), what its screen and audio output take, and how much memory it has.
 * The engine's options and its capability profile are both built from this.
 */
internal object PorticoMpvDevice {
  /** A hardware decoder's own limits. */
  class Decoder(val maxWidth: Int, val maxHeight: Int, val maxFrameRate: Int, val tenBit: Boolean)

  /** mpv's codec names for the MediaCodec types FFmpeg in this build can drive. */
  private val MEDIACODEC_TYPES = mapOf(
      "video/avc" to "h264", "video/hevc" to "hevc", "video/x-vnd.on2.vp9" to "vp9", "video/av01" to "av1",
      "video/x-vnd.on2.vp8" to "vp8", "video/mpeg2" to "mpeg2video", "video/mp4v-es" to "mpeg4")

  private fun hardware(info: MediaCodecInfo): Boolean =
      if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated
      else info.name.lowercase().let { !it.startsWith("omx.google.") && !it.startsWith("c2.android.") && !it.startsWith("omx.ffmpeg.") && !it.contains(".sw.") }

  private fun tenBit(codec: String, level: CodecProfileLevel): Boolean = when (codec) {
    "h264" -> level.profile == CodecProfileLevel.AVCProfileHigh10
    "hevc" -> level.profile == CodecProfileLevel.HEVCProfileMain10 || level.profile == CodecProfileLevel.HEVCProfileMain10HDR10 || level.profile == CodecProfileLevel.HEVCProfileMain10HDR10Plus
    "vp9" -> level.profile == CodecProfileLevel.VP9Profile2 || level.profile == CodecProfileLevel.VP9Profile2HDR || level.profile == CodecProfileLevel.VP9Profile2HDR10Plus
    "av1" -> level.profile == CodecProfileLevel.AV1ProfileMain10 || level.profile == CodecProfileLevel.AV1ProfileMain10HDR10 || level.profile == CodecProfileLevel.AV1ProfileMain10HDR10Plus
    else -> false
  }

  /**
   * The codecs the chip decodes, by mpv's names, each with the largest picture and rate its
   * decoder reports. A codec with only a software decoder in the system is left out: mpv's own
   * software decoders are the better ones, so those codecs are never sent to MediaCodec.
   */
  val hardwareDecoders: Map<String, Decoder> by lazy {
    val found = LinkedHashMap<String, Decoder>()
    val codecs = try { MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder && hardware(it) } } catch (_: Exception) { emptyList() }
    for (info in codecs) {
      for (type in info.supportedTypes) {
        val codec = MEDIACODEC_TYPES[type.lowercase()] ?: continue
        val capabilities = try { info.getCapabilitiesForType(type) } catch (_: Exception) { continue }
        val video = capabilities.videoCapabilities ?: continue
        val width = video.supportedWidths.upper
        val height = try { video.getSupportedHeightsFor(width).upper } catch (_: Exception) { video.supportedHeights.upper }
        val rate = try { video.getSupportedFrameRatesFor(width, height).upper.toInt() } catch (_: Exception) { video.supportedFrameRates.upper }
        val deep = capabilities.profileLevels.any { tenBit(codec, it) }
        val previous = found[codec]
        if (previous == null || width.toLong() * height > previous.maxWidth.toLong() * previous.maxHeight) {
          found[codec] = Decoder(width, height, rate.coerceIn(1, 960), deep || previous?.tenBit == true)
        } else if (deep && !previous.tenBit) {
          found[codec] = Decoder(previous.maxWidth, previous.maxHeight, previous.maxFrameRate, true)
        }
      }
    }
    found
  }

  val isTelevision: Boolean get() = TelevisionDisplay.isTelevision

  @Volatile private var memory = 0L

  /** The device's memory. It does not change, so it is asked for once. */
  fun memoryBytes(context: Context): Long {
    if (memory > 0) return memory
    val info = ActivityManager.MemoryInfo()
    (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(info)
    memory = info.totalMem
    return memory
  }

  fun display(context: Context): Display? =
      (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.getDisplay(Display.DEFAULT_DISPLAY)

  /** The HDR formats the screen (or the television behind the box) shows: `hdr10`, `hlg`, `dolby_vision`, `hdr10plus`. */
  fun displayHdr(context: Context): Set<String> {
    val display = display(context) ?: return emptySet()
    val types: IntArray? = try {
      if (Build.VERSION.SDK_INT >= 34) display.mode.supportedHdrTypes
      else @Suppress("DEPRECATION") display.hdrCapabilities?.supportedHdrTypes
    } catch (_: Exception) {
      null
    }
    return (types ?: IntArray(0)).toList().mapNotNull { HDR_TYPES[it] }.toSet()
  }

  private val HDR_TYPES = mapOf(1 to "dolby_vision", 2 to "hdr10", 3 to "hlg", 4 to "hdr10plus")

  /** The panel's real size, long side first, and its highest refresh rate. */
  fun screen(context: Context): Triple<Int, Int, Int> {
    val display = display(context)
    val metrics = android.util.DisplayMetrics()
    @Suppress("DEPRECATION") display?.getRealMetrics(metrics)
    var width = maxOf(metrics.widthPixels, metrics.heightPixels)
    var height = minOf(metrics.widthPixels, metrics.heightPixels)
    var rate = display?.refreshRate ?: 0f
    // A television's interface is often 1080p on a 4K panel; the modes say what video may use.
    for (mode in display?.supportedModes ?: emptyArray()) {
      if (mode.physicalWidth.toLong() * mode.physicalHeight > width.toLong() * height) {
        width = maxOf(mode.physicalWidth, mode.physicalHeight)
        height = minOf(mode.physicalWidth, mode.physicalHeight)
      }
      rate = maxOf(rate, mode.refreshRate)
    }
    return Triple(width, height, Math.round(rate))
  }

  private val DIGITAL = setOf(AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC, AudioDeviceInfo.TYPE_HDMI_EARC, AudioDeviceInfo.TYPE_LINE_DIGITAL)
  private val PERSONAL = setOf(
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER, AudioDeviceInfo.TYPE_HEARING_AID,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET)

  /**
   * How many channels the output a new playback would use takes. Headphones and Bluetooth come
   * first, as the system routes to them first. A device that lists no channel counts takes any
   * number: that reads as eight on a digital output and as two elsewhere.
   */
  fun outputChannels(context: Context): Int {
    val outputs = try { (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList() } catch (_: Exception) { emptyList() }
    if (outputs.any { it.type in PERSONAL }) return 2
    val digital = outputs.filter { it.type in DIGITAL }
    if (digital.isNotEmpty()) return digital.maxOf { device -> device.channelCounts.maxOrNull() ?: 8 }.coerceIn(2, 8)
    val other = outputs.maxOfOrNull { device -> device.channelCounts.maxOrNull() ?: 2 } ?: 2
    return other.coerceIn(2, 8)
  }

  /** mpv's `audio-channels` for that many channels: the widest layout first, stereo always last. */
  fun channelLayouts(channels: Int): String = when {
    channels >= 8 -> "7.1,5.1,stereo"
    channels >= 6 -> "5.1,stereo"
    else -> "stereo"
  }
}

/**
 * Whether the app is on screen. A video stops when the app leaves the screen without Picture in
 * Picture (Home on a television, the screen switched off on a phone): both player engines listen
 * here. An activity in a Picture in Picture window is still on screen.
 *
 * Main thread only.
 */
internal object PorticoAppVisibility {
  val listeners = LinkedHashSet<(Boolean) -> Unit>()
  var visible = true
    private set
  private val started = HashSet<Activity>()
  private var installed = false

  fun install(context: Context, current: Activity?) {
    if (installed) return
    val application = context.applicationContext as? Application ?: return
    installed = true
    if (current != null && (current as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) == true) started.add(current)
    application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) { started.add(activity); update() }
      override fun onActivityStopped(activity: Activity) { started.remove(activity); update() }
      override fun onActivityDestroyed(activity: Activity) { started.remove(activity); update() }
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    })
    update()
  }

  private fun update() {
    val next = started.isNotEmpty()
    if (next == visible) return
    visible = next
    listeners.toList().forEach { it(next) }
  }
}

/**
 * The font mpv falls back to for subtitles.
 *
 * mpv's subtitle renderer (libass) has no way to ask Android for fonts in this build, so it is
 * given one font file as its default, in its own configuration folder (`subfont.ttf`), as mpv
 * expects. That file is a link to a font the system already has, chosen by the language of the
 * subtitles about to be drawn: the system's ordinary text face (Latin, Greek, Cyrillic); its
 * Chinese, Japanese and Korean face; or its face for Arabic, Hebrew, Thai, the Indic scripts and
 * the other scripts Android carries a face for. Without this a line in one of those scripts is
 * drawn as empty boxes. A styled subtitle file's own attached fonts are used as usual and are not
 * affected.
 *
 * It is one face at a time. A line that mixes two scripts neither of which is in the chosen face,
 * and a track whose language is not said, are the cases it does not cover: those need a renderer
 * that can ask the system for a fallback face letter by letter (a newer libass has one for
 * Android), which this build of mpv does not carry.
 */
internal object PorticoMpvFonts {
  private val ORDINARY = listOf("Roboto-Regular.ttf", "RobotoStatic-Regular.ttf", "NotoSans-Regular.ttf", "DroidSans.ttf")
  private val EAST_ASIAN = listOf("NotoSansCJK-Regular.ttc", "NotoSansCJKjp-Regular.otf", "NotoSansSC-Regular.otf", "DroidSansFallback.ttf")
  private val EAST_ASIAN_LANGUAGES = setOf("ja", "zh", "ko", "yue", "cmn")

  /** A script, the word its system font files carry in their names, and older names tried first. */
  private class Script(val word: String, val known: List<String> = emptyList())
  private val ARABIC = Script("Arabic", listOf("NotoNaskhArabic-Regular.ttf", "NotoNaskhArabicUI-Regular.ttf", "NotoSansArabic-Regular.ttf", "DroidNaskh-Regular.ttf", "DroidKufi-Regular.ttf"))
  private val HEBREW = Script("Hebrew", listOf("NotoSansHebrew-Regular.ttf", "DroidSansHebrew-Regular.ttf"))
  private val THAI = Script("Thai", listOf("NotoSansThai-Regular.ttf", "NotoSansThaiUI-Regular.ttf", "DroidSansThai.ttf"))
  private val DEVANAGARI = Script("Devanagari", listOf("NotoSansDevanagari-VF.ttf", "NotoSansDevanagari-Regular.otf", "NotoSansDevanagari-Regular.ttf", "DroidSansDevanagari-Regular.ttf"))
  private val BENGALI = Script("Bengali")
  private val TAMIL = Script("Tamil")
  private val TELUGU = Script("Telugu")
  private val KANNADA = Script("Kannada")
  private val MALAYALAM = Script("Malayalam")
  private val GUJARATI = Script("Gujarati")
  private val GURMUKHI = Script("Gurmukhi")
  /** By language, in two-letter codes where the language has one (`PorticoMpvSupport.baseLanguage`). */
  private val SCRIPTS: Map<String, Script> = mapOf(
      "ar" to ARABIC, "ara" to ARABIC, "fa" to ARABIC, "fas" to ARABIC, "per" to ARABIC, "ur" to ARABIC, "urd" to ARABIC, "ps" to ARABIC, "pus" to ARABIC, "sd" to ARABIC, "ug" to ARABIC, "ckb" to ARABIC,
      "he" to HEBREW, "heb" to HEBREW, "iw" to HEBREW, "yi" to HEBREW, "yid" to HEBREW,
      "th" to THAI, "tha" to THAI,
      "hi" to DEVANAGARI, "hin" to DEVANAGARI, "mr" to DEVANAGARI, "mar" to DEVANAGARI, "ne" to DEVANAGARI, "nep" to DEVANAGARI, "sa" to DEVANAGARI, "san" to DEVANAGARI,
      "bn" to BENGALI, "ben" to BENGALI, "as" to BENGALI, "asm" to BENGALI,
      "ta" to TAMIL, "tam" to TAMIL, "te" to TELUGU, "tel" to TELUGU, "kn" to KANNADA, "kan" to KANNADA, "ml" to MALAYALAM, "mal" to MALAYALAM,
      "gu" to GUJARATI, "guj" to GUJARATI, "pa" to GURMUKHI, "pan" to GURMUKHI,
      "si" to Script("Sinhala"), "sin" to Script("Sinhala"), "km" to Script("Khmer"), "khm" to Script("Khmer"), "lo" to Script("Lao"), "lao" to Script("Lao"),
      "my" to Script("Myanmar"), "mya" to Script("Myanmar"), "bur" to Script("Myanmar"), "hy" to Script("Armenian"), "hye" to Script("Armenian"), "arm" to Script("Armenian"),
      "ka" to Script("Georgian"), "kat" to Script("Georgian"), "geo" to Script("Georgian"), "am" to Script("Ethiopic"), "amh" to Script("Ethiopic"), "ti" to Script("Ethiopic"))
  private var linked: String? = null
  private var listing: List<File>? = null

  /** mpv's configuration folder. It holds nothing but the font link; mpv reads no settings from it. */
  fun configDirectory(context: Context): File = File(context.noBackupFilesDir, "mpv")

  private fun systemFont(names: List<String>): File? {
    for (name in names) File("/system/fonts", name).let { if (it.isFile && it.canRead()) return it }
    return null
  }

  private fun systemFonts(): List<File> = listing ?: (try {
    File("/system/fonts").listFiles()?.filter { it.isFile && it.canRead() && (it.name.endsWith(".ttf") || it.name.endsWith(".otf") || it.name.endsWith(".ttc")) }?.sortedBy { it.name }
  } catch (_: Exception) { null } ?: emptyList()).also { listing = it }

  private fun ordinary(): File? = systemFont(ORDINARY)
      ?: systemFonts().filter { it.name.endsWith(".ttf") && it.length() in 1..8_000_000 }.minByOrNull { it.name }

  /**
   * The system's face for a script: a name known from Android's releases, else the plainest file
   * whose name carries the script's word (a regular or variable weight; a sans face before a
   * serif one; the reading face before the one drawn for interface labels).
   */
  private fun scriptFont(script: Script): File? = systemFont(script.known) ?: systemFonts()
      .filter { it.name.contains(script.word) && (it.name.contains("Regular") || it.name.contains("-VF")) }
      .minByOrNull { (if (it.name.contains("Serif")) 4 else 0) + (if (it.name.contains("UI")) 2 else 0) + (if (it.name.contains("-VF")) 1 else 0) }

  /**
   * Points the default font at the face for [language] (a subtitle track's language tag, or
   * null). Call before mpv starts drawing a track: the file is read when the track is opened.
   */
  fun select(context: Context, language: String?) {
    val base = PorticoMpvSupport.baseLanguage((language ?: "").lowercase())
    val wanted = (if (base in EAST_ASIAN_LANGUAGES) systemFont(EAST_ASIAN) else SCRIPTS[base]?.let { scriptFont(it) }) ?: ordinary() ?: return
    if (linked == wanted.path) return
    val directory = configDirectory(context)
    val link = File(directory, "subfont.ttf")
    try {
      directory.mkdirs()
      link.delete()
      Os.symlink(wanted.path, link.path)
      linked = wanted.path
    } catch (_: Exception) {
      // No link could be made: a copy of the face does (a large font is not copied).
      try {
        val source = if (wanted.length() <= 8_000_000) wanted else ordinary()
        if (source != null) {
          link.delete()
          source.copyTo(link, overwrite = true)
          linked = source.path
        }
      } catch (_: Exception) {}
    }
  }
}
