package tv.getportico.portico.native

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.PlaybackParameters
import androidx.media3.exoplayer.audio.AudioOutput
import androidx.media3.exoplayer.audio.AudioOutputProvider
import androidx.media3.exoplayer.audio.AudioTrackAudioOutputProvider
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap

/** One processed listening owner's physical output. Both committed decks feed this bus AFTER
 * their Media3 trims/processors; the sum/rate-converted Float32 passes through ONE linked limiter
 * and is quantized only afterwards. No independent tracks can sum downstream of the limiter.
 *
 * All AudioOutput/Provider calls use the controller's one audio playback looper. Main-thread
 * policy changes only supply immutable gain controls; no queue/source/actor authority originates
 * here. Exactly two voices, bounded queues, one held physical buffer, existing renderer retries.
 * Unsupported masks/encoded/offload/auxiliary effects refuse rather than bypass protection. */
internal class PorticoMusicMix(private val context: Context, private val onIdle: () -> Unit = {}) {
  private val delegate = AudioTrackAudioOutputProvider.Builder(context).build()
  private var physical: AudioOutput? = null
  private var physicalConfig: AudioOutputProvider.OutputConfig? = null
  private var limiter: PorticoTruePeak? = null
  private val voices = LinkedHashSet<Voice>()
  private val current = ConcurrentHashMap<PorticoAudioGain, Voice>()
  private var clients = 0
  private var pending: ByteBuffer? = null
  private var pendingTimeUs = 0L
  private val releases = java.util.concurrent.atomic.AtomicInteger()
  private var writtenFrames = 0L
  private var mixedFrames = 0L
  private var tailLeft = -1
  private var stopped = false
  private var driver: Voice? = null
  @Volatile var closed = false
    private set

  fun hasHeard(gain: PorticoAudioGain): Boolean = current[gain]?.heard == true

  fun client(gain: PorticoAudioGain): AudioOutputProvider {
    synchronized(this) { check(!closed); clients++ }
    gain.externalFade = true
    return object : AudioOutputProvider by delegate {
      private val listeners = LinkedHashSet<AudioOutputProvider.Listener>()
      private var released = false
      override fun getAudioOutput(config: AudioOutputProvider.OutputConfig): AudioOutput = open(gain, config)
      override fun addListener(listener: AudioOutputProvider.Listener) { listeners.add(listener); delegate.addListener(listener) }
      override fun removeListener(listener: AudioOutputProvider.Listener) { listeners.remove(listener); delegate.removeListener(listener) }
      override fun release() {
        if (released) return
        released = true
        listeners.forEach { delegate.removeListener(it) }; listeners.clear()
        synchronized(this@PorticoMusicMix) {
          clients--
          if (clients == 0) { dispose(); delegate.release(); closed = true; if (releases.get() == 0) onIdle() }
        }
      }
    }
  }

  private fun open(gain: PorticoAudioGain, config: AudioOutputProvider.OutputConfig): Voice {
    if (closed || voices.size >= 2 || config.isOffload || config.isTunneling || config.usePlaybackParameters ||
        config.encoding != C.ENCODING_PCM_FLOAT || config.sampleRate !in 8000..768000 ||
        Integer.bitCount(config.channelMask) !in 1..32)
      throw AudioOutputProvider.InitializationException(IllegalArgumentException("audio_mix_format_unavailable"))
    val previous = physicalConfig
    if (previous != null && (previous.channelMask != config.channelMask || previous.virtualDeviceId != config.virtualDeviceId))
      throw AudioOutputProvider.InitializationException(IllegalArgumentException("audio_mix_layout_unavailable"))
    if (physical == null) {
      val channels = Integer.bitCount(config.channelMask)
      val encoding = PorticoAudioOutput.targetEncoding(PorticoAudioOutput.route(context), config.sampleRate, channels, C.ENCODING_PCM_FLOAT)
      val actual = config.buildUpon().setEncoding(encoding).setUsePlaybackParameters(false).build()
      var created: AudioOutput? = null
      var dsp: PorticoTruePeak? = null
      try {
        created = delegate.getAudioOutput(actual)
        dsp = PorticoTruePeak(actual.sampleRate, channels)
        physical = created; physicalConfig = actual; limiter = dsp
        created.addListener(object : AudioOutput.Listener {
          override fun onUnderrun() { voices.toList().forEach { it.underrun() } }
          override fun onReleased() {}
          override fun onPositionAdvancing(time: Long) {}
          override fun onOffloadDataRequest() {}
          override fun onOffloadPresentationEnded() {}
        })
        writtenFrames = 0; mixedFrames = 0; tailLeft = -1; stopped = false
      } catch (failure: Throwable) {
        dsp?.close(); created?.release()
        throw AudioOutputProvider.InitializationException(failure)
      }
    }
    return Voice(gain, config, checkNotNull(physical)).also {
      voices.add(it); current[gain] = it
      if (driver == null) driver = it
    }
  }

