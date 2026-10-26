package tv.getportico.portico.native

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRouting
import android.media.AudioTrack
import android.media.AudioTimestamp
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.RequiresApi
import androidx.media3.common.AudioAttributes
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.AudioOutput
import androidx.media3.exoplayer.audio.AudioOutputProvider
import androidx.media3.exoplayer.audio.AudioTrackAudioOutputProvider
import java.nio.ByteBuffer
import java.util.ArrayDeque
import java.io.Closeable
import java.util.concurrent.Executor

/** One sink's actual track, never a process-global requested rate. Provider callbacks run on the
 * renderer thread; only immutable original piece proofs cross to the main-thread reader. */
internal class PorticoAudioTrackOutput(private val context: Context, private val gain: PorticoAudioGain) {
  private interface MixerLease : Closeable { fun current(): Boolean; val deviceId: Int }
  private class Slot(val track: AudioTrack, val config: AudioSink.AudioTrackConfig,
                     mixer: MixerLease?, original: PorticoOutputWitness?) {
    @Volatile var mixer = mixer
    @Volatile var original = original
    @Volatile var attempted = original
    var attributes: AudioAttributes? = null
    @Volatile var live = true
    data class Run(val first: Long, var end: Long, val proof: PorticoOutputWitness?, val mixer: MixerLease?,
                   val routeId: Int?, val routeEpoch: Long)
    val runs = ArrayDeque<Run>()
    var writtenFrames = 0L
    @Volatile var routeEpoch = 0L
    var routing: AudioRouting.OnRoutingChangedListener? = null
  }
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var slot: Slot? = null
  private class Pending(val proof: PorticoOutputWitness?, val buffer: ByteBuffer) {
    val start = buffer.position()
    val end = buffer.limit()
    // A processor may modify its input in place. Identity alone cannot prove unchanged bytes.
    // Bound optional proof memory; a larger packet simply cannot claim bit-perfect transport.
    val bytes: ByteArray? = if (proof?.unchanged == true && buffer.remaining() <= (1 shl 20))
      ByteArray(buffer.remaining()).also { buffer.duplicate().get(it) } else null
    fun unchanged(final: ByteBuffer): Boolean {
      val saved = bytes ?: return false
      if (final !== buffer || final.position() < start || final.limit() != end) return false
      val view = final.duplicate()
      var at = view.position() - start
      while (view.hasRemaining()) if (view.get() != saved[at++]) return false
      return true
    }
  }
  @Volatile private var pending: Pending? = null
  @Volatile var downstreamUnity = false
    set(value) { if (field != value) { field = value; invalidate() } }

  private fun originalCurrent(proof: PorticoOutputWitness?): Boolean = gain.currentOutput(proof) &&
      proof != null && proof.stream.source.outputUntilMs > SystemClock.elapsedRealtime()

  fun prepare(proof: PorticoOutputWitness?, buffer: ByteBuffer) {
    val original = proof.takeIf(::originalCurrent)
    val held = pending
    if (held == null || held.proof !== original || held.buffer !== buffer || held.end != buffer.limit())
      pending = Pending(original, buffer)
  }

  private fun config(value: AudioOutputProvider.OutputConfig) = AudioSink.AudioTrackConfig(
      value.encoding, value.sampleRate, value.channelMask, value.isTunneling, value.isOffload, value.bufferSize)

  fun opened(track: AudioTrack, value: AudioOutputProvider.OutputConfig) {
    retireTrack()
    val own = Slot(track, config(value), null, null)
    own.attributes = value.audioAttributes
    val listener = AudioRouting.OnRoutingChangedListener {
      if (slot !== own || !own.live) return@OnRoutingChangedListener
      own.routeEpoch++
      own.attempted = null
      val routed = PorticoAudioSampleRate.routedDevice(track)
      own.mixer?.let { if (routed == null || routed.id != it.deviceId) it.close() }
    }
    own.routing = listener
    track.addOnRoutingChangedListener(listener, main)
    slot = own
  }

  /** Called at Media3's actual FINAL write, after its startup ramp, trims and processors. Buffer
   * identity is required: a delayed/new processor buffer cannot inherit today's input source. */
  private fun finalProof(own: Slot, buffer: ByteBuffer): PorticoOutputWitness? {
    val original = pending?.takeIf { it.buffer === buffer } ?: return null
    val proof = original.proof?.takeIf { originalCurrent(it) && matches(own.config, it) } ?: return null
    return if (original.unchanged(buffer)) proof else proof.processed()
  }

