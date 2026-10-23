package tv.getportico.portico.native

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

class PorticoPcmConformanceTest {
  private fun bytes(buffer: ByteBuffer) = ByteArray(buffer.remaining()).also { buffer.get(it) }
  @Test fun unityIsByteExactInEveryEncodingAndEightChannels() {
    for(e in PorticoPcmDsp.Encoding.entries) {
      val pcm=ByteArray(e.bytes*8*4096); java.util.Random(29).nextBytes(pcm)
      if(e==PorticoPcmDsp.Encoding.FLOAT) ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).apply { while(hasRemaining()) putFloat((position()%127-63)/64f) }
      val dsp=PorticoPcmDsp(); dsp.configure(192000,8)
      assertArrayEquals(e.name,pcm,bytes(dsp.process(ByteBuffer.wrap(pcm),e)))
    }
  }
  @Test fun gainPreservesPacked24LowBitsAndFloatPrecision() {
    for(e in listOf(PorticoPcmDsp.Encoding.S24,PorticoPcmDsp.Encoding.S32,PorticoPcmDsp.Encoding.FLOAT)) {
      val dsp=PorticoPcmDsp();dsp.target=0.5;dsp.configure(96000,1)
      val input=ByteBuffer.allocate(e.bytes*3).order(ByteOrder.LITTLE_ENDIAN)
      val samples=listOf(65537.0/8388608, -65537.0/8388608, 0.375)
      samples.forEach { PorticoPcmDsp.write(input,e,it) };input.flip()
      val output=dsp.process(input,e)
      samples.forEach { assertEquals(e.name,it*0.5,PorticoPcmDsp.read(output,e),if(e==PorticoPcmDsp.Encoding.S24)1.0/8388608 else 1e-8) }
    }
  }
  @Test fun trimsAreSampleExactAcrossArbitraryPacketBoundariesAndLossyPadding() {
    // Opus: 312 raw start frames and 648 padding frames, 1000 audible frames.
    val raw=ShortArray(1960) { (it-312).toShort() }
    val trim=PorticoGaplessPcm();trim.configure(2,312,648)
    val output=java.io.ByteArrayOutputStream()
    var at=0
    for(size in listOf(100,127,600,13,1000,120)) {
      val take=minOf(size,raw.size-at);val b=ByteBuffer.allocate(take*2).order(ByteOrder.LITTLE_ENDIAN)
      repeat(take) { b.putShort(raw[at++]) };b.flip();output.write(bytes(trim.process(b)))
    }
    assertEquals(raw.size,at);trim.end()
    val actual=ByteBuffer.wrap(output.toByteArray()).order(ByteOrder.LITTLE_ENDIAN)
    assertEquals(2000,actual.remaining());repeat(1000) { assertEquals(it.toShort(),actual.short) }
    assertEquals(960,trim.trimmedFrames)
    // The next track joins at exactly frame 1000, without silence or duplicate priming.
    trim.configure(2,1024,24)
    val next=ByteBuffer.allocate(2*2048).order(ByteOrder.LITTLE_ENDIAN)
    repeat(2048) { next.putShort((it-24).toShort()) };next.flip()
    val joined=trim.process(next);assertEquals(2000,joined.remaining());assertEquals(1000.toShort(),joined.order(ByteOrder.LITTLE_ENDIAN).short)
  }
  @Test fun peakingBandsMeetTheirCentreGainAndChannelsRemainIndependent() {
    val rate=48000
    for(band in PorticoPcmDsp.CENTRES.indices) {
      val gains=MutableList(10) { 0.0 };gains[band]=6.0
      val dsp=PorticoPcmDsp();dsp.eq=PorticoPcmDsp.Eq(true,0.0,gains);dsp.configure(rate,2)
      val f=PorticoPcmDsp.CENTRES[band];val input=ByteBuffer.allocate(rate*2*4).order(ByteOrder.LITTLE_ENDIAN)
      repeat(rate) { input.putFloat((0.1*sin(2*PI*f*it/rate)).toFloat());input.putFloat(0f) };input.flip()
      val out=dsp.process(input,PorticoPcmDsp.Encoding.FLOAT)
      var a=0.0;var b=0.0
      repeat(rate) { n -> val x=out.float.toDouble();assertEquals("channel leak",0f,out.float,0f); if(n>rate/2) { a+=x*x;val y=0.1*sin(2*PI*f*n/rate);b+=y*y } }
      assertEquals("band $band",6.0,10*log10(a/b),0.06)
    }
  }
  @Test fun invalidAndNonfiniteEqIsRefused() {
    for(eq in listOf(List(9){0.0},List(10){Double.NaN},List(10){13.0})) {
      try { PorticoPcmDsp.Eq(true,0.0,eq);fail("accepted invalid EQ") } catch(_: IllegalArgumentException) {}
    }
  }

  @Test fun appliedLevelingBelongsToProcessedNormalizationNotTransitionOrLaterControls() {
    val dsp=PorticoPcmDsp()
    fun process() = dsp.process(ByteBuffer.allocate(48000*4).order(ByteOrder.LITTLE_ENDIAN).apply {
      repeat(48000) { putFloat(0.25f) };flip()
    },PorticoPcmDsp.Encoding.FLOAT)
    dsp.gain=PorticoPcmDsp.Gain(0.5,1.0);dsp.configure(48000,1)
    assertFalse(dsp.processedLeveling)
    assertEquals(0.125f,process().float,0f)
    assertFalse("fade/user attenuation is not normalization",dsp.processedLeveling)
    dsp.gain=PorticoPcmDsp.Gain(0.5,0.5)
    assertFalse("a control update has not rendered samples",dsp.processedLeveling)
    process();assertTrue(dsp.processedLeveling)
    dsp.gain=PorticoPcmDsp.Gain(0.25,1.0)
    assertTrue("a later control cannot relabel the previous buffer",dsp.processedLeveling)
    assertEquals(0.5,dsp.processedGain.normalization,0.0)
    process();assertTrue("the ramp still contains the old normalization",dsp.processedLeveling)
    process();assertFalse(dsp.processedLeveling)
    dsp.gain=PorticoPcmDsp.Gain(1.0000001,1.0000001)
    process();assertTrue("display rounding never defines unity",dsp.processedLeveling)
    dsp.reset();assertFalse(dsp.processedLeveling)
    dsp.process(ByteBuffer.allocate(0),PorticoPcmDsp.Encoding.FLOAT)
    assertFalse("no decoded frames is not applied processing",dsp.processedLeveling)
    dsp.gain=PorticoPcmDsp.Gain(0.5,Double.NaN);dsp.reset()
    process();assertFalse("unknown normalization is not observed leveling",dsp.processedLeveling)
  }
}