  private inner class Voice(val gain: PorticoAudioGain, val config: AudioOutputProvider.OutputConfig,
                            private val output: AudioOutput) : AudioOutput by output {
    private val channels = Integer.bitCount(config.channelMask)
    private val rate = checkNotNull(physicalConfig).sampleRate
    private val stage = PorticoRateStage(allowFloatHeadroom = true).also {
      it.configure(config.sampleRate, channels, C.ENCODING_PCM_FLOAT, rate)
    }
    private val queue = ArrayDeque<FloatArray>()
    private var offset = 0
    var queued = 0
      private set
    private val reserve = kotlin.math.ceil(32.0 * rate / minOf(config.sampleRate, rate)).toInt() + 96
    private val maximum = minOf(65536, maxOf(4096, rate / 10)) + reserve
    private var input: ByteBuffer? = null
    private var inputTime = 0L
    private var inputCount = 0
    private val listeners = LinkedHashSet<AudioOutput.Listener>()
    var playing = false
    var ended = false
    var retired = false
    var firstFrame = -1L
    var mixed = 0L
    private var fade = gain.mixerFade()
    private var advancing = false
    @Volatile var heard = false
    private var notified = false
    private var volume = 1f
    fun promote() { output.setVolume(volume) }
    fun underrun() { if (playing && !retired) listeners.toList().forEach { it.onUnderrun() } }

    private fun enqueue(piece: PorticoRateStage.Piece?) {
      if (piece == null) return
      if (piece.frames > 0) {
        val values = FloatArray(piece.frames * channels)
        piece.buffer.duplicate().order(ByteOrder.nativeOrder()).asFloatBuffer().get(values)
        check(queued + piece.frames <= maximum) { "audio_mix_queue_exceeded" }
        queue.addLast(values); queued += piece.frames
      }
      stage.accepted(piece)
    }
    override fun write(buffer: ByteBuffer, encodedAccessUnitCount: Int, presentationTimeUs: Long): Boolean {
      check(!retired && buffer.isDirect && buffer.remaining() % (channels * 4) == 0 && encodedAccessUnitCount == 1)
      if (ended) flush()
      if (input == null) { input = buffer; inputTime = presentationTimeUs; inputCount = encodedAccessUnitCount }
      check(input === buffer && inputTime == presentationTimeUs && inputCount == encodedAccessUnitCount)
      pump()
      while (buffer.hasRemaining() && queued < maximum - reserve) {
        val room = maximum - reserve - queued
        val frames = minOf(1024, buffer.remaining() / (channels * 4),
            maxOf(1, (room.toLong() * config.sampleRate / rate).toInt()))
        val part = buffer.duplicate().order(ByteOrder.nativeOrder())
        part.limit(part.position() + frames * channels * 4)
        enqueue(stage.process(part, presentationTimeUs, 1))
        buffer.position(buffer.position() + frames * channels * 4)
        pump()
      }
      val complete = !buffer.hasRemaining()
      if (complete) input = null
      return complete
    }
    fun frame(into: FloatArray, at: Int) {
      val values = queue.peekFirst() ?: return
      val target = gain.mixerFade()
      val step = 1.0 / maxOf(1, rate / 50)
      fade += (target - fade).coerceIn(-step, step)
      for (channel in 0 until channels) into[at + channel] += (values[offset + channel] * fade).toFloat()
      offset += channels; queued--
      if (offset == values.size) { queue.removeFirst(); offset = 0 }
      if (firstFrame < 0) firstFrame = mixedFrames
      mixed++
    }
    fun updateHeard(position: Long) {
      heard = !retired && firstFrame >= 0 && position > firstFrame && mixed > 0
      if (heard && !advancing) { advancing = true; listeners.toList().forEach { it.onPositionAdvancing(System.currentTimeMillis()) } }
    }
    override fun getPositionUs(): Long {
      pump() // the existing renderer clock/drain checks also advance a refused EOS tail
      updatePositions()
      if (firstFrame < 0) return 0
      val at = maxOf(0L, playedFrames() - firstFrame).coerceAtMost(mixed)
      return at * 1_000_000L / rate
    }
    override fun getSampleRate(): Int = config.sampleRate
    override fun getBufferSizeInFrames(): Long = output.bufferSizeInFrames * config.sampleRate / rate
    override fun getPlaybackParameters(): PlaybackParameters = PlaybackParameters.DEFAULT
    override fun setPlaybackParameters(playbackParams: PlaybackParameters) {
      check(playbackParams == PlaybackParameters.DEFAULT) { "audio_mix_output_rate_unavailable" }
    }
    override fun isOffloadedPlayback(): Boolean = false
    override fun play() { check(!retired); playing = true; output.play(); pump() }
    override fun pause() { playing = false; if (voices.none { it.playing && !it.retired }) output.pause() }
    override fun setVolume(volume: Float) { this.volume = volume.coerceIn(0f, 1f); if (driver === this) output.setVolume(this.volume) }
    override fun addListener(listener: AudioOutput.Listener) { listeners.add(listener) }
    override fun removeListener(listener: AudioOutput.Listener) { listeners.remove(listener) }
    override fun attachAuxEffect(effectId: Int) { check(effectId == 0) { "audio_mix_aux_effect_unavailable" } }
    override fun setAuxEffectSendLevel(level: Float) { check(level == 0f) { "audio_mix_aux_effect_unavailable" } }
    override fun setOffloadDelayPadding(delayInFrames: Int, paddingInFrames: Int) { check(delayInFrames == 0 && paddingInFrames == 0) }
    override fun setOffloadEndOfStream() { stop() }
    override fun canReuseAudioOutput(old: AudioOutputProvider.OutputConfig, format: AudioOutputProvider.FormatConfig,
                                     next: AudioOutputProvider.OutputConfig): Boolean = old == next && !retired
    override fun flush() {
      if (retired) return
      queue.clear(); queued = 0; offset = 0; input = null; stage.flush()
      firstFrame = -1; mixed = 0; heard = false; ended = false
      if (driver === this) {
        // The owner retires its incoming deck before seeking/rebinding the driver.
        check(voices.none { it !== this && !it.retired }) { "audio_mix_flush_has_successor" }
        pending = null; writtenFrames = 0; mixedFrames = 0; tailLeft = -1; stopped = false
        limiter?.reset(); output.flush()
      }
    }
    override fun stop() {
      if (retired) return
      if (ended) { pump(); return }
      enqueue(stage.takeTail()); ended = true
      pump()
    }
    override fun release() {
      if (retired) return
      retired = true; playing = false; heard = false
      queue.clear(); queued = 0; input = null; stage.reset()
      current.remove(gain, this); voices.remove(this)
      if (driver === this) { driver = voices.firstOrNull(); driver?.promote() }
      if (voices.isEmpty()) {
        // Last physical reference: keep this release notification with the actual descriptor.
        output.addListener(object : AudioOutput.Listener {
          override fun onReleased() { notifyReleased() }
          override fun onPositionAdvancing(time: Long) {}
          override fun onUnderrun() {}
          override fun onOffloadDataRequest() {}
          override fun onOffloadPresentationEnded() {}
        })
        dispose()
      } else { notifyReleased(); pump() }
    }
    private fun notifyReleased() {
      if (notified) return
      notified = true
      listeners.toList().forEach { it.onReleased() }; listeners.clear()
    }
  }

