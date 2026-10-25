package tv.getportico.portico.native

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor

/**
 * The music sink's rate stage (Smart/Strict/Off, music-plus 14). Reviewable engine WIP.
 *
 * Owns the two things the withdrawn Sonic path got wrong: frames are copied out of the incoming
 * buffer immediately, so no retry can see a different object or an unconverted buffer, and the
 * output is retained until the delegate accepts it, with the tail drained at end of stream.
 * Resampling is linear, at the target encoding our gain already produced; no encoding is ever
 * reinterpreted.
 *
 * Modes: Off opens at this device's preferred rate; Strict always at the file's rate (its route
 * refusal is a caller fact, not a silent fallback); Smart at the file's rate when the routed
 * device is known to take it, else the preferred rate.
 */
internal class PorticoRateStage(private val emit: (ByteBuffer, Long, Int) -> Boolean = { _, _, _ -> true }) {
  private var sourceRate = 0
  private var targetRate = 0
  private var channels = 0
  private var encoding = 0
  private var frame = 0
  private var position = 0.0
  private var pendingFrames = FloatArray(0)
  private var pendingCount = 0
  private var retained: ByteBuffer? = null
  private var tail: ByteBuffer? = null
  private var tailTime = 0L
  private var tailCount = 0
  private var lastTime = 0L
  private var lastCount = 0
  private var ended = false

  val openedRate: Int get() = targetRate
  val resampling: Boolean get() = sourceRate > 0 && targetRate > 0 && sourceRate != targetRate

  fun configure(sourceRate: Int, channels: Int, encoding: Int, mode: String, preferredRate: Int, fileRate: Int, routeTakesFile: Boolean?): Int {
    require(sourceRate > 0 && channels > 0 && PorticoAudioOutput.supports(encoding)) { "unsupported rate stage format" }
    this.sourceRate = sourceRate; this.channels = channels; this.encoding = encoding
    this.frame = PorticoAudioOutput.bytesPerSample(encoding) * channels
    targetRate = when (PorticoAudioSampleRate.parse(mode)) {
      PorticoAudioSampleRate.OFF -> if (preferredRate > 0) preferredRate else sourceRate
      PorticoAudioSampleRate.STRICT -> fileRate.takeIf { it > 0 } ?: sourceRate
      // Smart: the file's rate when the route takes it or the route is unknown (never a guess
      // that the preferred rate is supported); the preferred rate only on a known refusal.
      else -> when {
        fileRate <= 0 -> sourceRate
        routeTakesFile == false -> if (preferredRate > 0) preferredRate else fileRate
        else -> fileRate
      }
    }
    position = 0.0; pendingCount = 0; retained = null; ended = false
    return targetRate
  }

  /** Feed one decoder buffer; returns the retained output the delegate must accept. */
  fun process(input: ByteBuffer, presentationTimeUs: Long, count: Int): ByteBuffer {
    lastTime = presentationTimeUs; lastCount = count
    retained?.let { return it }
    if (!resampling) return input
    copy(input)
    return produce()
  }

  /** The delegate accepted [buffer]; a retained tail is retired only once, here. */
  fun accepted(buffer: ByteBuffer? = null) {
    if (buffer !== null && buffer === tail) {tail = null; ended = true}
    retained = null
  }

  fun flush() {pendingCount = 0; position = 0.0; retained = null; ended = false}

  fun reset() {flush(); sourceRate = 0; targetRate = 0; channels = 0; encoding = 0}

  /** The end-of-stream tail, or null. It keeps its identity, time and count until the delegate
   * accepts it; only then does the stream count as ended. */
  fun takeTail(): ByteBuffer? {
    if (!resampling) {ended = true; return null}
    tail?.let { return it }
    if (ended) return null
    val produced = produce(true)
    if (!produced.hasRemaining()) {ended = true; return null}
    tail = produced; tailTime = lastTime; tailCount = lastCount
    return produced
  }

  fun tailTimeUs(): Long = tailTime
  fun tailCountBuffers(): Int = tailCount