  fun beforeWrite(track: AudioTrack, buffer: ByteBuffer): PorticoOutputWitness? {
    val own = slot?.takeIf { it.track === track && it.live } ?: return null
    val proof = finalProof(own, buffer)
    own.mixer?.let { mixer ->
      if (!mixer.current() || own.original?.sameAs(proof) != true || !downstreamUnity || proof?.unchanged != true)
        invalidate()
    }
    if (Build.VERSION.SDK_INT >= 34) {
      Usb34.requireRetiredPreferenceCleared()
      if (own.mixer == null && own.attempted?.sameAs(proof) != true && downstreamUnity &&
          proof?.unchanged == true && proof.mode != PorticoAudioSampleRate.OFF &&
          !own.config.offload && !own.config.tunneling) {
        val routed = PorticoAudioSampleRate.routedDevice(track)
        if (routed != null) {
          own.attempted = proof
          own.original = proof
          own.mixer = own.attributes?.let {
            Usb34.acquire(context, own.config, it, proof, routed.id, ::originalCurrent)
          }
          Usb34.requireRetiredPreferenceCleared()
        }
      }
    }
    return proof
  }

  fun written(track: AudioTrack, buffer: ByteBuffer, before: Int, proof: PorticoOutputWitness?) {
    val own = slot?.takeIf { it.track === track && it.live } ?: return
    val frameBytes = PorticoAudioOutput.bytesPerSample(own.config.encoding) * Integer.bitCount(own.config.channelConfig)
    val bytes = buffer.position() - before
    if (bytes <= 0 || frameBytes <= 0) return
    val routeId = PorticoAudioSampleRate.routedDevice(track)?.id
    val routeEpoch = own.routeEpoch
    synchronized(own) {
      val count = bytes / frameBytes
      val current = proof.takeIf { bytes % frameBytes == 0 && originalCurrent(it) }
      val mixer = own.mixer?.takeIf { it.current() && current?.unchanged == true && downstreamUnity }
      val end = own.writtenFrames + count
      val last = own.runs.peekLast()
      if (last != null && last.mixer === mixer && last.routeId == routeId && last.routeEpoch == routeEpoch &&
          (last.proof?.sameAs(current) == true || last.proof == null && current == null)) last.end = end
      else own.runs.addLast(Slot.Run(own.writtenFrames, end, current, mixer, routeId, routeEpoch))
      own.writtenFrames = end
      // Bound observation history independently of audio buffering. Forgotten proof is unknown;
      // it never acquires the next run's source, processing or mixer authority.
      if (own.runs.size > 256) {
        val old = own.runs.removeFirst()
        while (own.runs.size > 128) own.runs.removeFirst()
        val boundary = own.runs.peekFirst()?.first ?: end
        own.runs.addFirst(Slot.Run(old.first, boundary, null, null, null, -1L))
      }
    }
  }

  /** Retire proof/preferences only. Media3 retains sole ownership of the AudioTrack descriptor. */
  fun invalidate() {
    // Keep the FIRST byte snapshot across a refused/partial write. Re-copying a processor's
    // already-mutated input on retry would manufacture an unchanged-byte proof.
    val own = slot ?: return
    own.mixer?.close()
    own.mixer = null
    own.attempted = null
  }
  fun checkOriginal() {
    slot?.original?.let { if (!originalCurrent(it)) invalidate() }
  }
  fun retireTrack(expected: AudioTrack? = null) {
    val own = slot ?: return
    if (expected != null && own.track !== expected) return
    slot = null
    pending = null
    own.live = false
    synchronized(own) { own.runs.clear() }
    try { own.routing?.let { own.track.removeOnRoutingChangedListener(it) } } catch (_: Exception) {}
    own.mixer?.close()
  }

  /** Track configuration is labelled as such. Only the real API34 USB mixer readback can prove
   * framework bit-perfect mode. Neither this snapshot nor AudioTrack.sampleRate measures a DAC. */
  fun snapshot(expected: PorticoAudioSourceTag): Map<String, Any>? = try { readSnapshot(expected) }
      catch (_: Exception) { null } // a concurrent native release is unknown, not a stale fact