  private fun playedFrames(): Long {
    val actual = physical ?: return 0
    val config = physicalConfig ?: return 0
    val latency = limiter?.latencyFrames ?: 0
    return maxOf(0L, actual.positionUs * config.sampleRate / 1_000_000L - latency)
  }
  private fun updatePositions() { val at = playedFrames(); voices.toList().forEach { it.updateHeard(at) } }

  /** Only this method writes the physical output. It owns a refused/partially consumed buffer
   * until accepted, so neither another deck nor a policy update can rescale/replay it. */
  private fun pump() {
    val actual = physical ?: return
    val config = physicalConfig ?: return
    val dsp = limiter ?: return
    val channels = Integer.bitCount(config.channelMask)
    updatePositions()
    repeat(32) {
      val held = pending
      if (held != null) {
        if (!actual.write(held, 1, pendingTimeUs)) return
        pending = null
      }
      val contributors = voices.filter { !it.retired && it.playing && (!it.ended || it.queued > 0) }
      val waiting = contributors.any { it.firstFrame >= 0 && it.queued == 0 && !it.ended }
      val ready = contributors.filter { it.queued > 0 }
      if (waiting || ready.isEmpty()) {
        val finished = voices.isNotEmpty() && voices.all { it.ended && it.queued == 0 }
        if (!finished) return
        if (tailLeft < 0) tailLeft = dsp.latencyFrames
        if (tailLeft == 0) { if (!stopped && voices.any { it.playing }) { stopped = true; actual.stop() }; return }
        val count = minOf(1024, tailLeft)
        val zeros = ByteBuffer.allocateDirect(count * channels * 4).order(ByteOrder.nativeOrder())
        dsp.process(zeros, count); tailLeft -= count
        pending = physicalBytes(zeros, count, config.encoding)
        pendingTimeUs = writtenFrames * 1_000_000L / config.sampleRate
        writtenFrames += count
        return@repeat
      }
      val count = minOf(1024, ready.minOf { it.queued })
      val values = FloatArray(count * channels)
      for (frame in 0 until count) {
        ready.forEach { it.frame(values, frame * channels) }
        mixedFrames++
      }
      val sum = ByteBuffer.allocateDirect(values.size * 4).order(ByteOrder.nativeOrder())
      sum.asFloatBuffer().put(values)
      dsp.process(sum, count)
      pending = physicalBytes(sum, count, config.encoding)
      pendingTimeUs = writtenFrames * 1_000_000L / config.sampleRate
      writtenFrames += count
    }
  }

