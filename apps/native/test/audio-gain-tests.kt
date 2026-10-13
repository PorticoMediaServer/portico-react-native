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
}
