package tv.getportico.portico.native

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Music gain belongs in decoded PCM: ExoPlayer volume is attenuation only.
 *
 * A listening player decodes at the file's own precision, so this stage reads 16-bit, 24-bit
 * packed, 32-bit integer and float PCM. Its output encoding is the device intersection from
 * [PorticoAudioOutput]: the source's own precision when the routed device advertises it, otherwise
 * 16-bit, so no precision is claimed that the sink cannot take. An unchanged unity stream at the
 * same encoding is copied byte for byte, keeping a bit-perfect path bit perfect. Ramped or
 * amplified audio is clipped at the encoding's own full scale. Nothing here resamples, mixes or
 * reorders channels.
 */
internal class PorticoAudioGain(
    private val capabilities: () -> List<PorticoAudioOutput.Device> = { emptyList() },
) : BaseAudioProcessor() {
  @Volatile var target = 1f
  private var level = 1f
  private var goal = 1f
  private var remaining = 0
  private var step = 0f

  override fun onConfigure(input: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (input.encoding !in PorticoAudioOutput.ENCODINGS) throw AudioProcessor.UnhandledAudioFormatException(input)
    val choice = PorticoAudioOutput.choose(
        capabilities(), input.sampleRate, input.channelCount, input.encoding, target == 1f)
    // Stay active at unity so a change of gain never has to recreate the sink.
    return if (choice.encoding == input.encoding) input
    else AudioProcessor.AudioFormat(input.sampleRate, input.channelCount, choice.encoding)
  }

  override fun queueInput(input: ByteBuffer) {
    val source = inputAudioFormat
    val sink = outputAudioFormat
    if (source.bytesPerFrame <= 0) { input.position(input.limit()); return }
    input.order(ByteOrder.nativeOrder())
    val frames = input.remaining() / source.bytesPerFrame
    if (frames <= 0) { input.position(input.limit()); return }
    val output = replaceOutputBuffer(frames * sink.bytesPerFrame).order(ByteOrder.nativeOrder())
    val wanted = target.takeIf { it.isFinite() }?.coerceIn(0f, 32f) ?: 1f
    if (wanted != goal) {
      goal = wanted; remaining = (source.sampleRate / 50).coerceAtLeast(1)
      step = (goal - level) / remaining
    }
    if (level == 1f && goal == 1f && source.encoding == sink.encoding) {
      // Unity at one encoding keeps the decoded bytes exactly as they arrived.
      output.put(input)
      output.flip()
      return
    }
    while (input.remaining() >= source.bytesPerFrame) {
      if (remaining > 0) { level += step; if (--remaining == 0) level = goal }
      repeat(source.channelCount) {
        val scaled = readSample(input, source.encoding) * level
        writeSample(output, sink.encoding, scaled)
      }
    }
    // A trailing partial frame cannot be written; drop it rather than leave input unread.
    input.position(input.limit())
    output.flip()
  }

  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) { level = target; goal = target; remaining = 0 }

  private fun readSample(input: ByteBuffer, encoding: Int): Float = when (encoding) {
    C.ENCODING_PCM_16BIT -> input.short / 32768f
    C.ENCODING_PCM_24BIT -> read24(input) / 8388608f
    C.ENCODING_PCM_32BIT -> (input.int / 2147483648.0).toFloat()
    else -> input.float
  }

  private fun read24(input: ByteBuffer): Int {
    val raw = (input.get().toInt() and 0xFF) or ((input.get().toInt() and 0xFF) shl 8) or ((input.get().toInt() and 0xFF) shl 16)
    return if (raw and 0x800000 != 0) raw - 0x1000000 else raw
  }

  private fun writeSample(output: ByteBuffer, encoding: Int, scaled: Float) {
    val value = if (scaled.isFinite()) scaled.coerceIn(-1f, 1f) else 0f
    when (encoding) {
      C.ENCODING_PCM_16BIT -> output.putShort((value * 32768f).toInt().coerceIn(-32768, 32767).toShort())
      C.ENCODING_PCM_24BIT -> {
        val sample = (value * 8388608f).toInt().coerceIn(-8388608, 8388607)
        output.put((sample and 0xFF).toByte())
        output.put((sample shr 8 and 0xFF).toByte())
        output.put((sample shr 16 and 0xFF).toByte())
      }
      C.ENCODING_PCM_32BIT -> output.putInt(
          (value.toDouble() * 2147483648.0).toLong().coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt())
      else -> output.putFloat(value)
    }
  }
}

/** Only listening players use this sink; video keeps its normal output format and passthrough. */
internal class PorticoAudioRenderers(context: Context, private val gain: PorticoAudioGain) : DefaultRenderersFactory(context) {
  override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink {
    // Float only where the output device advertises it; a device that cannot play float is never
    // told it is receiving float. The gain stage keeps the source's own precision either way.
    val sink = DefaultAudioSink.Builder(context).setEnableFloatOutput(PorticoAudioOutput.prefersFloat(context))
        .setAudioProcessors(arrayOf(gain)).build()
    // Encoded output would bypass gain, including on HDMI routes. Music always reaches PCM.
    return object : ForwardingAudioSink(sink) {
      override fun getFormatSupport(format: Format): Int = if (format.sampleMimeType == MimeTypes.AUDIO_RAW) super.getFormatSupport(format) else AudioSink.SINK_FORMAT_UNSUPPORTED
      override fun supportsFormat(format: Format): Boolean = format.sampleMimeType == MimeTypes.AUDIO_RAW && super.supportsFormat(format)
    }
  }
}