  private var noise = 0x6d2b79f5
  private fun random(): Float { noise = noise xor (noise shl 13); noise = noise xor (noise ushr 17); noise = noise xor (noise shl 5); return (noise ushr 8) / 16777216f }
  private fun physicalBytes(source: ByteBuffer, frames: Int, encoding: Int): ByteBuffer {
    if (encoding == C.ENCODING_PCM_FLOAT) return source
    check(encoding == C.ENCODING_PCM_16BIT)
    val count = frames * Integer.bitCount(checkNotNull(physicalConfig).channelMask)
    val result = ByteBuffer.allocateDirect(count * 2).order(ByteOrder.nativeOrder())
    repeat(count) {
      val value = source.float
      val quantized = kotlin.math.round(value * 32768.0 + random() - random()).toInt().coerceIn(-32768, 32767)
      result.putShort(quantized.toShort())
    }
    result.flip(); return result
  }

  private fun dispose() {
    pending = null
    limiter?.close(); limiter = null
    val own = physical
    physical = null; physicalConfig = null
    if (own != null) {
      releases.incrementAndGet()
      own.addListener(object : AudioOutput.Listener {
        override fun onReleased() { if (releases.decrementAndGet() == 0 && closed) onIdle() }
        override fun onPositionAdvancing(time: Long) {}
        override fun onUnderrun() {}
        override fun onOffloadDataRequest() {}
        override fun onOffloadPresentationEnded() {}
      })
      own.release()
    }
  }
}
