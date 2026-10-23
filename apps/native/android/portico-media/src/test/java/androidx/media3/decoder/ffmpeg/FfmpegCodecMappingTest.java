package androidx.media3.decoder.ffmpeg;

import androidx.media3.common.MimeTypes;
import org.junit.Test;
import static org.junit.Assert.*;

public class FfmpegCodecMappingTest {
  @Test public void routeSourceBuiltAc4AndDtsExpressToTheirActualDecoders() {
    assertEquals("ac4", FfmpegLibrary.getCodecName(MimeTypes.AUDIO_AC4));
    assertEquals("dca", FfmpegLibrary.getCodecName(MimeTypes.AUDIO_DTS_EXPRESS));
    assertEquals("dca", FfmpegLibrary.getCodecName(MimeTypes.AUDIO_DTS_HD));
    assertEquals("truehd", FfmpegLibrary.getCodecName(MimeTypes.AUDIO_TRUEHD));
  }

  @Test public void genericDcaSupportDoesNotDeclareDtsUhdObjectDecoding() {
    assertNull(FfmpegLibrary.getCodecName(MimeTypes.AUDIO_DTS_X));
  }
}
