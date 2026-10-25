package tv.getportico.portico.native

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ceil
import kotlin.math.floor

/**
 * The music sink's rate stage (Smart/Strict/Off, music-plus 14). Reviewable engine WIP.
 *
 * Ownership: frames are copied out of the incoming buffer on the first call, so a sink retry
 * always sees the same retained piece — same buffer, time and count. Configure, flush and reset
 * retire every retained piece, so an old stream's tail cannot enter its successor.
 *
 * Clock: the outgoing timestamp comes from an output-frame clock that advances only when the
 * delegate accepts a piece, never from the input buffer's start. A refused buffer therefore keeps
 * its original timestamp, and the end-of-stream tail continues the same clock instead of jumping
 * back to the last input buffer's start.
 *
 * Rate conversion is linear at the encoding the gain already produced. It is a correctness-first
 * stage, not a qualified music sample-rate converter: downsampling here has no anti-alias filter,
 * so nothing in this file supports a claim of transparent or bit-perfect resampling. The finite
 * input is drained exactly: while streaming, positions are emitted where a following source frame
 * exists; at end of stream every position inside the input duration is emitted, holding the final
 * frame for the last fractional positions. A downsample whose next phase is past the end therefore
 * invents nothing, and an upsample gets every position the input duration supports.
 *
 * Modes: Off opens at this device's preferred rate; Strict at the file's rate (route refusal is a
 * caller fact); Smart at the file's rate unless the route is known to refuse it.
 */
internal class PorticoRateStage {
  /** A piece the delegate must accept. [buffer] is the delegate's own object: media3 requires a
   * retry to hand back the same buffer it last saw, and it may have partially consumed that buffer
   * before returning false, so its position is never rewound here. [frames] is captured at creation
   * because the position no longer describes the piece once the delegate has touched it. */
  data class Piece(val buffer: ByteBuffer, val timeUs: Long, val count: Int, val frames: Int)

  private var sourceRate = 0
  private var targetRate = 0
  private var channels = 0
  private var encoding = 0
  private var frame = 0
  private var position = 0.0
  private var pending = FloatArray(0)
  private var pendingCount = 0
  private var startTimeUs = -1L
  private var outputFrames = 0L
  private var lastCount = 0
  private var retained: Piece? = null
  private var tail: Piece? = null
  private var ended = false

  val resampling: Boolean get() = sourceRate > 0 && targetRate > 0 && sourceRate != targetRate

  fun configure(
    sourceRate: Int,
    channels: Int,
    encoding: Int,
    mode: String,
    preferredRate: Int,
    fileRate: Int,
    routeTakesFile: Boolean?,
  ): Int {
    require(sourceRate > 0 && channels > 0 && PorticoAudioOutput.supports(encoding)) {
      "unsupported rate stage format"
    }
    clear()
    this.sourceRate = sourceRate
    this.channels = channels
    this.encoding = encoding
    frame = PorticoAudioOutput.bytesPerSample(encoding) * channels
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
    return targetRate
  }

  /** One decoder buffer in; the piece the delegate must accept (same identity on a retry). */
  fun process(input: ByteBuffer, presentationTimeUs: Long, count: Int): Piece {
    retained?.let { return it }
    lastCount = count
    if (startTimeUs < 0) startTimeUs = presentationTimeUs
    if (!resampling) {
      val frames = if (frame > 0) input.remaining() / frame else 0
      return Piece(input, presentationTimeUs, count, frames).also { retained = it }
    }
    copy(input)
    return produce(eos = false).also { retained = it }
  }

  /** The delegate accepted [piece]; retire it and advance the output clock by its own frames. */
  fun accepted(piece: Piece?) {
    if (piece == null) return
    if (piece === retained) {
      outputFrames += piece.frames
      retained = null
    }
    if (piece === tail) {
      tail = null
      ended = true
    }
  }

  /** The end-of-stream tail, or null. Retained until [accepted]; [ended] waits for that. */
  fun takeTail(): Piece? {
    if (!resampling) {
      ended = true
      return null
    }
    tail?.let { return it }
    if (ended) return null
    if (pendingCount <= 0) {
      ended = true
      return null
    }
    val piece = produce(eos = true)
    if (piece.frames <= 0) {
      ended = true
      return null
    }
    return piece.also { tail = it }
  }

  /** True once the retained tail has been accepted, so the delegate may finish. */
  val tailAccepted: Boolean get() = ended

  /** True while a piece the delegate has not accepted is still held, tail included. */
  val hasPendingOutput: Boolean get() = retained != null || tail != null

  fun flush() = clear()

  fun reset() {
    clear()
    sourceRate = 0
    targetRate = 0
    channels = 0
    encoding = 0
    frame = 0
  }