  private fun readSnapshot(expected: PorticoAudioSourceTag): Map<String, Any>? {
    val own = slot ?: return null
    val track = own.track
    val stamp = AudioTimestamp()
    val timestamp = track.getTimestamp(stamp) && stamp.nanoTime > 0 && stamp.nanoTime <= System.nanoTime()
    val head = if (timestamp) stamp.framePosition else track.playbackHeadPosition.toLong() and 0xffffffffL
    val run = synchronized(own) {
      if (head <= 0 || head > own.writtenFrames) return null
      while (own.runs.size > 1 && own.runs.peekFirst().end < head) own.runs.removeFirst()
      own.runs.firstOrNull { head - 1 >= it.first && head - 1 < it.end }
    } ?: return null
    val proof = run.proof ?: return null
    if (!own.live || proof.stream.source !== expected || !originalCurrent(proof) || !matches(own.config, proof)) return null
    val routed = PorticoAudioSampleRate.routedDevice(track) ?: return null
    if (run.routeId != routed.id || run.routeEpoch != own.routeEpoch) return null
    if (track.state != AudioTrack.STATE_INITIALIZED || track.playState != AudioTrack.PLAYSTATE_PLAYING ||
        track.sampleRate != proof.sampleRate || track.channelCount != proof.channels ||
        track.audioFormat != proof.encoding) return null
    val mixerBitPerfect = downstreamUnity && proof.unchanged && own.original?.sameAs(proof) == true &&
        run.mixer?.let { it === own.mixer && it.deviceId == routed.id && it.current() } == true
    // Float32 transport does not establish that a 24/32-bit integer decoder retained every bit.
    // The current Media3 path proves source bit preservation only for unchanged PCM16.
    val bitPerfect = mixerBitPerfect && proof.encoding == androidx.media3.common.C.ENCODING_PCM_16BIT &&
        expected.sourceDepth == 16 && expected.sourceRate == track.sampleRate
    val matched = mixerBitPerfect && expected.sourceRate > 0 && expected.sourceRate == track.sampleRate
    val result = hashMapOf<String, Any>(
        "outputSampleRate" to track.sampleRate, "openedSampleRateKnown" to true,
        "outputRateKind" to "audioTrack-configured", "physicalOutputSampleRateKnown" to false,
        "outputChannels" to track.channelCount, "outputEncoding" to track.audioFormat,
        "routeDeviceId" to routed.id, "routeDeviceType" to routed.type,
        "sampleRateMatching" to proof.mode, "modeImplemented" to matched,
        "mixerBitPerfect" to mixerBitPerfect,
        "bitPerfectVerified" to bitPerfect, "usbDac" to isUsb(routed),
        "sampleRateMatched" to matched,
    )
    if (bitPerfect) result["bitPerfectMode"] = "android14-usb"
    if (slot !== own || !own.live || proof.stream.source !== expected || !originalCurrent(proof) ||
        mixerBitPerfect && own.mixer?.current() != true || run.routeEpoch != own.routeEpoch ||
        PorticoAudioSampleRate.routedDevice(track)?.id != routed.id) return null
    return result
  }

  private fun matches(config: AudioSink.AudioTrackConfig, proof: PorticoOutputWitness?): Boolean =
      proof != null && config.encoding == proof.encoding && config.sampleRate == proof.sampleRate &&
          Integer.bitCount(config.channelConfig) == proof.channels

  private fun isUsb(device: AudioDeviceInfo): Boolean = device.type == AudioDeviceInfo.TYPE_USB_DEVICE ||
      device.type == AudioDeviceInfo.TYPE_USB_HEADSET

