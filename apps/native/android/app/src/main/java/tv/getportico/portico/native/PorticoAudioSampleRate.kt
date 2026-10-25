package tv.getportico.portico.native

import android.content.Context
import android.media.AudioManager

/**
 * Match sample rate (music-plus 14, 23 Oct ruling: Smart, Strict or Off), this device's own
 * engine value. Reviewable WIP for Media: it resolves the rate the audio session should open at
 * from the routed output's real capabilities, and reports a match only when the opened session
 * actually runs at the source's rate.
 *
 * Off: the route's own preferred rate, whatever the file is.
 * Smart: the file's rate when the routed device lists it, else the route's preferred rate.
 * Strict: the file's rate; when the route cannot take it the request is reported as unmatched
 * rather than resampled silently.
 *
 * Nothing here claims a match: [facts] answers only from the rates the platform reports.
 */
object PorticoAudioSampleRate {
  const val SMART = "smart"
  const val STRICT = "strict"
  const val OFF = "off"

  data class Choice(val requestedRate: Int, val accepted: Boolean, val reason: String)

  fun parse(mode: String?): String =
      when (mode?.trim()?.lowercase()) {
        STRICT -> STRICT
        OFF -> OFF
        else -> SMART
      }

  /** Rates the routed sink itself reports, highest first. Empty means "unknown", not "none". */
  fun routeRates(context: Context): List<Int> {
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return emptyList()
    val native = manager.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull() ?: 0
    return if (native > 0) listOf(native) else emptyList()
  }

  fun choose(mode: String, sourceRate: Int, routeRates: List<Int>): Choice {
    val preferred = routeRates.firstOrNull() ?: 0
    if (sourceRate <= 0) return Choice(preferred, false, "source-rate-unknown")
    return when (parse(mode)) {
      OFF -> Choice(preferred, preferred > 0 && preferred == sourceRate, if (preferred > 0) "route" else "route-unknown")
      STRICT -> if (routeRates.isEmpty() || routeRates.contains(sourceRate))
        Choice(sourceRate, true, "file")
      else Choice(sourceRate, false, "route-cannot-take-file-rate")
      else -> if (routeRates.isEmpty() || routeRates.contains(sourceRate))
        Choice(sourceRate, true, "file")
      else Choice(preferred, preferred > 0 && preferred == sourceRate, "route")
    }
  }

  /** Observed facts for the bridge and the signal path. `matched` is only ever equality. */
  fun facts(context: Context, mode: String, sourceRate: Int, openedRate: Int): Map<String, Any> {
    val route = routeRates(context)
    return mapOf(
        "sampleRateMatching" to parse(mode),
        "requestedRate" to sourceRate,
        "routeRate" to (route.firstOrNull() ?: 0),
        "outputRate" to openedRate,
        "sampleRateMatched" to (sourceRate > 0 && openedRate > 0 && sourceRate == openedRate),
    )
  }
}
