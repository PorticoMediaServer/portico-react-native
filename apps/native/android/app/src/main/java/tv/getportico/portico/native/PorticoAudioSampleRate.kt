package tv.getportico.portico.native

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioTrack

/**
 * Match sample rate (music-plus 14, 23 Oct ruling: Smart, Strict or Off): this device's own
 * engine value. Reviewable WIP for Media, not a capability claim.
 *
 * Facts, kept separate so nothing is promoted:
 * - The **routed** device is the one the audio session actually opened on
 *   (`AudioTrack.getRoutedDevice()`), never AudioManager's preferred/optimal properties. Its
 *   `getSampleRates()` is empty on devices that accept arbitrary rates, which is *support
 *   unspecified*, not "no rates"; and a routed device that cannot be read is *unknown*, not
 *   arbitrary.
 * - The platform's preferred rate (`PROPERTY_OUTPUT_SAMPLE_RATE`) is reported as a separate
 *   configured/preferred fact, never as the routed device's support.
 * - This object holds no opened rate. The sink's PorticoAudioTrackOutput carries the actual
 *   original decoded-source/control/track/route association. AudioTrack.sampleRate is configured
 *   track rate, not measured physical DAC rate. Only the exact admitted API34 USB mixer readback
 *   supplies a framework matching/bit-perfect observation; no process-global rate supplies one.
 *
 * Smart: the file's rate when the routed device lists it or the route is unknown, the device's
 * preferred rate only when the route is known and lacks the file's rate.
 * Strict: the file's rate; refused only when the routed device's own list is known and lacks it.
 * Off: the device's preferred rate, whatever the file is.
 *
 * This file holds the decision and the reported facts; the sink itself is configured by
 * [PorticoRateStage] inside the media3 adapter; PorticoAudioTrackOutput owns opened observations.
 */
object PorticoAudioSampleRate {
  const val SMART = "smart"
  const val STRICT = "strict"
  const val OFF = "off"

  /** The listener's chosen mode. The sink's request rate and the rate the track it opened actually
   * runs at are deliberately not recorded here: this object is process-global, and both facts belong
   * to one owner, item, mode and route. Recording them without that association would let a
   * preloaded or just-replaced sink stamp the audible item, so the reported output stays unknown. */
  @Volatile var mode: String = SMART

  /** What the routed device says about itself. Unknown and arbitrary are different facts. */
  data class RouteFacts(
      val deviceId: Int,
      val deviceType: Int,
      val deviceName: String?,
      val sampleRates: List<Int>,
      val ratesKnown: Boolean,
      val preferredSampleRate: Int,
  ) {
    /** Known list that is empty: the device accepts arbitrary rates (AudioDeviceInfo docs). */
    val ratesArbitrary: Boolean get() = ratesKnown && sampleRates.isEmpty()
  }

  /** A decision about what to open, split so a valid fallback cannot be read as a refusal. */
  data class Decision(
      val requestedSampleRate: Int,
      /** The sink may open at [requestedSampleRate]. */
      val canOpen: Boolean,
      /** Strict only: the routed device is known and cannot take the file's rate. */
      val refused: Boolean,
      val reason: String,
  )

  fun parse(mode: String?): String =
      when (mode?.trim()?.lowercase()) {
        STRICT -> STRICT
        OFF -> OFF
        else -> SMART
      }

  private fun preferredRate(context: Context): Int {
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return 0
    return manager.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull() ?: 0
  }

  /** The routed device the session actually opened on; null means the route is unknown. */
  fun routeFacts(context: Context, routed: AudioDeviceInfo?): RouteFacts {
    val preferred = preferredRate(context)
    if (routed == null) return RouteFacts(-1, 0, null, emptyList(), ratesKnown = false, preferredSampleRate = preferred)
    val rates = routed.sampleRates?.toList()?.filter { it > 0 }.orEmpty()
    return RouteFacts(routed.id, routed.type, routed.productName?.toString(), rates, ratesKnown = true, preferredSampleRate = preferred)
  }

  /** A routed device read from the live track after it opened. */
  fun routedDevice(track: AudioTrack?): AudioDeviceInfo? =
      try {track?.routedDevice} catch (_: Throwable) {null}

  fun decide(mode: String, sourceRate: Int, route: RouteFacts): Decision {
    val parsed = parse(mode)
    val takesFile = route.ratesKnown && route.sampleRates.isNotEmpty() && sourceRate > 0 && route.sampleRates.contains(sourceRate)
    val cannotTakeFile = route.ratesKnown && route.sampleRates.isNotEmpty() && sourceRate > 0 && !route.sampleRates.contains(sourceRate)
    val preferred = route.preferredSampleRate
    return when (parsed) {
      OFF -> if (preferred > 0) Decision(preferred, true, false, "preferred")
             else if (sourceRate > 0) Decision(sourceRate, true, false, "preferred-unknown")
             else Decision(0, false, false, "no-rate-known")
      STRICT -> when {
        sourceRate <= 0 -> Decision(0, false, false, "source-rate-unknown")
        cannotTakeFile -> Decision(sourceRate, false, true, "route-cannot-take-file-rate")
        else -> Decision(sourceRate, true, false, if (takesFile) "file" else "file-route-unspecified")
      }
      else -> when {
        sourceRate <= 0 -> Decision(preferred, preferred > 0, false, "source-rate-unknown")
        route.ratesKnown && (route.ratesArbitrary || takesFile) -> Decision(sourceRate, true, false, "file")
        route.ratesKnown && cannotTakeFile && preferred > 0 -> Decision(preferred, true, false, "preferred")
        route.ratesKnown && cannotTakeFile -> Decision(sourceRate, true, false, "preferred-unknown")
        else -> Decision(sourceRate, true, false, "route-unknown")
      }
    }
  }

  /** Unbound baseline only. The owner overlays a current original-source-bound sink snapshot;
   * absent that proof, opened rate and implementation remain explicitly unknown. */
  fun facts(context: Context, mode: String, sourceRate: Int, routed: AudioDeviceInfo?, openedSampleRate: Int): Map<String, Any> {
    val opened = openedSampleRate
    val route = routeFacts(context, routed)
    return mapOf(
        "sampleRateMatching" to parse(mode),
        "requestedSampleRate" to sourceRate,
        "outputSampleRate" to opened,
        "routeDeviceId" to route.deviceId,
        "routeDeviceType" to route.deviceType,
        "routeDeviceName" to (route.deviceName ?: ""),
        "routeSampleRates" to route.sampleRates,
        "routeRatesKnown" to route.ratesKnown,
        "routeRatesArbitrary" to route.ratesArbitrary,
        "preferredSampleRate" to route.preferredSampleRate,
        "openedSampleRateKnown" to (opened > 0),
        "modeImplemented" to false,
        "sampleRateMatched" to (sourceRate > 0 && opened > 0 && sourceRate == opened),
    )
  }
}