  /** Preferred mixer attributes belong to this app UID, not one player. Serialize original
   * grants so a prepared/incoming deck cannot overwrite an audible owner's preference. No timer,
   * saved device setting, route chooser or another app's policy is involved. */
  @RequiresApi(34)
  private object Usb34 {
    private var active: Lease? = null
    private class Lease(val manager: AudioManager, val attributes: android.media.AudioAttributes,
                        val device: AudioDeviceInfo, val mixer: android.media.AudioMixerAttributes,
                        val proof: PorticoOutputWitness, val check: (PorticoOutputWitness?) -> Boolean) : MixerLease {
      @Volatile var live = true
      var listener: AudioManager.OnPreferredMixerAttributesChangedListener? = null
      override val deviceId: Int get() = device.id
      override fun current(): Boolean = live && check(proof) && try {
        manager.getPreferredMixerAttributes(attributes, device) == mixer
      } catch (_: Exception) { false }
      override fun close() = synchronized(Usb34) {
        live = false
        listener?.let { try { manager.removeOnPreferredMixerAttributesChangedListener(it) } catch (_: Exception) {} }
        listener = null
        // A changed preference is another writer's decision. Never clear or restore it.
        if (active === this) {
          try {
            if (manager.getPreferredMixerAttributes(attributes, device) != mixer ||
                manager.clearPreferredMixerAttributes(attributes, device) ||
                manager.getPreferredMixerAttributes(attributes, device) != mixer) active = null
          } catch (_: Exception) { /* retain the retired tombstone; new writes/opens refuse */ }
        }
      }
    }
    @Synchronized fun requireRetiredPreferenceCleared() {
      active?.takeIf { !it.live }?.close()
      check(active?.live != false) { "audio_output_policy_retirement_failed" }
    }
    @Synchronized fun acquire(context: Context, config: AudioSink.AudioTrackConfig, attributes: AudioAttributes,
                              proof: PorticoOutputWitness, routedId: Int?, check: (PorticoOutputWitness?) -> Boolean): MixerLease? {
      requireRetiredPreferenceCleared()
      if (active != null || !check(proof) || attributes.usage != android.media.AudioAttributes.USAGE_MEDIA) return null
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return null
      val platform = attributes.platformAudioAttributes
      return try {
        val device = manager.getAudioDevicesForAttributes(platform).singleOrNull()?.takeIf {
          it.type == AudioDeviceInfo.TYPE_USB_DEVICE || it.type == AudioDeviceInfo.TYPE_USB_HEADSET
        }?.takeIf { it.id == routedId } ?: return null
        // Do not steal an already installed preference, even if its values happen to match.
        if (manager.getPreferredMixerAttributes(platform, device) != null) return null
        val mixer = manager.getSupportedMixerAttributes(device).firstOrNull {
          it.mixerBehavior == android.media.AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT &&
              it.format.encoding == config.encoding && it.format.sampleRate == config.sampleRate &&
              it.format.channelMask == config.channelConfig && it.format.channelIndexMask == 0
        } ?: return null
        if (!check(proof) || !manager.setPreferredMixerAttributes(platform, device, mixer)) return null
        val own = Lease(manager, platform, device, mixer, proof, check)
        active = own
        val listener = AudioManager.OnPreferredMixerAttributesChangedListener { changed, output, value ->
          if (changed == platform && output.id == device.id && value != mixer) own.close()
        }
        own.listener = listener
        manager.addOnPreferredMixerAttributesChangedListener(Executor { it.run() }, listener)
        if (!own.current()) { own.close(); null } else own
      } catch (_: Exception) { active?.close(); null }
    }
  }
}

/** Public pinned Media3 output seam. Observe final bytes and the actual AudioTrack; nothing reads
 * a private field, reflects into the library, or infers final output from pre-processor input. */
internal class PorticoObservedOutputProvider(context: Context, private val observation: PorticoAudioTrackOutput,
                                             private val delegate: AudioTrackAudioOutputProvider =
                                                 AudioTrackAudioOutputProvider.Builder(context).build()) :
    AudioOutputProvider by delegate {
  override fun getAudioOutput(config: AudioOutputProvider.OutputConfig): AudioOutput {
    val actual = delegate.getAudioOutput(config)
    val track = actual.audioTrack
    try { observation.opened(track, config) } catch (failure: Exception) {
      observation.retireTrack(track)
      actual.release()
      throw failure
    }
    return object : AudioOutput by actual {
      override fun write(buffer: ByteBuffer, encodedAccessUnitCount: Int, presentationTimeUs: Long): Boolean {
        val proof = observation.beforeWrite(track, buffer)
        val before = buffer.position()
        val accepted = actual.write(buffer, encodedAccessUnitCount, presentationTimeUs)
        observation.written(track, buffer, before, proof)
        return accepted
      }
      override fun flush() { observation.retireTrack(track); actual.flush() }
      override fun release() { observation.retireTrack(track); actual.release() }
    }
  }
}
