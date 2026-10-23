package tv.getportico.portico.native

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioMixerAttributes
import android.os.Build
import java.security.MessageDigest

/** The requested format and Android's accepted mixer state, never a physical DAC claim. */
internal class PorticoAudioOutput(context: Context) {
  private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val attributes = android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_MEDIA).setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC).build()
  private var mixerDevice: AudioDeviceInfo? = null
  private var mixerFormat: AudioFormat? = null
  var accepted = false; private set
  var reason = "No bit-perfect output requested"; private set
  fun prefer(device: AudioDeviceInfo?, format: AudioFormat, transparent: Boolean) {
    if (Build.VERSION.SDK_INT < 34) { reason = "Android 14 is required for a bit-perfect USB mixer"; return }
    if (device == null || device.type !in USB || !transparent) { clear(); reason = if (!transparent) "Audio processing is active" else "The output is not USB"; return }
    if (mixerDevice?.id == device.id && mixerFormat == format && accepted) return
    clear()
    val match = manager.getSupportedMixerAttributes(device).firstOrNull { it.mixerBehavior == AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT && it.format == format }
    if (match == null) { reason = "The USB output has no bit-perfect mixer for this exact format"; return }
    accepted = try { manager.setPreferredMixerAttributes(attributes, device, match) } catch (_: Exception) { false }
    if (accepted) { mixerDevice = device; mixerFormat = format }
    reason = if (accepted) "Android accepted the exact bit-perfect USB mixer format" else "Android refused the preferred mixer format"
  }
  fun clear() {
    if (Build.VERSION.SDK_INT >= 34) mixerDevice?.let { try { manager.clearPreferredMixerAttributes(attributes, it) } catch (_: Exception) {} }
    mixerDevice = null; mixerFormat = null; accepted = false
  }
  fun selected(): AudioDeviceInfo? = selected(manager)
  companion object {
    val USB = setOf(AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY)
    val DIGITAL = setOf(AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC, AudioDeviceInfo.TYPE_HDMI_EARC, AudioDeviceInfo.TYPE_LINE_DIGITAL)
    fun selected(manager: AudioManager): AudioDeviceInfo? {
      val outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      val priorities = listOf(setOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER),setOf(AudioDeviceInfo.TYPE_WIRED_HEADPHONES,AudioDeviceInfo.TYPE_WIRED_HEADSET),USB,DIGITAL,setOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER))
      return priorities.firstNotNullOfOrNull { types -> outputs.firstOrNull { it.type in types } }
    }
    fun key(device: AudioDeviceInfo?): String {
      val bytes = "${device?.type}:${device?.address}:${device?.productName}".toByteArray()
      return MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
  }
}
