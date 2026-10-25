package tv.getportico.portico.native

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Music gain applied to the decoder's own PCM, before the sink converts anything.
 *
 * Media3's `DefaultAudioSink` cannot carry a user gain stage at high precision: with float output
 * it replaces the processor chain entirely, and without float output it converts to 16-bit before
 * the chain. So gain runs on the buffer the renderer hands the sink, in the decoder's encoding,
 * and converts to the encoding [PorticoAudioOutput] selected for this device and stream. An
 * unchanged unity stream at one encoding is returned untouched, keeping a bit-exact pass; ramped
 * or amplified audio is rounded per sample and clipped at the target's full scale. Nothing here
 * resamples, mixes or reorders channels, and [input] is never consumed.
 */
internal class PorticoAudioGain {
  @Volatile var target = 1f
  private var level = 1f
  private var goal = 1f
  private var remaining = 0
  private var step = 0f

  /** Begins a new stream at the current target, without a ramp from the previous one. */
  fun reset() { level = target; goal = target; remaining = 0 }

  fun apply(input: ByteBuffer, sourceEncoding: Int, targetEncoding: Int, channelCount: Int, sampleRate: Int): ByteBuffer {
    require(PorticoAudioOutput.supports(sourceEncoding) && PorticoAudioOutput.supports(targetEncoding)) {
      "unsupported pcm encoding"
    }
    val sourceFrame = PorticoAudioOutput.bytesPerSample(sourceEncoding) * channelCount
    val targetFrame = PorticoAudioOutput.bytesPerSample(targetEncoding) * channelCount
    if (sourceFrame <= 0 || targetFrame <= 0 || input.remaining() < sourceFrame) return input
    val wanted = target.takeIf { it.isFinite() }?.coerceIn(0f, 32f) ?: 1f
    if (wanted != goal) {
      goal = wanted
      remaining = (sampleRate / 50).coerceAtLeast(1)
      step = (goal - level) / remaining
    }
    if (level == 1f && goal == 1f && sourceEncoding == targetEncoding) return input
    val source = input.duplicate().order(ByteOrder.nativeOrder())
    val frames = source.remaining() / sourceFrame
    if (frames <= 0) return input
    val out = ByteBuffer.allocateDirect(frames * targetFrame).order(ByteOrder.nativeOrder())
    repeat(frames) {
      if (remaining > 0) { level += step; if (--remaining == 0) level = goal }
      repeat(channelCount) { writeSample(out, targetEncoding, readSample(source, sourceEncoding) * level) }
    }
    out.flip()
    return out
  }

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

/**
 * Holds one transformed buffer across sink retries.
 *
 * `AudioSink.handleBuffer` may return false without consuming the buffer, and the next attempt
 * must pass the same buffer with the same timestamp and access count. A different identity while
 * one is still held is a broken contract, so it is rejected rather than silently replacing a
 * buffer the delegate still owns; only [clear] (flush or reset) retires one. On acceptance the
 * original decoder buffer is advanced to the end it had when it was handed over.
 */
internal class PorticoGainQueue(private val gain: PorticoAudioGain) {
  private var pending: ByteBuffer? = null
  private var pendingInput: ByteBuffer? = null
  private var pendingTime = 0L
  private var pendingCount = 0
  private var pendingEnd = 0

  fun hasPending(): Boolean = pending != null

  fun bufferFor(input: ByteBuffer, sourceEncoding: Int, targetEncoding: Int, channelCount: Int, sampleRate: Int,
                presentationTimeUs: Long, encodedAccessUnitCount: Int, resampler: SonicAudioProcessor? = null): ByteBuffer {
    val held = pending
    if (held != null) {
      check(pendingInput === input && pendingTime == presentationTimeUs && pendingCount == encodedAccessUnitCount) {
        "audio sink retried a different buffer while one was still pending"
      }
      return held
    }
    // Cache every submission, including a unity buffer that is handed on unchanged: the delegate
    // must see the same object again if it refuses it, whatever the gain target becomes meanwhile.
    val scaled = gain.apply(input, sourceEncoding, targetEncoding, channelCount, sampleRate)
    pending = if (resampler == null) scaled else resample(resampler, scaled)
    pendingInput = input
    pendingTime = presentationTimeUs
    pendingCount = encodedAccessUnitCount
    pendingEnd = input.limit()
    return scaled
  }

