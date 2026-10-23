package tv.getportico.portico.native

import java.nio.ByteBuffer

/** Keeps end padding until EOS; trims are raw decoded frames, duration is audible frames. */
internal class PorticoGaplessPcm {
  private var frameBytes = 1
  private var startBytes = 0L
  private var paddingBytes = 0
  private var tail = ByteArray(0)
  var trimmedFrames = 0L; private set
  fun configure(bytesPerFrame: Int, startFrames: Long, endFrames: Long) {
    require(bytesPerFrame > 0 && startFrames in 0..MAX_TRIM && endFrames in 0..MAX_TRIM)
    require(endFrames * bytesPerFrame <= 16L * 1024 * 1024)
    frameBytes = bytesPerFrame; startBytes = startFrames * bytesPerFrame; paddingBytes = Math.multiplyExact(endFrames.toInt(), bytesPerFrame)
    tail = ByteArray(0); trimmedFrames = 0
  }
  fun process(input: ByteBuffer): ByteBuffer {
    require(input.remaining() % frameBytes == 0)
    val skip = minOf(startBytes, input.remaining().toLong()).toInt()
    input.position(input.position() + skip); startBytes -= skip; trimmedFrames += skip / frameBytes
    val total = tail.size + input.remaining()
    val emit = (total - paddingBytes).coerceAtLeast(0)
    val output = ByteBuffer.allocateDirect(emit)
    val fromTail = minOf(emit, tail.size)
    output.put(tail, 0, fromTail)
    val fromInput = emit - fromTail
    if (fromInput > 0) { val oldLimit = input.limit(); input.limit(input.position() + fromInput); output.put(input); input.limit(oldLimit) }
    val retained = ByteArray(total - emit)
    tail.copyInto(retained, 0, fromTail)
    input.get(retained, tail.size - fromTail, input.remaining()); tail = retained
    output.flip(); return output
  }
  fun end() { trimmedFrames += tail.size / frameBytes; tail = ByteArray(0) }
  fun seek() { startBytes = 0; tail = ByteArray(0) }
  companion object { const val MAX_TRIM = 768000L * 10 }
}
