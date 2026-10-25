package tv.getportico.portico.native

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import androidx.media3.common.C

/**
 * What this device can actually play, matched against one music plan.
 *
 * The plan names the sample rate, channel count and (through the decoded file) the source
 * precision. This object intersects those with the routed output device's own advertised
 * profiles. A precision the device does not advertise is never claimed: the sink stays at
 * 16-bit and [Choice.bitPerfect] is false. Only a unity gain that keeps the source encoding
 * and needs no resampling is bit perfect. Nothing here installs a sink, changes a route or
 * touches the server's plan.
 */
internal object PorticoAudioOutput {
  /** One output device's advertised PCM profiles, copied out of [AudioDeviceInfo]. */
  data class Device(val label: String, val encodings: Set<Int>, val sampleRates: Set<Int>, val channelCounts: Set<Int>)

  /**
   * The chosen sink format. [encoding] is what the sink is asked to play; [sourceEncoding] is
   * what the decoder produced. [bitPerfect] is true only for an unchanged unity stream.
   */
  data class Choice(
      val encoding: Int,
      val sourceEncoding: Int,
      val sampleRate: Int,
      val channels: Int,
      val unity: Boolean,
      val device: String,
      val bitPerfect: Boolean,
      val reason: String,
  )

  private val PRECISION = mapOf(
      C.ENCODING_PCM_16BIT to 2,
      C.ENCODING_PCM_24BIT to 3,
      C.ENCODING_PCM_32BIT to 4,
      C.ENCODING_PCM_FLOAT to 4,
  )

  fun bytesPerSample(encoding: Int): Int = PRECISION[encoding] ?: 0

  /** The PCM encodings a listening player may decode. */
  val ENCODINGS: Set<Int> = PRECISION.keys

  /**
   * Intersect one plan with the advertised devices. Pure so the decision is testable away
   * from a real route: the device list is data, not a query.
   *
   * A device keeps 24-bit, 32-bit or float only when it advertises that exact encoding at the
   * plan's rate and channel count. Otherwise the sink plays 16-bit, which every Android output
   * accepts, and the choice says so instead of claiming precision that is lost.
   */
  fun choose(devices: List<Device>, sampleRate: Int, channels: Int, sourceEncoding: Int, unity: Boolean): Choice {
    val source = if (sourceEncoding in PRECISION) sourceEncoding else C.ENCODING_PCM_16BIT
    val sourceBits = bytesPerSample(source)
    val honest = sampleRate > 0 && channels > 0
    if (!honest) return Choice(C.ENCODING_PCM_16BIT, source, 0, 0, unity, "none", false, "no-plan")
    // The source's own encoding first, so an advertised match stays an exact passthrough. Then
    // float (which holds 24-bit integers exactly), then a wider or narrower integer encoding.
    // A precision the source does not have is never invented for a 16-bit stream.
    val candidates = LinkedHashSet<Int>()
    candidates.add(source)
    if (sourceBits > 2) {
      candidates.add(C.ENCODING_PCM_FLOAT)
      candidates.add(C.ENCODING_PCM_32BIT)
      candidates.add(C.ENCODING_PCM_24BIT)
    }
    for (encoding in candidates) {
      val device = devices.firstOrNull {
        encoding in it.encodings && (it.sampleRates.isEmpty() || sampleRate in it.sampleRates) &&
            (it.channelCounts.isEmpty() || channels in it.channelCounts)
      } ?: continue
      val bitPerfect = unity && encoding == source
      return Choice(encoding, source, sampleRate, channels, unity, device.label, bitPerfect,
          if (bitPerfect) "unity-passthrough" else if (encoding == source) "gain-applied" else "device-convert")
    }
    // 16-bit is the universal floor: every output plays it, so it is the honest default when a
    // higher precision is not advertised.
    val route = devices.firstOrNull()
    val floorPerfect = unity && source == C.ENCODING_PCM_16BIT
    return Choice(C.ENCODING_PCM_16BIT, source, sampleRate, channels, unity, route?.label ?: "none", floorPerfect,
        if (sourceBits > 2) "device-16bit-only" else if (floorPerfect) "unity-passthrough" else "gain-applied")
  }

  /** The advertised devices, from the audio service. Empty on a build that cannot report profiles. */
  fun devices(context: Context): List<Device> {
    if (Build.VERSION.SDK_INT < 23) return emptyList()
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return emptyList()
    val outputs = try {
      manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    } catch (_: Exception) {
      return emptyList()
    }
    val listed = outputs.mapNotNull { info ->
      if (info.type == AudioDeviceInfo.TYPE_TELEPHONY) return@mapNotNull null
      val profiles = try {
        info.audioProfiles
      } catch (_: Exception) {
        return@mapNotNull null
      }
      val encodings = HashSet<Int>()
      val rates = HashSet<Int>()
      val channelCounts = HashSet<Int>()
      for (profile in profiles) {
        for (encoding in profile.encodings) encodings.add(encoding)
        for (rate in profile.sampleRates) rates.add(rate)
        for (count in profile.channelCounts) channelCounts.add(count)
      }
      if (encodings.isEmpty()) null else Device("${info.typeName} ${info.productName}".trim(), encodings, rates, channelCounts)
    }
    return listed
  }

  /** True when some routed output advertises float at the formats music uses, so the sink may stay float. */
  fun prefersFloat(context: Context): Boolean =
      devices(context).any { C.ENCODING_PCM_FLOAT in it.encodings && (it.sampleRates.isEmpty() || it.sampleRates.any { rate -> rate in MUSIC_RATES }) }

  private val MUSIC_RATES = setOf(44100, 48000, 88200, 96000, 176400, 192000)
}
