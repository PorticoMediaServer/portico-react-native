package tv.getportico.portico.native

import android.content.Context
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.PlaybackParams
import android.os.Build
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.nio.ByteBuffer

/**
 * Integer PCM stays integer all the way to AudioTrack. DefaultAudioSink remains responsible for
 * encoded HDMI output. Gain/EQ require PCM; neither can silently disappear into passthrough.
 */
internal class PorticoPrecisionAudioSink(private val context: Context, fallback: AudioSink, private val dsp: PorticoPcmDsp, private val allowPassthrough: Boolean) : ForwardingAudioSink(fallback) {
  private var raw = false
  private var format = Format.Builder().build()
  private var encoding = PorticoPcmDsp.Encoding.S16
  private var audioFormat: AudioFormat? = null
  private var track: AudioTrack? = null
  private val output = PorticoAudioOutput(context)
  private var attributes = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()
  private var params = PlaybackParameters.DEFAULT
  private var listener: AudioSink.Listener? = null
  private var playing = false
  private var ended = false
  private var pending: ByteBuffer? = null
  private var input: ByteBuffer? = null
  private var bytesWritten = 0L
  private var headWraps = 0L
  private var lastHead = 0L
  private var baseUs = C.TIME_UNSET
  private var sessionId = 0
  private val trim = PorticoGaplessPcm()
  private var startTrim = 0L
  private var endTrim = 0L
  private var volume = 1f
  private var discontinuity = false
  private var frameBytes = 4

