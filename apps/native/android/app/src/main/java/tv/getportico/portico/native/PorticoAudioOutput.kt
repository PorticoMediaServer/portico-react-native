package tv.getportico.portico.native

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioMixerAttributes
import android.os.Build

/** The requested format and Android's accepted mixer state, never a physical DAC claim. */
internal class PorticoAudioOutput(context: Context) {
  private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var mixerAttributes: android.media.AudioAttributes? = null
  private var mixerDevice: AudioDeviceInfo? = null
  private var mixerFormat: AudioFormat? = null
  var accepted = false; private set
  var reason = "mixer_not_requested"; private set
  fun prefer(device: AudioDeviceInfo?, format: AudioFormat, attributes: android.media.AudioAttributes, transparent: Boolean) {
    if (Build.VERSION.SDK_INT < 34) { reason = "mixer_api_unavailable"; return }
    if (device == null || device.type !in USB || !transparent) { clear(); reason = if (!transparent) "mixer_processing_active" else "mixer_output_not_usb"; return }
    if (mixerDevice?.id == device.id && mixerFormat == format && mixerAttributes == attributes && accepted) return
    clear()
    val supported = try { manager.getSupportedMixerAttributes(device) } catch (_: Exception) { reason = "mixer_query_unavailable"; return }
    val match = supported.firstOrNull { it.mixerBehavior == AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT && it.format == format }
    if (match == null) { reason = "mixer_format_unavailable"; return }
    accepted = try { manager.setPreferredMixerAttributes(attributes, device, match) } catch (_: Exception) { false }
    if (accepted) { mixerDevice = device; mixerFormat = format; mixerAttributes = attributes }
    reason = if (accepted) "mixer_format_accepted" else "mixer_format_refused"
  }
  fun clear() {
    if (Build.VERSION.SDK_INT >= 34) mixerDevice?.let { device -> mixerAttributes?.let { attributes ->
      try { manager.clearPreferredMixerAttributes(attributes, device) } catch (_: Exception) {}
    } }
    mixerDevice = null; mixerFormat = null; mixerAttributes = null; accepted = false
  }
  fun anticipated(attributes: android.media.AudioAttributes): AudioDeviceInfo? = anticipated(manager, attributes)
  companion object {
    val USB = setOf(AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY)
    val DIGITAL = setOf(AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC, AudioDeviceInfo.TYPE_HDMI_EARC, AudioDeviceInfo.TYPE_LINE_DIGITAL)
    /** Policy's anticipated route is a pre-open hint, never an observation of a playing track. */
    fun anticipated(manager: AudioManager, attributes: android.media.AudioAttributes): AudioDeviceInfo? {
      if (Build.VERSION.SDK_INT < 33) return null
      return try { manager.getAudioDevicesForAttributes(attributes).singleOrNull() } catch (_: Exception) { null }
    }
  }
}
