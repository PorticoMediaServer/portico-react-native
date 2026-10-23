package tv.getportico.portico.native

import android.content.Context
import android.media.AudioManager
import android.media.AudioFormat
import android.os.Build
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.common.AudioAttributes

/** Do not infer object extensions from the presence of their base codec. */
internal object PorticoAudioVariants {
  data class Support(val codec: String,val variants: Set<String>,val maxChannels: Int,val objects: Set<String> = emptySet())
  fun fromEncoding(encoding: Int, apiLevel: Int = Build.VERSION.SDK_INT): Support? = when(encoding) {
    AudioFormat.ENCODING_AC3 -> Support("ac3",setOf("ac3"),6)
    AudioFormat.ENCODING_E_AC3 -> Support("eac3",setOf("eac3"),8)
    AudioFormat.ENCODING_E_AC3_JOC -> Support("eac3",setOf("eac3","eac3_joc"),8,setOf("atmos"))
    // The base TrueHD transport is not evidence that the receiver renders Atmos objects.
    AudioFormat.ENCODING_DOLBY_TRUEHD -> Support("truehd",setOf("truehd"),8)
    AudioFormat.ENCODING_DTS -> Support("dts",setOf("dts_core"),6)
    AudioFormat.ENCODING_DTS_HD -> Support("dts",setOf("dts_hd_hra"),8)
    AudioFormat.ENCODING_DTS_HD_MA -> if(apiLevel>=34) Support("dts",setOf("dts_hd_ma"),8) else null
    AudioFormat.ENCODING_DTS_UHD_P1 -> if(apiLevel>=31) Support("dts",setOf("dtsx"),8,setOf("dtsx")) else null
    AudioFormat.ENCODING_DTS_UHD_P2 -> if(apiLevel>=34) Support("dts",setOf("dtsx"),8,setOf("dtsx")) else null
    AudioFormat.ENCODING_AC4 -> Support("ac4",setOf("ac4"),8)
    else -> null
  }
  fun receiver(context: Context): List<Support> {
    val manager=context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val active=PorticoAudioOutput.anticipated(manager,AudioAttributes.DEFAULT.audioAttributesV21.audioAttributes)
    if(active!=null && active.type !in PorticoAudioOutput.DIGITAL) return emptyList()
    val encodings=active?.encodings?.toMutableSet() ?: mutableSetOf()
    val caps=AudioCapabilities.getCapabilities(context,AudioAttributes.DEFAULT,null)
    for(e in intArrayOf(AudioFormat.ENCODING_AC3,AudioFormat.ENCODING_E_AC3,AudioFormat.ENCODING_E_AC3_JOC,AudioFormat.ENCODING_DOLBY_TRUEHD,AudioFormat.ENCODING_DTS,AudioFormat.ENCODING_DTS_HD,AudioFormat.ENCODING_DTS_HD_MA,AudioFormat.ENCODING_DTS_UHD_P1,AudioFormat.ENCODING_DTS_UHD_P2,AudioFormat.ENCODING_AC4)) if(caps.supportsEncoding(e)) encodings.add(e)
    return encodings.mapNotNull { fromEncoding(it) }.groupBy { it.codec }.map { (codec,all) -> Support(codec,all.flatMap { it.variants }.toSet(),minOf(all.maxOf { it.maxChannels },active?.channelCounts?.maxOrNull()?.takeIf { it>0 } ?: caps.maxChannelCount),all.flatMap { it.objects }.toSet()) }
  }
  /** mpv may enable its family switch only for the selected variant. A core-only sink never gets HD. */
  fun mpv(context: Context,codec: String?,profile: String?): String {
    val c=codec?.lowercase() ?: return ""
    val p=profile?.lowercase() ?: ""
    val variant=when {
      c=="dts" && p.contains("dts:x") -> "dtsx"
      c=="dts" && (p.contains("master") || p.contains("ma")) -> "dts_hd_ma"
      c=="dts" && (p.contains("hra") || p.contains("high resolution")) -> "dts_hd_hra"
      c=="dts" && p.contains("express") -> "dts_express"
      c=="dts" && (p.isBlank() || p=="dts") -> "dts_core"
      c=="truehd" -> "truehd"
      c=="eac3" -> if(p.contains("atmos") || p.contains("joc")) "eac3_joc" else "eac3"
      c=="ac3" -> "ac3"
      else -> return ""
    }
    if(receiver(context).none { variant in it.variants }) return ""
    return when(variant) { "dts_core" -> "dts";"dts_hd_hra","dts_hd_ma","dtsx" -> "dts-hd";"truehd" -> "truehd";"eac3_joc","eac3" -> "eac3";"ac3" -> "ac3";else -> "" }
  }
}
