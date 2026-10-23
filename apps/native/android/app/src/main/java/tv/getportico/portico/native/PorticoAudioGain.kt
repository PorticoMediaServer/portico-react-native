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
import java.nio.ByteBuffer

/** The same DSP is used for 16, packed 24, signed 32 and float PCM. */
internal class PorticoAudioGain : BaseAudioProcessor() {
  val dsp = PorticoPcmDsp()
  var target: Float
    get() = dsp.target.toFloat()
    set(value) { dsp.target = value.toDouble() }
  var equalizer: PorticoPcmDsp.Eq
    get() = dsp.eq
    set(value) { dsp.eq = value }
  fun setGain(linear: Float, normalization: Float) {
    dsp.gain = PorticoPcmDsp.Gain(linear.toDouble(), normalization.toDouble())
  }
  override fun onConfigure(input: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (encoding(input.encoding) == null) throw AudioProcessor.UnhandledAudioFormatException(input)
    dsp.configure(input.sampleRate, input.channelCount); return input
  }
  override fun queueInput(input: ByteBuffer) {
    val result = dsp.process(input, encoding(inputAudioFormat.encoding)!!)
    replaceOutputBuffer(result.remaining()).put(result).flip()
  }
  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) { dsp.reset() }
  companion object {
    fun encoding(value: Int): PorticoPcmDsp.Encoding? = when(value) {
      C.ENCODING_PCM_16BIT -> PorticoPcmDsp.Encoding.S16
      C.ENCODING_PCM_24BIT -> PorticoPcmDsp.Encoding.S24
      C.ENCODING_PCM_32BIT -> PorticoPcmDsp.Encoding.S32
      C.ENCODING_PCM_FLOAT -> PorticoPcmDsp.Encoding.FLOAT
      else -> null
    }
  }
}

/** Precision PCM never travels through DefaultAudioSink's 16-bit processor chain. */
internal class PorticoAudioRenderers(context: Context, private val gain: PorticoAudioGain, private val allowPassthrough: Boolean) : DefaultRenderersFactory(context) {
  init { setExtensionRendererMode(if(allowPassthrough && PorticoAudioVariants.receiver(context).isNotEmpty()) EXTENSION_RENDERER_MODE_ON else EXTENSION_RENDERER_MODE_PREFER) }
  override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink =
      PorticoPrecisionAudioSink(context, DefaultAudioSink.Builder(context).setEnableFloatOutput(true).build(), gain.dsp,allowPassthrough)
}
