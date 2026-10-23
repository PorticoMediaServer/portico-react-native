package tv.getportico.portico.native

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

/** Sample-domain processing shared by the sink and the JVM conformance tests. */
internal class PorticoPcmDsp {
  enum class Encoding(val bytes: Int) { S16(2), S24(3), S32(4), FLOAT(4) }
  data class Eq(val enabled: Boolean = false, val preampDb: Double = 0.0, val bands: List<Double> = List(10) { 0.0 }) {
    init { require(validGain(preampDb) && bands.size == 10 && bands.all(::validGain)) }
    companion object {
      private fun validGain(value: Double) = value.isFinite() && value in -12.0..12.0 && value * 2 == floor(value * 2)
    }
  }
  @Volatile var outputStatus: Map<String,Any?> = emptyMap()
  @Volatile var target = 1.0
  @Volatile var eq = Eq()
  private var applied = Eq()
  /** The settings used for the last processed buffer, rather than a later control update. */
  val processedEqualizer: Eq get() = applied
  private var filters = emptyArray<Array<Biquad>>()
  private var channels = 0
  private var rate = 0
  private var level = 1.0
  private var goal = 1.0
  private var ramp = 0
  private var step = 0.0

  val transparent: Boolean get() = target == 1.0 && !eq.enabled && level == 1.0

  fun configure(sampleRate: Int, channelCount: Int) {
    require(sampleRate in 8000..768000 && channelCount in 1..32)
    rate = sampleRate; channels = channelCount; rebuild(); reset()
  }

  fun reset() { level = target; goal = target; ramp = 0; filters.forEach { it.forEach(Biquad::reset) } }

  private fun rebuild() {
    applied = eq
    filters = Array(channels) { Array(10) { band -> Biquad.peak(rate, CENTRES[band], applied.bands[band]) } }
  }

  /** Off/unity copies the original bytes, including the low eight bits of 24-bit PCM. */
  fun process(input: ByteBuffer, encoding: Encoding): ByteBuffer {
    require(channels > 0 && input.remaining() % (channels * encoding.bytes) == 0)
    input.order(ByteOrder.LITTLE_ENDIAN)
    val output = ByteBuffer.allocateDirect(input.remaining()).order(ByteOrder.LITTLE_ENDIAN)
    if (eq != applied) rebuild()
    val wanted = target.takeIf { it.isFinite() }?.coerceIn(0.0, 32.0) ?: 1.0
    if (wanted != goal) { goal = wanted; ramp = max(1, rate / 50); step = (goal - level) / ramp }
    if (!applied.enabled && ramp == 0 && level == 1.0) { output.put(input); output.flip(); return output }
    val preamp = if (applied.enabled) 10.0.pow(applied.preampDb / 20.0) else 1.0
    while (input.hasRemaining()) {
      if (ramp > 0) { level += step; if (--ramp == 0) level = goal }
      repeat(channels) { channel ->
        var value = read(input, encoding) * level * preamp
        if (applied.enabled) for (filter in filters[channel]) value = filter.process(value)
        write(output, encoding, value)
      }
    }
    output.flip(); return output
  }

  internal class Biquad(private val b0: Double, private val b1: Double, private val b2: Double, private val a1: Double, private val a2: Double) {
    private var z1 = 0.0; private var z2 = 0.0
    fun process(x: Double): Double { val y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y }
    fun reset() { z1 = 0.0; z2 = 0.0 }
    companion object {
      // RBJ peaking EQ, Q=sqrt(2), one octave bands. Above Nyquist is an identity filter.
      fun peak(rate: Int, frequency: Double, db: Double): Biquad {
        if (db == 0.0 || frequency >= rate * 0.49) return Biquad(1.0, 0.0, 0.0, 0.0, 0.0)
        val a = 10.0.pow(db / 40.0); val w = 2 * PI * frequency / rate
        val alpha = sin(w) / (2 * sqrt(2.0)); val a0 = 1 + alpha / a
        return Biquad((1 + alpha * a) / a0, -2 * cos(w) / a0, (1 - alpha * a) / a0, -2 * cos(w) / a0, (1 - alpha / a) / a0)
      }
    }
  }

  companion object {
    val CENTRES = listOf(31.25, 62.5, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)
    fun read(b: ByteBuffer, e: Encoding): Double = when (e) {
      Encoding.S16 -> b.short / 32768.0
      Encoding.S24 -> { val v = (b.get().toInt() and 255) or ((b.get().toInt() and 255) shl 8) or (b.get().toInt() shl 16); v / 8388608.0 }
      Encoding.S32 -> b.int / 2147483648.0
      Encoding.FLOAT -> b.float.toDouble().takeIf { it.isFinite() } ?: 0.0
    }
    fun write(b: ByteBuffer, e: Encoding, sample: Double) {
      val x = sample.takeIf { it.isFinite() }?.coerceIn(-1.0, 1.0) ?: 0.0
      when (e) {
        Encoding.S16 -> b.putShort((x * 32768).roundToLong().coerceIn(-32768, 32767).toShort())
        Encoding.S24 -> { val v = (x * 8388608).roundToLong().coerceIn(-8388608, 8388607).toInt(); b.put(v.toByte()); b.put((v shr 8).toByte()); b.put((v shr 16).toByte()) }
        Encoding.S32 -> b.putInt((x * 2147483648).roundToLong().coerceIn(-2147483648L, 2147483647L).toInt())
        Encoding.FLOAT -> b.putFloat(x.toFloat())
      }
    }
  }
}
