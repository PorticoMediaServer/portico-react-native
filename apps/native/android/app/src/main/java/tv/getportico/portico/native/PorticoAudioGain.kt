package tv.getportico.portico.native

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Music gain belongs in decoded PCM: ExoPlayer volume is attenuation only. */
internal class PorticoAudioGain : BaseAudioProcessor() {
  @Volatile var target = 1f
  private var level = 1f
  private var goal = 1f
  private var remaining = 0
  private var step = 0f

  override fun onConfigure(input: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (input.encoding != C.ENCODING_PCM_16BIT) throw AudioProcessor.UnhandledAudioFormatException(input)
    // Stay active at unity so a change of gain never has to recreate the sink.
    return input
  }

  override fun queueInput(input: ByteBuffer) {
    input.order(ByteOrder.nativeOrder())
    val output = replaceOutputBuffer(input.remaining()).order(ByteOrder.nativeOrder())
    val wanted = target.takeIf { it.isFinite() }?.coerceIn(0f, 32f) ?: 1f
    if (wanted != goal) {
      goal = wanted; remaining = (inputAudioFormat.sampleRate / 50).coerceAtLeast(1)
      step = (goal - level) / remaining
    }
    while (input.remaining() >= inputAudioFormat.bytesPerFrame) {
      if (remaining > 0) { level += step; if (--remaining == 0) level = goal }
      repeat(inputAudioFormat.channelCount) {
        val scaled = input.short.toFloat() * level
        output.putShort(scaled.toInt().coerceIn(-32768, 32767).toShort())
      }
    }
    output.flip()
  }

  override fun onFlush() { level = target; goal = target; remaining = 0 }
}

/** Only listening players use this sink; video keeps its normal output format and passthrough. */
internal class PorticoAudioRenderers(context: Context, private val gain: PorticoAudioGain) : DefaultRenderersFactory(context) {
  override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink =
      DefaultAudioSink.Builder(context).setEnableFloatOutput(false)
          .setAudioProcessors(arrayOf(gain)).build()
}
