package tv.getportico.portico.native

import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** One actual shared PCM output's limiter, not one per song/player. Closing joins any in-flight
 * block under this object's lock; the private native address never crosses a bridge or owner. */
internal class PorticoTruePeak(rate: Int, private val channels: Int) : Closeable {
  private var handle = PorticoTruePeakNative.create(rate, channels).also { check(it != 0L) { "audio_true_peak_unavailable" } }
  val latencyFrames: Int = PorticoTruePeakNative.latency(handle)
  val drainFrames: Int = PorticoTruePeakNative.drain(handle)
  @Synchronized fun process(buffer: ByteBuffer, frames: Int) {
    check(handle != 0L && buffer.isDirect && buffer.order() == ByteOrder.nativeOrder() && buffer.position() == 0 &&
        frames in 0..8192 && buffer.remaining().toLong() >= frames.toLong() * channels * 4)
    check(PorticoTruePeakNative.process(handle, buffer, frames)) { "audio_true_peak_failed" }
  }
  @Synchronized fun reset() { check(handle != 0L); PorticoTruePeakNative.reset(handle) }
  @Synchronized override fun close() { val own = handle; handle = 0; if (own != 0L) PorticoTruePeakNative.destroy(own) }
}
internal object PorticoTruePeakNative {
  init { System.loadLibrary("portico_audio_dsp") }
  external fun create(rate: Int, channels: Int): Long
  external fun latency(handle: Long): Int
  external fun drain(handle: Long): Int
  external fun process(handle: Long, buffer: ByteBuffer, frames: Int): Boolean
  external fun reset(handle: Long)
  external fun destroy(handle: Long)
}