  override fun setListener(listener: AudioSink.Listener) { this.listener = listener; super.setListener(listener) }
  override fun getFormatSupport(format: Format): Int {
    if (format.sampleMimeType != MimeTypes.AUDIO_RAW) return if (allowPassthrough && dsp.transparent) super.getFormatSupport(format) else AudioSink.SINK_FORMAT_UNSUPPORTED
    val e = PorticoAudioGain.encoding(format.pcmEncoding) ?: return AudioSink.SINK_FORMAT_UNSUPPORTED
    if (e in setOf(PorticoPcmDsp.Encoding.S24,PorticoPcmDsp.Encoding.S32) && Build.VERSION.SDK_INT < 31) return AudioSink.SINK_FORMAT_UNSUPPORTED
    val mask = Util.getAudioTrackChannelConfig(format.channelCount)
    return if (mask != 0 && AudioTrack.getMinBufferSize(format.sampleRate,mask,platformEncoding(format.pcmEncoding)) > 0) AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY else AudioSink.SINK_FORMAT_UNSUPPORTED
  }
  override fun supportsFormat(format: Format) = getFormatSupport(format) != AudioSink.SINK_FORMAT_UNSUPPORTED
  override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
    val nextRaw = inputFormat.sampleMimeType == MimeTypes.AUDIO_RAW
    if (!nextRaw) {
      if (raw) releaseTrack()
      raw = false; output.clear(); super.configure(inputFormat,specifiedBufferSize,outputChannels); return
    }
    if (getFormatSupport(inputFormat) == AudioSink.SINK_FORMAT_UNSUPPORTED) throw AudioSink.ConfigurationException("Unsupported precise PCM output",inputFormat)
    if (outputChannels != null && !outputChannels.contentEquals(IntArray(inputFormat.channelCount) { it })) throw AudioSink.ConfigurationException("A channel remap must be planned before precise PCM output",inputFormat)
    val same = raw && format.sampleRate == inputFormat.sampleRate && format.channelCount == inputFormat.channelCount && format.pcmEncoding == inputFormat.pcmEncoding
    if (!same) { super.flush(); releaseTrack() }
    raw = true; format = inputFormat; encoding = PorticoAudioGain.encoding(format.pcmEncoding)!!; frameBytes = encoding.bytes * format.channelCount
    audioFormat = AudioFormat.Builder().setSampleRate(format.sampleRate).setEncoding(platformEncoding(format.pcmEncoding)).setChannelMask(Util.getAudioTrackChannelConfig(format.channelCount)).build()
    startTrim = format.encoderDelay.toLong(); endTrim = format.encoderPadding.toLong()
    trim.configure(frameBytes,startTrim,endTrim); dsp.configure(format.sampleRate,format.channelCount)
    ended = false
  }
  private fun ensureTrack() {
    if (track != null) return
    try {
      val af = audioFormat!!
      val device = output.selected()
      output.prefer(device,af,dsp.transparent && params == PlaybackParameters.DEFAULT && volume == 1f)
      val size = maxOf(AudioTrack.getMinBufferSize(format.sampleRate,af.channelMask,af.encoding),format.sampleRate * frameBytes / 5)
      val builder = AudioTrack.Builder().setAudioAttributes(attributes.audioAttributesV21.audioAttributes).setAudioFormat(af).setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(size)
      if (sessionId != 0) builder.setSessionId(sessionId)
      val made = builder.build()
      if (made.state != AudioTrack.STATE_INITIALIZED) { made.release(); error("AudioTrack did not initialize") }
      if (device != null) made.preferredDevice = device
      made.setVolume(volume)
      track = made
      setPlaybackParameters(params)
      if (playing) made.play()
    } catch (e: Exception) {
      output.clear(); throw AudioSink.InitializationException("Precise PCM output could not open",AudioTrack.STATE_UNINITIALIZED,format,false,e)
    }
  }
  override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
    if (!raw) return super.handleBuffer(buffer,presentationTimeUs,encodedAccessUnitCount)
    ensureTrack()
    if (pending == null) {
      if (baseUs == C.TIME_UNSET || discontinuity) { if(presentationTimeUs > startTrim * 1_000_000L / format.sampleRate) trim.seek(); baseUs = maxOf(0,presentationTimeUs) - playedFrames() * 1_000_000L / format.sampleRate; discontinuity = false }
      input = buffer
      pending = dsp.process(trim.process(buffer),encoding)
    } else check(input === buffer) { "The renderer changed a pending PCM buffer" }
    val active = track!!
    output.prefer(active.routedDevice ?: active.preferredDevice,audioFormat!!,dsp.transparent && params == PlaybackParameters.DEFAULT && volume == 1f)
    dsp.outputStatus = mapOf("sampleRate" to format.sampleRate,"channels" to format.channelCount,"pcmEncoding" to format.pcmEncoding,"eqEnabled" to dsp.eq.enabled,"gain" to dsp.target,"bitPerfectMixerAccepted" to output.accepted,"outputReason" to output.reason,"eqNotBitPerfect" to dsp.eq.enabled)
    val data = pending!!
    if (data.hasRemaining()) {
      val written = active.write(data,data.remaining(),AudioTrack.WRITE_NON_BLOCKING)
      if (written < 0) throw AudioSink.WriteException(written,format,false)
      bytesWritten += written
    }
    if (data.hasRemaining()) return false
    pending = null; input = null; return true
  }
  private fun playedFrames(): Long {
    val head = track?.playbackHeadPosition?.toLong()?.and(0xffffffffL) ?: return 0
    if (head < lastHead) headWraps++
    lastHead = head
    return minOf((headWraps shl 32) + head,bytesWritten / frameBytes)
  }
  override fun getCurrentPositionUs(sourceEnded: Boolean): Long = if (!raw) super.getCurrentPositionUs(sourceEnded) else if (baseUs == C.TIME_UNSET) AudioSink.CURRENT_POSITION_NOT_SET else baseUs + playedFrames() * 1_000_000L / format.sampleRate
  override fun play() { playing = true; if(raw) track?.play() else super.play() }
  override fun pause() { playing = false; if(raw) track?.pause() else super.pause() }
  override fun playToEndOfStream() { if(raw) { trim.end(); ended = true } else super.playToEndOfStream() }
  override fun hasPendingData(): Boolean = if(raw) pending?.hasRemaining() == true || playedFrames() < bytesWritten / frameBytes else super.hasPendingData()
  override fun isEnded() = if(raw) ended && !hasPendingData() else super.isEnded()
  override fun handleDiscontinuity() { if(raw) { discontinuity = true; listener?.onPositionDiscontinuity() } else super.handleDiscontinuity() }
  override fun setPlaybackParameters(playbackParameters: PlaybackParameters) {
    params = playbackParameters
    if(raw) { if(params != PlaybackParameters.DEFAULT) output.clear(); track?.playbackParams = PlaybackParams().setSpeed(params.speed).setPitch(params.pitch) } else super.setPlaybackParameters(playbackParameters)
  }
  override fun getPlaybackParameters() = if(raw) params else super.getPlaybackParameters()
  override fun setAudioAttributes(audioAttributes: AudioAttributes) { if(attributes != audioAttributes && raw) releaseTrack(); attributes = audioAttributes; super.setAudioAttributes(audioAttributes) }
  override fun getAudioAttributes() = attributes
  override fun setAudioSessionId(audioSessionId: Int) { if(sessionId != audioSessionId && raw) releaseTrack(); sessionId = audioSessionId; super.setAudioSessionId(audioSessionId) }
  override fun setVolume(volume: Float) { this.volume = volume; if(volume != 1f) output.clear(); if(raw) track?.setVolume(volume) else super.setVolume(volume) }
  override fun setSkipSilenceEnabled(skipSilenceEnabled: Boolean) { if(!raw) super.setSkipSilenceEnabled(skipSilenceEnabled) }
  override fun getSkipSilenceEnabled() = if(raw) false else super.getSkipSilenceEnabled()
  override fun flush() {
    if(raw) { track?.pause(); track?.flush(); pending = null; input = null; bytesWritten = 0; headWraps = 0; lastHead = 0; baseUs = C.TIME_UNSET; ended = false; trim.configure(frameBytes,startTrim,endTrim); dsp.reset(); if(playing)track?.play() }
    super.flush()
  }
  private fun releaseTrack() { track?.let { it.pause(); it.flush(); it.release() }; track = null; output.clear(); pending = null; input = null; bytesWritten = 0; headWraps = 0; lastHead = 0; baseUs = C.TIME_UNSET }
  override fun reset() { releaseTrack(); raw = false; super.reset() }
  override fun release() { releaseTrack(); super.release() }
  companion object {
    fun platformEncoding(value: Int) = when(value) { C.ENCODING_PCM_24BIT -> AudioFormat.ENCODING_PCM_24BIT_PACKED; C.ENCODING_PCM_32BIT -> AudioFormat.ENCODING_PCM_32BIT; else -> value }
  }
}
