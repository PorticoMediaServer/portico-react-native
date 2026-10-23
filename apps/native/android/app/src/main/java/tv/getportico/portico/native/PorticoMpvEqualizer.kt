package tv.getportico.portico.native

/** The fallback engine consumes the same ten-band state; no independent EQ or presets. */
internal object PorticoMpvEqualizer {
  fun filter(eq: PorticoPcmDsp.Eq): String {
    if (!eq.enabled) return ""
    val stages = mutableListOf("volume=volume=${decimal(eq.preampDb)}dB:precision=double")
    eq.bands.forEachIndexed { band, gain ->
      stages.add("equalizer=f=${decimal(PorticoPcmDsp.CENTRES[band])}:t=q:w=1.4142135623730951:g=${decimal(gain)}:precision=f64")
    }
    return "lavfi=[${stages.joinToString(",")}]"
  }
  private fun decimal(value: Double) = java.lang.Double.toString(value)
}
