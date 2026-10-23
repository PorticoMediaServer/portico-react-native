package tv.getportico.portico.native

import androidx.media3.decoder.ffmpeg.FfmpegLibrary

/** Only runtime-loaded source-built decoders are declared. Missing JNI never becomes a claim. */
internal object PorticoFfmpegDecoders {
  fun supports(mime: String): Boolean = try { FfmpegLibrary.supportsFormat(mime) } catch (_: LinkageError) { false } catch (_: RuntimeException) { false }
  val mimeCodecs = mapOf("audio/ac3" to "ac3", "audio/eac3" to "eac3", "audio/true-hd" to "truehd", "audio/vnd.dts" to "dts", "audio/vnd.dts.hd" to "dtshd", "audio/alac" to "alac", "audio/flac" to "flac", "audio/opus" to "opus", "audio/vorbis" to "vorbis", "audio/mpeg" to "mp3")
}
