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

  fun memoryBytes(context: Context): Long {
    val info = ActivityManager.MemoryInfo()
    (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(info)
    return info.totalMem
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
      override fun onActivityDestroyed(activity: Activity) { started.remove(activity) }
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    })
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
 * expects. That file is a link to a font the system already has: the system's ordinary text face,
 * or its Chinese, Japanese and Korean face when the chosen subtitles are in one of those
 * languages (it also covers Latin, Greek and Cyrillic). A styled subtitle file's own attached
 * fonts are used as usual and are not affected.
 */
internal object PorticoMpvFonts {
  private val ORDINARY = listOf("Roboto-Regular.ttf", "RobotoStatic-Regular.ttf", "NotoSans-Regular.ttf", "DroidSans.ttf")
  private val EAST_ASIAN = listOf("NotoSansCJK-Regular.ttc", "NotoSansCJKjp-Regular.otf", "NotoSansSC-Regular.otf", "DroidSansFallback.ttf")
  private val EAST_ASIAN_LANGUAGES = setOf("ja", "zh", "ko", "yue", "cmn")
  private var linked: String? = null

  /** mpv's configuration folder. It holds nothing but the font link; mpv reads no settings from it. */
  fun configDirectory(context: Context): File = File(context.noBackupFilesDir, "mpv")

  private fun systemFont(names: List<String>): File? {
    for (name in names) File("/system/fonts", name).let { if (it.isFile && it.canRead()) return it }
    return null
  }

  private fun ordinary(): File? = systemFont(ORDINARY)
      ?: try { File("/system/fonts").listFiles()?.filter { it.isFile && it.name.endsWith(".ttf") && it.length() in 1..8_000_000 }?.minByOrNull { it.name } } catch (_: Exception) { null }

  /**
   * Points the default font at the face for [language] (a subtitle track's language tag, or
   * null). Call before mpv starts drawing a track: the file is read when the track is opened.
   */
  fun select(context: Context, language: String?) {
    val base = PorticoMpvSupport.baseLanguage((language ?: "").lowercase())
    val wanted = (if (base in EAST_ASIAN_LANGUAGES) systemFont(EAST_ASIAN) else null) ?: ordinary() ?: return
    if (linked == wanted.path) return
    val directory = configDirectory(context)
    val link = File(directory, "subfont.ttf")
    try {
      directory.mkdirs()
      link.delete()
      Os.symlink(wanted.path, link.path)
      linked = wanted.path
    } catch (_: Exception) {
      // No link could be made: a copy of the ordinary face does (a large font is not copied).
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
