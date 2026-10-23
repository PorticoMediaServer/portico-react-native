package tv.getportico.portico.native

/** Original ASS/bitmap timing uses the complete selection correction exactly once.
 * External WebVTT is server-timed and does not enter this rich-overlay path. */
internal object PorticoSubtitleTiming {
  fun offsetUs(render: Map<*, *>, planOffsetUs: String?): Long? {
    if (render["timeDomain"]?.let { it != "source-relative" } == true) return null
    if (render.containsKey("offsetMs")) {
      val milliseconds = (render["offsetMs"] as? Number)?.toDouble() ?: return null
      if (!milliseconds.isFinite() || kotlin.math.abs(milliseconds) > 86_400_000) return null
      return (milliseconds * 1000).toLong()
    }
    val fallback = if (planOffsetUs == null) 0L else planOffsetUs.toLongOrNull() ?: return null
    return fallback.takeIf { it in -600_000_000..600_000_000 }
  }
}