  private fun copy(input: ByteBuffer) {
    val source = input.duplicate().order(ByteOrder.nativeOrder())
    val frames = if (frame > 0) source.remaining() / frame else 0
    if (frames <= 0) return
    val needed = (pendingCount + frames) * channels
    if (needed > pendingFrames.size) {
      val grown = FloatArray(maxOf(needed, pendingFrames.size * 2, 1024))
      System.arraycopy(pendingFrames, 0, grown, 0, pendingCount); pendingFrames = grown
    }
    repeat(frames) { for (channel in 0 until channels) pendingFrames[(pendingCount + it) * channels + channel] = read(source) }
    pendingCount += frames
  }

  /** Pull resampled frames out of the pending buffer, retaining what does not fit. */
  private fun produce(eos: Boolean = false): ByteBuffer {
    if (!resampling || pendingCount <= 0) {
      if (finished()) {val out = encode(0); retained = out; return out}
    }
    val step = sourceRate.toDouble() / targetRate
    val capacity = maxOf(1, kotlin.math.ceil(pendingCount / (sourceRate.toDouble() / targetRate)).toInt() + 2)
    val outFrames = FloatArray(capacity * channels)
    var produced = 0
    while (true) {
      val at = floor(position).toInt()
      if (at + 1 >= pendingCount) break
      val fraction = (position - at).toFloat()
      for (channel in 0 until channels) {
        val a = pendingFrames[at * channels + channel]
        val b = pendingFrames[(at + 1) * channels + channel]
        outFrames[produced * channels + channel] = a + (b - a) * fraction
      }
      produced++; position += step
    }
    // Drop consumed frames, keep the interpolation point.
    val consumed = minOf(floor(position).toInt(), pendingCount)
    if (consumed > 0) {
      System.arraycopy(pendingFrames, consumed * channels, pendingFrames, 0, (pendingCount - consumed) * channels)
      pendingCount -= consumed; position -= consumed
    }
    if (produced == 0 && eos && pendingCount > 0) produced = holdLast(outFrames)
    val buffer = encode(produced, outFrames)
    retained = buffer
    return buffer
  }

  /** End of stream: the final kept frame is repeated once so no tail is silently dropped. */
  private fun holdLast(out: FloatArray): Int {
    if (pendingCount <= 0) return 0
    for (channel in 0 until channels) out[channel] = pendingFrames[(pendingCount - 1) * channels + channel]
    pendingCount = 0
    return 1
  }

  private fun finished(): Boolean = pendingCount <= 0

  private fun encode(frames: Int, source: FloatArray = FloatArray(0)): ByteBuffer {
    val out = ByteBuffer.allocateDirect(frames * frame).order(ByteOrder.nativeOrder())
    for (index in 0 until frames * channels) write(out, source[index])
    out.flip(); return out
  }

  private fun read(input: ByteBuffer): Float = when (encoding) {
    android.media.AudioFormat.ENCODING_PCM_16BIT -> input.short / 32768f
    android.media.AudioFormat.ENCODING_PCM_24BIT_PACKED -> read24(input) / 8388608f
    android.media.AudioFormat.ENCODING_PCM_32BIT -> (input.int / 2147483648.0).toFloat()
    else -> input.float
  }

  private fun read24(input: ByteBuffer): Int {
    val raw = (input.get().toInt() and 0xFF) or ((input.get().toInt() and 0xFF) shl 8) or ((input.get().toInt() and 0xFF) shl 16)
    return if (raw and 0x800000 != 0) raw - 0x1000000 else raw
  }

  private fun write(output: ByteBuffer, value: Float) {
    val sample = if (value.isFinite()) value.coerceIn(-1f, 1f) else 0f
    when (encoding) {
      android.media.AudioFormat.ENCODING_PCM_16BIT -> output.putShort((sample * 32768f).toInt().coerceIn(-32768, 32767).toShort())
      android.media.AudioFormat.ENCODING_PCM_24BIT_PACKED -> {
        val bits = (sample * 8388608f).toInt().coerceIn(-8388608, 8388607)
        output.put((bits and 0xFF).toByte()); output.put((bits shr 8 and 0xFF).toByte()); output.put((bits shr 16 and 0xFF).toByte())
      }
      android.media.AudioFormat.ENCODING_PCM_32BIT -> output.putInt((sample.toDouble() * 2147483648.0).toLong().coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt())
      else -> output.putFloat(sample)
    }
  }
}