  /** Retire every retained piece and the clock with it; nothing of this stream survives. */
  private fun clear() {
    pending = FloatArray(0)
    pendingCount = 0
    position = 0.0
    retained = null
    tail = null
    ended = false
    startTimeUs = -1L
    outputFrames = 0
    lastCount = 0
  }

  private fun timeFor(framesBefore: Long): Long =
    if (startTimeUs < 0 || targetRate <= 0) startTimeUs.coerceAtLeast(0)
    else startTimeUs + Math.round(framesBefore * 1_000_000.0 / targetRate)

  private fun copy(input: ByteBuffer) {
    val source = input.duplicate().order(ByteOrder.nativeOrder())
    val frames = if (frame > 0) source.remaining() / frame else 0
    if (frames <= 0) return
    val needed = (pendingCount + frames) * channels
    if (needed > pending.size) {
      val grown = FloatArray(maxOf(needed, pending.size * 2, 1024))
      System.arraycopy(pending, 0, grown, 0, pendingCount * channels)
      pending = grown
    }
    repeat(frames) { index ->
      for (channel in 0 until channels) {
        pending[(pendingCount + index) * channels + channel] = read(source)
      }
    }
    pendingCount += frames
  }

  /** Emit every target position the finite input supports, consuming whole source frames. */
  private fun produce(eos: Boolean): Piece {
    val step = sourceRate.toDouble() / targetRate
    val last = pendingCount - 1
    val duration = pendingCount.toDouble()
    val capacity = maxOf(1, ceil(duration / step).toInt() + 2)
    val out = FloatArray(capacity * channels)
    var produced = 0
    while (produced < capacity) {
      val at = floor(position).toInt()
      if (at < last) {
        val fraction = (position - at).toFloat()
        for (channel in 0 until channels) {
          val a = pending[at * channels + channel]
          val b = pending[(at + 1) * channels + channel]
          out[produced * channels + channel] = a + (b - a) * fraction
        }
      } else if (eos && at == last && position < duration) {
        // Inside the input duration but past the last whole source frame: hold that frame. Past the
        // duration the next phase is beyond the stream, so nothing is invented.
        for (channel in 0 until channels) {
          out[produced * channels + channel] = pending[at * channels + channel]
        }
      } else {
        break
      }
      produced++
      position += step
    }
    val consumed = minOf(floor(position).toInt(), pendingCount)
    if (consumed > 0) {
      System.arraycopy(pending, consumed * channels, pending, 0, (pendingCount - consumed) * channels)
      pendingCount -= consumed
      position -= consumed
    }
    return Piece(encode(produced, out), timeFor(outputFrames), lastCount, produced)
  }

  private fun encode(frames: Int, source: FloatArray): ByteBuffer {
    val out = ByteBuffer.allocateDirect(frames * frame).order(ByteOrder.nativeOrder())
    for (index in 0 until frames * channels) write(out, source[index])
    out.flip()
    return out
  }

  private fun read(input: ByteBuffer): Float = when (encoding) {
    android.media.AudioFormat.ENCODING_PCM_16BIT -> input.short / 32768f
    android.media.AudioFormat.ENCODING_PCM_24BIT_PACKED -> read24(input) / 8388608f
    android.media.AudioFormat.ENCODING_PCM_32BIT -> (input.int / 2147483648.0).toFloat()
    else -> input.float
  }

  private fun read24(input: ByteBuffer): Int {
    val raw = (input.get().toInt() and 0xFF) or
        ((input.get().toInt() and 0xFF) shl 8) or
        ((input.get().toInt() and 0xFF) shl 16)
    return if (raw and 0x800000 != 0) raw - 0x1000000 else raw
  }

  private fun write(output: ByteBuffer, value: Float) {
    val sample = if (value.isFinite()) value.coerceIn(-1f, 1f) else 0f
    when (encoding) {
      android.media.AudioFormat.ENCODING_PCM_16BIT ->
        output.putShort((sample * 32768f).toInt().coerceIn(-32768, 32767).toShort())
      android.media.AudioFormat.ENCODING_PCM_24BIT_PACKED -> {
        val bits = (sample * 8388608f).toInt().coerceIn(-8388608, 8388607)
        output.put((bits and 0xFF).toByte())
        output.put((bits shr 8 and 0xFF).toByte())
        output.put((bits shr 16 and 0xFF).toByte())
      }
      android.media.AudioFormat.ENCODING_PCM_32BIT ->
        output.putInt((sample.toDouble() * 2147483648.0).toLong()
          .coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt())
      else -> output.putFloat(sample)
    }
  }
}
