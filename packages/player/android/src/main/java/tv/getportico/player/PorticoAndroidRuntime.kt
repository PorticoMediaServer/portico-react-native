package tv.getportico.player

import android.content.Context
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.view.WindowManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal object PorticoAndroidRuntime {
  private const val RUNTIME_METADATA_KEY = "tv.getportico.runtime_family"
  private const val CAPABILITY_VERSION = "playback-capability-v2"
  private const val IDENTITY_SOURCE = "android-native-runtime"

  private data class RuntimeKind(
    val runtime: String,
    val formFactor: String,
    val nativePlatform: String,
    val deviceName: String,
    val family: String,
    val wirePlatform: String,
  )

  private data class VideoLimits(
    val width: Int,
    val height: Int,
    val frameRate: Int,
  )

  fun state(context: Context): Map<String, Any?> {
    val kind = runtimeKind(context)
      ?: return unavailableState(
        "PORTICO_ANDROID_RUNTIME_UNAVAILABLE",
        "Android runtime family metadata is missing or unsupported.",
      )
    val packageInfo = try {
      context.packageManager.getPackageInfo(context.packageName, 0)
    } catch (_: Throwable) {
      return unavailableState(
        "PORTICO_ANDROID_RUNTIME_UNAVAILABLE",
        "Android package identity is unavailable.",
      )
    }
    val appVersion = packageInfo.versionName?.trim().orEmpty()
    val buildNumber = if (Build.VERSION.SDK_INT >= 28) {
      packageInfo.longVersionCode.toString()
    } else {
      @Suppress("DEPRECATION")
      packageInfo.versionCode.toString()
    }
    val model = Build.MODEL.trim()
    val manufacturer = Build.MANUFACTURER.trim()
    if (appVersion.isEmpty() || buildNumber.isEmpty() || model.isEmpty() || manufacturer.isEmpty()) {
      return unavailableState(
        "PORTICO_ANDROID_RUNTIME_UNAVAILABLE",
        "Android runtime identity is incomplete.",
      )
    }

    val identity = mapOf(
      "runtime" to kind.runtime,
      "formFactor" to kind.formFactor,
      "nativePlatform" to kind.nativePlatform,
      "deviceName" to kind.deviceName,
      "packageName" to context.packageName,
      "applicationId" to context.packageName,
      "appVersion" to appVersion,
      "buildNumber" to buildNumber,
      "androidApiLevel" to Build.VERSION.SDK_INT,
      "model" to model,
      "manufacturer" to manufacturer,
      "identitySource" to IDENTITY_SOURCE,
    )
    val capability = capabilityState(context, kind, appVersion, kind.deviceName)
    val descriptor = mapOf(
      "version" to 1,
      "app" to "Portico",
      "os" to kind.runtime,
      "runtime" to kind.runtime,
      "formFactor" to kind.formFactor,
      "nativePlatform" to kind.nativePlatform,
      "deviceName" to kind.deviceName,
      "packageName" to context.packageName,
      "applicationId" to context.packageName,
      "appVersion" to appVersion,
      "buildNumber" to buildNumber,
      "identitySource" to IDENTITY_SOURCE,
      "capabilities" to mapOf(
        "playback" to mapOf(
          "version" to CAPABILITY_VERSION,
          "family" to kind.family,
          "source" to "native-runtime-required",
          "status" to capability["status"],
        ),
      ),
    )
    return mapOf(
      "status" to "available",
      "identity" to identity,
      "descriptor" to descriptor,
      "capabilities" to capability,
    )
  }

  private fun runtimeKind(context: Context): RuntimeKind? {
    val applicationInfo = try {
      context.packageManager.getApplicationInfo(context.packageName, 128)
    } catch (_: Throwable) {
      return null
    }
    val metadata = applicationInfo.metaData?.getString(RUNTIME_METADATA_KEY)?.trim()
    return when (metadata) {
      "android-mobile" -> RuntimeKind(
        runtime = "android",
        formFactor = "mobile",
        nativePlatform = "Android",
        deviceName = "Portico Android",
        family = "media3",
        wirePlatform = "android",
      )
      "android-tv" -> RuntimeKind(
        runtime = "android_tv",
        formFactor = "television",
        nativePlatform = "Android TV",
        deviceName = "Portico Android TV",
        family = "media3",
        wirePlatform = "android-tv",
      )
      "fire-tv" -> RuntimeKind(
        runtime = "fire_tv",
        formFactor = "television",
        nativePlatform = "Fire TV",
        deviceName = "Portico Fire TV",
        family = "fire-tv",
        wirePlatform = "fireos",
      )
      else -> null
    }
  }

  private fun capabilityState(
    context: Context,
    kind: RuntimeKind,
    appVersion: String,
    deviceName: String,
  ): Map<String, Any?> {
    val codecs = try {
      MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
        .filterNot { it.isEncoder }
    } catch (_: Throwable) {
      return capabilityUnavailable(
        "PORTICO_ANDROID_CAPABILITIES_UNAVAILABLE",
        "Android decoder capabilities are unavailable.",
      )
    }
    val types = codecs.flatMap { it.supportedTypes.asList() }
      .map { it.lowercase(Locale.US) }
      .toSet()
    val hasH264 = "video/avc" in types
    val hasAac = "audio/mp4a-latm" in types
    if (!hasH264 || !hasAac) {
      return capabilityUnavailable(
        "PORTICO_ANDROID_BASELINE_CODEC_UNAVAILABLE",
        "The Android runtime does not expose the required H.264/AAC baseline.",
      )
    }

    val limits = videoLimits(codecs)
    val maxChannels = audioChannels(codecs)
    val supportedVideo = buildList {
      add("h264")
      if ("video/hevc" in types) add("hevc")
      if ("video/x-vnd.on2.vp8" in types) add("vp8")
      if ("video/x-vnd.on2.vp9" in types) add("vp9")
      if ("video/av01" in types) add("av1")
    }
    val supportedAudio = buildList {
      add("aac")
      if ("audio/mpeg" in types) add("mp3")
      if ("audio/opus" in types) add("opus")
      if ("audio/vorbis" in types) add("vorbis")
      if ("audio/flac" in types) add("flac")
      if ("audio/ac3" in types) add("ac3")
      if ("audio/eac3" in types || "audio/eac3-joc" in types) add("eac3")
    }
    val hdrFormats = hdrFormats(context, "video/hevc" in types)
    val hasDolbyVision = "video/dolby-vision" in types && "dolby_vision" in hdrFormats
    val profile = mapOf(
      "capabilitySchemaVersion" to CAPABILITY_VERSION,
      "clientFamily" to kind.family,
      "clientVersion" to appVersion,
      "device" to deviceName,
      "platform" to kind.nativePlatform,
      "supportsHls" to true,
      "supportsMse" to false,
      "supportsMpegTs" to true,
      "supportedContainers" to listOf("hls", "mpegts", "mp4"),
      "supportedVideoCodecs" to supportedVideo,
      "supportedAudioCodecs" to supportedAudio,
      "supportedVideoProfiles" to listOf("h264:baseline"),
      "supportedPixelFormats" to listOf("yuv420p"),
      "supportedHdrFormats" to hdrFormats,
      "supportedDolbyVisionProfiles" to if (hasDolbyVision) listOf("dv") else emptyList<String>(),
      "maxWidth" to limits.width,
      "maxHeight" to limits.height,
      "maxFrameRate" to limits.frameRate,
      "maxAudioChannels" to maxChannels,
      "maxVideoBitDepth" to if (hdrFormats.isEmpty()) 8 else 10,
      "supportsHevc" to ("video/hevc" in types),
      "supportsHdr" to hdrFormats.isNotEmpty(),
      "supportsAc3" to ("audio/ac3" in types),
      "supportsEac3" to ("audio/eac3" in types || "audio/eac3-joc" in types),
      "prefersServerProxy" to true,
      "requiresServerProxy" to true,
      "capabilityEvidence" to listOf(
        mapOf(
          "id" to "android-media3-runtime",
          "source" to "native_runtime",
          "producer" to "portico-android-media3",
          "producerVersion" to "1",
          "confidence" to "high",
          "reviewedAt" to nowIso8601(),
          "tuples" to listOf(
            mapOf(
              "protocol" to "hls",
              "container" to "hls",
              "mediaKind" to "audiovisual",
              "audio" to mapOf(
                "codec" to "aac",
                "maxChannels" to maxChannels,
              ),
              "video" to mapOf(
                "codec" to "h264",
                "profile" to "baseline",
                "dynamicRange" to "sdr",
                "bitDepth" to 8,
                "maxWidth" to limits.width,
                "maxHeight" to limits.height,
                "maxFrameRate" to limits.frameRate,
              ),
              "subtitle" to mapOf(
                "mode" to "native",
                "codec" to "webvtt",
              ),
            ),
          ),
        ),
      ),
    )
    return mapOf("status" to "available", "profile" to profile)
  }

  private fun videoLimits(codecs: List<MediaCodecInfo>): VideoLimits {
    for (codec in codecs) {
      for (type in codec.supportedTypes) {
        if (!type.equals("video/avc", ignoreCase = true)) continue
        try {
          val capabilities = codec.getCapabilitiesForType(type).videoCapabilities ?: continue
          val width = minOf(1920, capabilities.supportedWidths.upper)
          val height = minOf(1080, capabilities.supportedHeights.upper)
          val frameRate = minOf(
            30,
            capabilities.getSupportedFrameRatesFor(width, height).upper.toInt(),
          )
          if (width > 0 && height > 0 && frameRate > 0) {
            return VideoLimits(width, height, frameRate)
          }
        } catch (_: Throwable) {
          continue
        }
      }
    }
    return VideoLimits(1920, 1080, 30)
  }

  private fun audioChannels(codecs: List<MediaCodecInfo>): Int {
    for (codec in codecs) {
      for (type in codec.supportedTypes) {
        if (!type.equals("audio/mp4a-latm", ignoreCase = true)) continue
        try {
          val channels = codec.getCapabilitiesForType(type).audioCapabilities
            ?.maxInputChannelCount ?: 2
          return minOf(2, maxOf(1, channels))
        } catch (_: Throwable) {
          return 2
        }
      }
    }
    return 2
  }

  private fun hdrFormats(context: Context, hasHevc: Boolean): List<String> {
    if (!hasHevc || Build.VERSION.SDK_INT < 24) return emptyList()
    return try {
      val manager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        ?: return emptyList()
      val types = manager.defaultDisplay.hdrCapabilities?.supportedHdrTypes ?: return emptyList()
      buildList {
        if (types.contains(1)) add("hdr10")
        if (types.contains(2)) add("hlg")
        if (types.contains(4)) add("dolby_vision")
      }
    } catch (_: Throwable) {
      emptyList()
    }
  }

  private fun capabilityUnavailable(code: String, message: String): Map<String, Any?> {
    return mapOf(
      "status" to "unavailable",
      "error" to mapOf("code" to code, "message" to message),
    )
  }

  private fun unavailableState(code: String, message: String): Map<String, Any?> {
    val error = mapOf("code" to code, "message" to message)
    return mapOf(
      "status" to "unavailable",
      "capabilities" to mapOf("status" to "unavailable", "error" to error),
      "error" to error,
    )
  }

  private fun nowIso8601(): String {
    return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = java.util.TimeZone.getTimeZone("UTC")
    }.format(Date())
  }
}