  /** Media3's own resampler, fed once per submitted buffer; its output is what the sink sees. */
  private fun resample(processor: SonicAudioProcessor, input: ByteBuffer): ByteBuffer {
    val out = ByteBuffer.allocateDirect(maxOf(input.remaining() * 2, 64)).order(ByteOrder.nativeOrder())
    processor.queueInput(input)
    val chunk = processor.output
    if (chunk.hasRemaining()) out.put(chunk)
    out.flip()
    return if (out.hasRemaining()) out else input
  }

  fun accepted() {
    pendingInput?.position(pendingEnd)
    clear()
  }

  fun clear() {
    pending = null
    pendingInput = null
    pendingTime = 0
    pendingCount = 0
    pendingEnd = 0
  }
}

/**
 * The listening pipeline: gain plus the device format decision, kept separate from the sink
 * adapter so the retry and reconfigure behaviour is testable without a Media3 delegate.
 */
internal class PorticoMusicPipeline(
  private val gain: PorticoAudioGain,
  private val route: () -> PorticoAudioOutput.Route,
  /** The device's Match sample rate mode and the rate it prefers, from the listening owner. */
  private val sampleRateMode: () -> String = { PorticoAudioSampleRate.SMART },
  private val preferredSampleRate: () -> Int = { 0 },
  /** Called once a configured stream is actually accepted, with the rate it was opened at. */
  private val onOpened: (Int) -> Unit = {},
) {
  private val queue = PorticoGainQueue(gain)
  private var sourceEncoding = C.ENCODING_PCM_16BIT
  private var targetEncoding = C.ENCODING_PCM_16BIT
  private var channels = 0
  private var sampleRate = 0
  private var openRate = 0
  private var resampler: SonicAudioProcessor? = null
  private var started = false

  /** What the delegate must be configured with: the format the gain actually produces. */
  fun configure(format: Format): Format {
    // The delegate must be idle: a buffer it still holds belongs to the previous stream and must
    // not be discarded by a reconfiguration. Media3 flushes before configuring, so this is misuse.
    check(!queue.hasPending()) { "configure while a buffer is still pending" }
    val source = if (format.pcmEncoding != Format.NO_VALUE) format.pcmEncoding else C.ENCODING_PCM_16BIT
    // Only the four paths this stage converts are accepted; anything else is refused before a
    // single byte reaches the delegate, which would otherwise misread it at the target encoding.
    require(PorticoAudioOutput.supports(source)) { "unsupported pcm encoding" }
    sourceEncoding = source
    channels = format.channelCount
    sampleRate = format.sampleRate
    gain.reset()
    started = false
    targetEncoding = PorticoAudioOutput.targetEncoding(route(), sampleRate, channels, sourceEncoding)
    // The sink opens at the routed decision's rate. Only PCM 16/float can be resampled here; for a
    // wider target encoding the source rate is kept and the decision records that it could not
    // open at the chosen rate, rather than pretending.
    // The routed device is only known after the sink opens; before that Strict/Smart open at the
    // file's rate and Off at this device's preferred rate. Unknown is never read as support.
    val preferred = preferredSampleRate()
    val wanted = when (PorticoAudioSampleRate.parse(sampleRateMode())) {
      PorticoAudioSampleRate.OFF -> if (preferred > 0) preferred else sampleRate
      else -> sampleRate
    }
    val canResample = targetEncoding == C.ENCODING_PCM_16BIT || targetEncoding == C.ENCODING_PCM_FLOAT
    openRate = if (wanted > 0 && wanted != sampleRate && canResample) wanted else sampleRate
    resampler?.flush()
    resampler = if (openRate != sampleRate) SonicAudioProcessor().apply {
      setOutputSampleRateHz(openRate)
      configure(AudioProcessor.AudioFormat(sampleRate, channels, C.ENCODING_PCM_16BIT))
    } else null
    val delegate = converted(format, sourceEncoding)
    return if (openRate != sampleRate) delegate.buildUpon().setSampleRate(openRate).build() else delegate
  }

  fun handle(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int,
             deliver: (ByteBuffer, Long, Int) -> Boolean): Boolean {
    val scaled = queue.bufferFor(buffer, sourceEncoding, targetEncoding, channels, sampleRate,
        presentationTimeUs, encodedAccessUnitCount, resampler)
    if (!deliver(scaled, presentationTimeUs, encodedAccessUnitCount)) return false
    queue.accepted()
    if (!started) {started = true; onOpened(openRate)}
    return true
  }


  /** The format the delegate would actually receive for [format], or null when it is unsupported. */
  fun delegateFormat(format: Format): Format? {
    val source = if (format.pcmEncoding != Format.NO_VALUE) format.pcmEncoding else C.ENCODING_PCM_16BIT
    if (!PorticoAudioOutput.supports(source)) return null
    val target = PorticoAudioOutput.targetEncoding(route(), format.sampleRate, format.channelCount, source)
    return if (target != source) format.buildUpon().setPcmEncoding(target).build() else format
  }

  fun flush() { queue.clear(); gain.reset(); resampler?.flush(); started = false }

  fun reset() { queue.clear(); gain.reset(); resampler = null; started = false }

  private fun converted(format: Format, source: Int, target: Int = targetEncoding): Format =
      if (target != source) format.buildUpon().setPcmEncoding(target).build() else format
}

/**
 * The listening sink: the pipeline above, then the standard sink. The decoder's encoding is
 * remembered from [configure], so gain works on real high-resolution samples before media3
 * converts them, and the delegate is configured with the format the gain actually produces.
 */
internal class PorticoMusicSink(
  delegate: AudioSink,
  gain: PorticoAudioGain,
  route: () -> PorticoAudioOutput.Route,
  preferredSampleRate: () -> Int = { 0 },
) : ForwardingAudioSink(delegate) {
  private val pipeline = PorticoMusicPipeline(gain, route, { PorticoAudioSampleRate.mode }, preferredSampleRate,
      { rate -> PorticoAudioSampleRate.openedSampleRate = rate })

  override fun configure(format: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
    super.configure(pipeline.configure(format), specifiedBufferSize, outputChannels)
  }

  override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean =
      pipeline.handle(buffer, presentationTimeUs, encodedAccessUnitCount) { outgoing, time, count ->
        super.handleBuffer(outgoing, time, count)
      }

  override fun flush() {
    super.flush()
    pipeline.flush()
  }

  override fun reset() {
    super.reset()
    pipeline.reset()
  }

  override fun getFormatSupport(format: Format): Int {
    if (format.sampleMimeType != MimeTypes.AUDIO_RAW) return AudioSink.SINK_FORMAT_UNSUPPORTED
    val delegate = pipeline.delegateFormat(format) ?: return AudioSink.SINK_FORMAT_UNSUPPORTED
    return super.getFormatSupport(delegate)
  }

  override fun supportsFormat(format: Format): Boolean {
    if (format.sampleMimeType != MimeTypes.AUDIO_RAW) return false
    val delegate = pipeline.delegateFormat(format) ?: return false
    return super.supportsFormat(delegate)
  }
}

/** Only listening players use this sink; video keeps its normal output format and passthrough. */
internal class PorticoAudioRenderers(context: Context, private val gain: PorticoAudioGain) : DefaultRenderersFactory(context) {
  override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink {
    val route = { PorticoAudioOutput.route(context) }
    val preferred = {
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager
      manager?.getProperty(android.media.AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull() ?: 0
    }
    // Float is the sink's only high-resolution output and the decision is per stream, not per
    // player: with float enabled the delegate uses it exactly when PorticoAudioOutput selects
    // float for this stream, and a 16-bit selection never enters the float path. A build-time
    // route snapshot therefore cannot make a later float selection narrow to 16-bit.
    val sink = DefaultAudioSink.Builder(context).setEnableFloatOutput(true).build()
    return PorticoMusicSink(sink, gain, route, preferred)
  }
}
