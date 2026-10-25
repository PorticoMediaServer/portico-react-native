package tv.getportico.portico.native

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Run in the Android unit-test runtime with Media3 1.10.1 on the classpath. */
fun main() {
  val processor = PorticoAudioGain()
  processor.configure(AudioProcessor.AudioFormat(48000, 2, C.ENCODING_PCM_16BIT))
  processor.flush(AudioProcessor.StreamMetadata.DEFAULT)
  processor.target = 2f
  val input = ByteBuffer.allocateDirect(4800 * 4).order(ByteOrder.nativeOrder())
  repeat(4800) { input.putShort(4000); input.putShort(-4000) }
  input.flip(); processor.queueInput(input)
  val output = processor.output.order(ByteOrder.nativeOrder())
  check(output.remaining() == 4800 * 4)
  val samples = ShortArray(9600) { output.short }
  check(samples[8000].toInt() == 8000 && samples[8001].toInt() == -8000)
  check(samples[0].toInt() in 4000..4010)
  processor.target = 32f
  processor.flush(AudioProcessor.StreamMetadata.DEFAULT)
  val loud = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder()).putShort(20000).putShort(-20000)
  loud.flip(); processor.queueInput(loud)
  val limited = processor.output.order(ByteOrder.nativeOrder())
  check(limited.short.toInt() == 32767 && limited.short.toInt() == -32768)
  processor.reset()

  // 24-bit decoded audio is gained, then honestly narrowed when no output advertises 24-bit.
  val down = PorticoAudioGain()
  down.configure(AudioProcessor.AudioFormat(48000, 2, C.ENCODING_PCM_24BIT))
  down.target = 2f
  down.flush(AudioProcessor.StreamMetadata.DEFAULT)
  val packed = ByteBuffer.allocateDirect(6).order(ByteOrder.nativeOrder())
  for (sample in listOf(0x200000, -0x200000)) {
    packed.put((sample and 0xFF).toByte()); packed.put((sample shr 8 and 0xFF).toByte()); packed.put((sample shr 16 and 0xFF).toByte())
  }
  packed.flip(); down.queueInput(packed)
  val narrowed = down.output.order(ByteOrder.nativeOrder())
  check(narrowed.remaining() == 4 && narrowed.short.toInt() == 16384 && narrowed.short.toInt() == -16384)
  down.reset()

  // A device that advertises float keeps a unity float stream byte for byte.
  val floatDevice = PorticoAudioOutput.Device("usb dac", setOf(C.ENCODING_PCM_FLOAT), setOf(48000), setOf(2))
  val pure = PorticoAudioGain { listOf(floatDevice) }
  pure.configure(AudioProcessor.AudioFormat(48000, 2, C.ENCODING_PCM_FLOAT))
  pure.target = 1f
  pure.flush(AudioProcessor.StreamMetadata.DEFAULT)
  val floats = ByteBuffer.allocateDirect(8).order(ByteOrder.nativeOrder()).putFloat(0.25f).putFloat(-0.25f)
  floats.flip(); pure.queueInput(floats)
  val copied = pure.output.order(ByteOrder.nativeOrder())
  check(copied.remaining() == 8 && copied.float == 0.25f && copied.float == -0.25f)
  pure.reset()

  // The intersection itself: advertised precision is used, everything else falls to 16-bit.
  val unity16 = PorticoAudioOutput.choose(listOf(floatDevice), 48000, 2, C.ENCODING_PCM_16BIT, true)
  check(unity16.encoding == C.ENCODING_PCM_16BIT && unity16.bitPerfect && unity16.reason == "unity-passthrough")
  val device24 = PorticoAudioOutput.Device("dac", setOf(C.ENCODING_PCM_24BIT), setOf(96000), setOf(2))
  val gained24 = PorticoAudioOutput.choose(listOf(device24), 96000, 2, C.ENCODING_PCM_24BIT, false)
  check(gained24.encoding == C.ENCODING_PCM_24BIT && !gained24.bitPerfect && gained24.reason == "gain-applied")
  val narrowed24 = PorticoAudioOutput.choose(emptyList(), 96000, 2, C.ENCODING_PCM_24BIT, true)
  check(narrowed24.encoding == C.ENCODING_PCM_16BIT && !narrowed24.bitPerfect && narrowed24.reason == "device-16bit-only")
  val converted24 = PorticoAudioOutput.choose(listOf(floatDevice), 48000, 2, C.ENCODING_PCM_24BIT, true)
  check(converted24.encoding == C.ENCODING_PCM_FLOAT && !converted24.bitPerfect && converted24.reason == "device-convert")
}
