package tv.getportico.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.Timeline
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.FileDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import java.io.File
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal class PorticoPlayerView(context: Context) : FrameLayout(context) {
  private val handler = Handler(Looper.getMainLooper())
  private val player = ExoPlayer.Builder(context).build()
  private val playerSurface = PlayerView(context)
  private var sourceURL = ""
  private var authorization = ""
  private var autoplay = true
  private var isLive = false
  private var metadataTitle = ""
  private var metadataSubtitle = ""
  private var startPositionSeconds = 0.0
  private var contentMode = ""
  private var rawPlaybackDescriptor: ReadableMap? = null
  private var playbackGeneration = 0
  private var generationValid = true
  private var configurationEpoch = 0L
  private var lastSourceKey: String? = null
  private var lastFailureKey: String? = null
  private var activeSource: SourceConfiguration? = null
  private var activeDescriptor: ValidatedPlaybackDescriptor? = null
  private var activeGeneration: Int? = null
  private val trackTargets = mutableMapOf<String, TrackTarget>()
  private var endSent = false
  private var released = false

  private val progressRunnable = object : Runnable {
    override fun run() {
      if (released) return
      emitProgress()
      handler.postDelayed(this, PROGRESS_INTERVAL_MS)
    }
  }

  private val listener = object : Player.Listener {
    override fun onPlaybackStateChanged(playbackState: Int) {
      when (playbackState) {
        Player.STATE_IDLE -> emitState(if (activeSource == null) "paused" else "loading")
        Player.STATE_BUFFERING -> emitState("buffering")
        Player.STATE_READY -> {
          emitState(if (player.isPlaying) "playing" else "paused")
          emitProgress()
          emitTracks()
        }
        Player.STATE_ENDED -> {
          emitState("paused")
          if (!endSent) {
            endSent = true
            PorticoPlayerEvent.dispatch(
              this@PorticoPlayerView,
              PorticoPlayerEvent.EVENT_END,
              snapshotPayload(),
            )
          }
        }
      }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (activeSource != null) emitState(if (isPlaying) "playing" else "paused")
    }

    override fun onPlayerError(error: PlaybackException) {
      emitPlaybackError(error)
    }

    override fun onTracksChanged(tracks: Tracks) {
      emitTracks(tracks)
    }

    override fun onTimelineChanged(timeline: Timeline, reason: Int) {
      if (activeSource != null) {
        emitState(currentPlaybackState())
        emitProgress()
      }
    }

    override fun onPositionDiscontinuity(
      oldPosition: Player.PositionInfo,
      newPosition: Player.PositionInfo,
      reason: Int,
    ) {
      if (activeSource != null) emitProgress()
    }
  }

  init {
    playerSurface.player = player
    playerSurface.useController = false
    playerSurface.layoutParams = LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.MATCH_PARENT,
    )
    addView(playerSurface)
    player.addListener(listener)
    emitCapabilities()
    emitTracks()
  }

  fun setSourceURL(value: String?) {
    sourceURL = value.orEmpty()
    scheduleConfiguration()
  }

  fun setAuthorization(value: String?) {
    authorization = value.orEmpty()
    scheduleConfiguration()
  }

  fun setAutoplay(value: Boolean) {
    autoplay = value
    if (!released) player.playWhenReady = value
  }

  fun setIsLive(value: Boolean) {
    isLive = value
    scheduleConfiguration()
  }

  fun setMetadataTitle(value: String?) {
    metadataTitle = value.orEmpty()
    scheduleConfiguration()
  }

  fun setMetadataSubtitle(value: String?) {
    metadataSubtitle = value.orEmpty()
    scheduleConfiguration()
  }

  fun setStartPositionSeconds(value: Double) {
    startPositionSeconds = if (value.isFinite()) value.coerceAtLeast(0.0) else 0.0
  }

  fun setContentMode(value: String?) {
    contentMode = value.orEmpty()
    if (activeSource != null) PorticoMediaSessionAuthority.attach(context, player, contentMode)
  }

  fun setPlaybackDescriptor(value: ReadableMap?) {
    rawPlaybackDescriptor = value
    scheduleConfiguration()
  }

  fun setAllowsCellularAccess(value: Boolean) {
    // The server-issued route and Android network policy own this decision.
  }

  fun setAllowsPictureInPicture(value: Boolean) {
    // Android PiP is not advertised until its lifecycle has a complete owner.
  }

  fun setWatchWithFriendsControlPolicy(value: String?) {
    // Watch-party authority remains in the JS/session owner.
  }

  fun setSeekIntervalSeconds(value: Double) {
    // The JS control surface owns the seek increment.
  }

  fun setPlaybackGeneration(value: Int) {
    if (value < 0) {
      generationValid = false
      invalidateForConfiguration()
      emitError(
        category = "configuration",
        kind = "stale-generation",
        availability = "unavailable",
        message = "Android playback generation is invalid.",
        renewalKind = "source",
      )
      return
    }
    generationValid = true
    if (playbackGeneration != value && activeGeneration != null) {
      clearConfiguredMedia()
    }
    playbackGeneration = value
    scheduleConfiguration()
  }

  fun acceptsGeneration(expectedGeneration: Int): Boolean {
    if (!generationValid || expectedGeneration < 0 || expectedGeneration != playbackGeneration) {
      emitStaleGeneration(expectedGeneration)
      return false
    }
    return true
  }

  fun rejectUnfencedCommand() {
    emitError(
      category = "configuration",
      kind = "stale-generation",
      availability = "unavailable",
      message = "Android playback commands require the current playback generation.",
      renewalKind = "source",
    )
  }

  fun playAtGeneration(expectedGeneration: Int) {
    if (!acceptsGeneration(expectedGeneration) || !hasConfiguredMedia()) return
    player.play()
  }

  fun pauseAtGeneration(expectedGeneration: Int) {
    if (!acceptsGeneration(expectedGeneration) || !hasConfiguredMedia()) return
    player.pause()
  }

  fun seekToAtGeneration(expectedGeneration: Int, seconds: Double) {
    if (!acceptsGeneration(expectedGeneration) || !hasConfiguredMedia()) return
    if (!seconds.isFinite() || seconds < 0.0) {
      emitError(
        category = "configuration",
        kind = "playback",
        availability = "unavailable",
        message = "Android playback seek position is invalid.",
      )
      return
    }
    val snapshot = playbackSnapshot()
    if (snapshot.seekable && snapshot.seekableEndSeconds > snapshot.seekableStartSeconds) {
      val bounded = seconds.coerceIn(snapshot.seekableStartSeconds, snapshot.seekableEndSeconds)
      player.seekTo((bounded * 1000.0).toLong())
    } else if (snapshot.isLive) {
      emitError(
        category = "configuration",
        kind = "playback",
        availability = "unavailable",
        message = "The Android live playback window is not seekable.",
      )
    } else {
      player.seekTo((seconds * 1000.0).toLong())
    }
  }

  fun setPlaybackRateAtGeneration(expectedGeneration: Int, rate: Double) {
    if (!acceptsGeneration(expectedGeneration) || !hasConfiguredMedia()) return
    if (!rate.isFinite()) {
      emitError(
        category = "configuration",
        kind = "playback",
        availability = "unavailable",
        message = "Android playback rate is invalid.",
      )
      return
    }
    player.setPlaybackSpeed(rate.coerceIn(0.5, 2.0).toFloat())
  }

  fun setVolumeAtGeneration(expectedGeneration: Int, volume: Double) {
    if (!acceptsGeneration(expectedGeneration) || released) return
    if (!volume.isFinite()) return
    player.volume = volume.coerceIn(0.0, 1.0).toFloat()
  }

  fun setSleepTimerDeadlineAtGeneration(expectedGeneration: Int, deadlineMilliseconds: Double) {
    if (!acceptsGeneration(expectedGeneration)) return
    // The JS sleep-timer owner pauses through the same generation fence.
  }

  fun startPictureInPictureAtGeneration(expectedGeneration: Int) {
    if (!acceptsGeneration(expectedGeneration)) return
    emitUnavailable("Android picture-in-picture is unavailable.")
  }

  fun stopPictureInPictureAtGeneration(expectedGeneration: Int) {
    if (!acceptsGeneration(expectedGeneration)) return
    emitUnavailable("Android picture-in-picture is unavailable.")
  }

  fun completePictureInPictureRestoreAtGeneration(
    expectedGeneration: Int,
    requestId: String,
    restored: Boolean,
  ) {
    if (!acceptsGeneration(expectedGeneration)) return
    // No restore request is emitted while Android PiP is unavailable.
  }

  fun selectAudioTrackAtGeneration(expectedGeneration: Int, trackId: String?) {
    selectTrack(expectedGeneration, trackId, C.TRACK_TYPE_AUDIO)
  }

  fun selectTextTrackAtGeneration(expectedGeneration: Int, trackId: String?) {
    selectTrack(expectedGeneration, trackId, C.TRACK_TYPE_TEXT)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    handler.removeCallbacks(progressRunnable)
    handler.post(progressRunnable)
  }

  override fun onDetachedFromWindow() {
    handler.removeCallbacks(progressRunnable)
    super.onDetachedFromWindow()
  }

  fun release() {
    if (released) return
    released = true
    handler.removeCallbacks(progressRunnable)
    PorticoMediaSessionAuthority.detach(context, player)
    player.removeListener(listener)
    player.release()
    trackTargets.clear()
    activeSource = null
    activeDescriptor = null
    activeGeneration = null
  }

  private fun scheduleConfiguration() {
    if (released) return
    configurationEpoch += 1
    val epoch = configurationEpoch
    handler.post {
      if (epoch == configurationEpoch) configureIfNeeded(epoch)
    }
  }

  private fun configureIfNeeded(epoch: Long) {
    if (released || epoch != configurationEpoch || sourceURL.isBlank()) return
    val runtimeState = PorticoAndroidRuntime.state(context)
    val runtimeStatus = runtimeState["status"] as? String ?: "unavailable"
    val runtimeCapabilities = runtimeState["capabilities"] as? Map<*, *>
    val capabilityStatus = runtimeCapabilities?.get("status") as? String ?: "unavailable"
    if (runtimeStatus != "available" || capabilityStatus != "available") {
      val blockedKey = "runtime|" + runtimeStatus + "|" + capabilityStatus
      if (lastFailureKey != blockedKey) {
        lastFailureKey = blockedKey
        clearConfiguredMedia()
        emitRuntimeUnavailable(runtimeStatus == "error" || capabilityStatus == "error")
      }
      return
    }
    if (!generationValid || playbackGeneration < 0) {
      failConfiguration(
        key = "generation|" + playbackGeneration,
        kind = "stale-generation",
        message = "Android playback generation is invalid.",
        renewalKind = "source",
      )
      return
    }

    val trimmedSource = sourceURL.trim()
    val source = if (trimmedSource.startsWith("file:", ignoreCase = true)) {
      val localUri = validateLocalSource(trimmedSource)
      if (localUri == null) {
        failConfiguration(
          key = "local|" + fingerprint(trimmedSource),
          kind = "local-unavailable",
          message = "The Android offline media file is unavailable.",
          renewalKind = null,
        )
        return
      }
      SourceConfiguration(
        uri = localUri,
        kind = "local",
        isHls = false,
        isLive = false,
        timelineTypeHint = "vod",
        authorization = "",
      )
    } else {
      val descriptor = validatePlaybackDescriptor(rawPlaybackDescriptor)
      if (descriptor == null) {
        failConfiguration(
          key = "descriptor|" + playbackGeneration + "|" + fingerprint(trimmedSource),
          kind = "source-renewal",
          message = "Android playback requires a complete scoped playback descriptor.",
          renewalKind = "source",
        )
        return
      }
      if (descriptor.generation != playbackGeneration) {
        failConfiguration(
          key = "descriptor-generation|" + playbackGeneration + "|" + descriptor.generation,
          kind = "stale-generation",
          message = "Android playback descriptor generation is stale.",
          renewalKind = "source",
        )
        return
      }
      val token = validateAuthorization(authorization)
      if (token == null || token != descriptor.mediaGrant) {
        failConfiguration(
          key = "grant|" + playbackGeneration + "|" + descriptor.revision,
          kind = "grant-renewal",
          message = "Android playback requires a non-empty scoped media grant.",
          renewalKind = "grant",
        )
        return
      }
      val resolvedUri = validateNetworkSource(trimmedSource, descriptor)
      if (resolvedUri == null) {
        failConfiguration(
          key = "source|" + playbackGeneration + "|" + descriptor.revision,
          kind = "source-renewal",
          message = "Android playback source is outside the scoped server route.",
          renewalKind = "source",
        )
        return
      }
      SourceConfiguration(
        uri = resolvedUri,
        kind = if (isHlsPath(resolvedUri)) "hls" else "direct",
        isHls = isHlsPath(resolvedUri),
        isLive = isLive,
        timelineTypeHint = descriptor.timelineType,
        authorization = token,
      ).also {
        activeDescriptor = descriptor
      }
    }

    val sourceKey = source.kind + "|" + source.uri + "|" + source.isLive + "|" +
      playbackGeneration + "|" + (activeDescriptor?.revision ?: "local") + "|" +
      fingerprint(source.authorization)
    if (lastSourceKey == sourceKey && activeSource != null) return
    if (epoch != configurationEpoch) return

    clearConfiguredMedia()
    activeSource = source
    activeGeneration = playbackGeneration
    lastSourceKey = sourceKey
    lastFailureKey = null
    endSent = false
    val mediaSource = buildMediaSource(source)
    if (epoch != configurationEpoch || released) {
      clearConfiguredMedia()
      return
    }
    player.setMediaSource(
      mediaSource,
      if (startPositionSeconds > 0.0) (startPositionSeconds * 1000.0).toLong() else C.TIME_UNSET,
    )
    player.playWhenReady = autoplay
    player.prepare()
    PorticoMediaSessionAuthority.attach(context, player, contentMode)
    emitCapabilities()
    emitTracks()
    emitState("loading")
    emitProgress()
  }

  private fun buildMediaSource(source: SourceConfiguration): MediaSource {
    val dataSourceFactory: DataSource.Factory
    if (source.kind == "local") {
      dataSourceFactory = FileDataSource.Factory()
    } else {
      val httpFactory = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(false)
      if (source.authorization.isNotEmpty()) {
        httpFactory.setDefaultRequestProperties(
          mapOf("Authorization" to "PorticoMedia " + source.authorization),
        )
      }
      dataSourceFactory = DefaultDataSource.Factory(context, httpFactory)
    }
    val mediaItem = MediaItem.Builder()
      .setUri(source.uri)
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(metadataTitle)
          .setArtist(metadataSubtitle)
          .build(),
      )
      .apply {
        if (source.isHls) setMimeType(MimeTypes.APPLICATION_M3U8)
      }
      .build()
    return if (source.isHls) {
      HlsMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem)
    } else {
      ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem)
    }
  }

  private fun validatePlaybackDescriptor(value: ReadableMap?): ValidatedPlaybackDescriptor? {
    if (value == null) return null
    val descriptorURL = readString(value, "url") ?: return null
    val mediaGrant = readString(value, "mediaGrant") ?: return null
    val sessionId = readString(value, "sessionId") ?: return null
    val continuationURL = readString(value, "continuationURL") ?: return null
    val revision = readString(value, "revision") ?: return null
    val generation = readInt(value, "playbackGeneration", 0) ?: return null
    val nextEventSequence = readInt(value, "nextEventSequence", 1) ?: return null
    val playbackRevision = readInt(value, "playbackRevision", 0) ?: return null
    val resumePosition = readDouble(value, "resumePositionSeconds") ?: return null
    if (!resumePosition.isFinite() || resumePosition < 0.0 || nextEventSequence < 1 || playbackRevision < 0) return null
    val origins = readStringArray(value, "serverOrigins") ?: return null
    if (origins.isEmpty() || origins.any { parseOrigin(it) == null }) return null
    val routePolicy = readMap(value, "routePolicy") ?: return null
    val allowInsecureLan = readBoolean(routePolicy, "allowInsecureLan") ?: return null
    val continuationCredential = readMap(value, "continuationCredential") ?: return null
    val continuationToken = readString(continuationCredential, "token") ?: return null
    val continuationOrigin = readString(continuationCredential, "origin") ?: return null
    val continuationExpiresAt = readString(continuationCredential, "expiresAt") ?: return null
    val continuationGeneration = readInt(continuationCredential, "generation", 0) ?: return null
    if (continuationToken.isEmpty() ||
      parseOrigin(continuationOrigin) == null ||
      continuationGeneration != generation ||
      (parseExpiry(continuationExpiresAt) ?: 0L) <= System.currentTimeMillis()
    ) return null
    val resolvedSource = resolveSourceUri(descriptorURL, origins, allowInsecureLan) ?: return null
    if (!isAllowedOrigin(resolvedSource, origins, allowInsecureLan)) return null
    val continuationUri = parseAbsoluteUri(continuationURL) ?: return null
    val expectedContinuationPath = "/api/playback-sessions/" +
      Uri.encode(sessionId, "") + "/continuation"
    if (continuationUri.path != expectedContinuationPath ||
      continuationUri.query != null ||
      continuationUri.fragment != null ||
      !sameOrigin(continuationUri, continuationOrigin) ||
      !isAllowedOrigin(continuationUri, origins, allowInsecureLan)
    ) return null
    val timelineType = if (value.hasKey("timelineType") && !value.isNull("timelineType")) {
      if (value.getType("timelineType") != ReadableType.String) return null
      value.getString("timelineType")?.trim()?.takeIf { it in TIMELINE_TYPES }
        ?: return null
    } else {
      null
    }
    return ValidatedPlaybackDescriptor(
      url = descriptorURL,
      resolvedUri = resolvedSource,
      mediaGrant = mediaGrant,
      sessionId = sessionId,
      revision = revision,
      generation = generation,
      timelineType = timelineType,
    )
  }

  private fun validateNetworkSource(
    value: String,
    descriptor: ValidatedPlaybackDescriptor,
  ): Uri? {
    if (value.isEmpty() || value != descriptor.url) return null
    val uri = descriptor.resolvedUri
    if (uri.fragment != null || uri.host.isNullOrBlank()) return null
    if (!API_RESOURCE_PATH_PATTERN.containsMatchIn(uri.path.orEmpty())) return null
    if (uri.queryParameterNames.any { it.lowercase(Locale.US) in BLOCKED_QUERY_KEYS }) return null
    return uri
  }

  private fun validateLocalSource(value: String): Uri? {
    if (authorization.isNotBlank() || value.length > MAX_SOURCE_LENGTH ||
      value.any { it == '\u0000' || it == '\r' || it == '\n' } ||
      USER_INFO_PATTERN.containsMatchIn(value)
    ) return null
    val uri = try {
      Uri.parse(value)
    } catch (_: Throwable) {
      return null
    }
    if (uri.scheme?.lowercase(Locale.US) != "file" ||
      !uri.host.isNullOrBlank() ||
      uri.fragment != null ||
      uri.query != null ||
      uri.path.isNullOrBlank() ||
      !uri.path!!.startsWith("/") ||
      isHlsPath(uri)
    ) return null
    val canonical = try {
      File(uri.path!!).canonicalFile
    } catch (_: Throwable) {
      return null
    }
    if (!canonical.isFile || !canonical.canRead()) return null
    val roots = listOfNotNull(
      context.filesDir,
      context.cacheDir,
      context.noBackupFilesDir,
      context.getExternalFilesDir(null),
      context.externalCacheDir,
    ).mapNotNull {
      try {
        it.canonicalFile
      } catch (_: Throwable) {
        null
      }
    }
    if (roots.none { isWithin(canonical, it) }) return null
    return Uri.fromFile(canonical)
  }

  private fun validateAuthorization(value: String): String? {
    if (!value.startsWith("PorticoMedia ")) return null
    val token = value.removePrefix("PorticoMedia ")
    if (token.isEmpty() || token.length > MAX_AUTHORIZATION_LENGTH ||
      token.any { it.isWhitespace() || it == '\u0000' || it == '\r' || it == '\n' }
    ) return null
    return token
  }

  private fun selectTrack(expectedGeneration: Int, trackId: String?, type: Int) {
    if (!acceptsGeneration(expectedGeneration)) return
    val requestedId = trackId?.trim().orEmpty()
    if (type == C.TRACK_TYPE_AUDIO && requestedId.isEmpty()) {
      emitError(
        category = "configuration",
        kind = "track-selection",
        availability = "unavailable",
        message = "Android audio track selection requires a published track id.",
      )
      return
    }
    if (type == C.TRACK_TYPE_TEXT && requestedId.isEmpty()) {
      val parameters = player.trackSelectionParameters.buildUpon()
        .clearOverridesOfType(C.TRACK_TYPE_TEXT)
        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        .build()
      player.trackSelectionParameters = parameters
      emitTracks()
      return
    }
    val target = trackTargets[requestedId]
    if (target == null || target.generation != playbackGeneration || target.type != type ||
      !target.supported
    ) {
      emitError(
        category = "configuration",
        kind = "track-selection",
        availability = "unavailable",
        message = "The requested Android media track is not published or supported.",
      )
      return
    }
    val parameters = player.trackSelectionParameters.buildUpon()
      .clearOverridesOfType(type)
      .setTrackTypeDisabled(type, false)
      .setOverrideForType(TrackSelectionOverride(target.group, target.trackIndex))
      .build()
    player.trackSelectionParameters = parameters
    emitTracks()
  }

  private fun emitCapabilities() {
    val state = PorticoAndroidRuntime.state(context)
    val identity = state["identity"] as? Map<*, *>
    val capabilities = state["capabilities"] as? Map<*, *>
    val map = Arguments.createMap().apply {
      putBoolean("backgroundAudio", false)
      putString("mediaFamily", "video")
      putBoolean("nowPlaying", false)
      putBoolean("pictureInPictureEligible", false)
      putBoolean("remoteCommands", false)
      putBoolean("pictureInPictureActive", false)
      putBoolean("pictureInPicturePossible", false)
      putBoolean("pictureInPictureSupported", false)
      putString("runtimeFamily", identity?.get("runtime") as? String ?: "android")
      putString("runtime", identity?.get("runtime") as? String ?: "android")
      putString("capabilityStatus", capabilities?.get("status") as? String ?: "unavailable")
      putString("availability", capabilities?.get("status") as? String ?: "unavailable")
      putInt("generation", playbackGeneration)
      putString("sourceKind", activeSource?.kind ?: "unavailable")
      val error = capabilities?.get("error") as? Map<String, Any?>
      if (error != null) putMap("error", Arguments.makeNativeMap(error))
      val profile = capabilities?.get("profile") as? Map<String, Any?>
      if (profile != null) putMap("clientProfile", Arguments.makeNativeMap(profile))
    }
    PorticoPlayerEvent.dispatch(this, PorticoPlayerEvent.EVENT_CAPABILITIES, map)
  }

  private fun emitState(state: String) {
    val payload = snapshotPayload()
    payload.putString("state", state)
    PorticoPlayerEvent.dispatch(this, PorticoPlayerEvent.EVENT_STATE, payload)
  }

  private fun emitProgress() {
    if (released) return
    val snapshot = playbackSnapshot()
    val payload = snapshotPayload().apply {
      putDouble("positionSeconds", snapshot.positionSeconds)
      putDouble("durationSeconds", snapshot.durationSeconds)
      putDouble("bufferedPositionSeconds", snapshot.bufferedPositionSeconds)
      putBoolean("isPlaying", player.isPlaying)
    }
    PorticoPlayerEvent.dispatch(this, PorticoPlayerEvent.EVENT_PROGRESS, payload)
  }

  private fun emitTracks(currentTracks: Tracks = player.currentTracks) {
    val tracks = Arguments.createArray()
    val audioTracks = Arguments.createArray()
    val textTracks = Arguments.createArray()
    val selectedAudio = mutableListOf<String>()
    val selectedText = mutableListOf<String>()
    trackTargets.clear()
    currentTracks.groups.forEachIndexed { groupIndex, group ->
      if (group.type != C.TRACK_TYPE_AUDIO && group.type != C.TRACK_TYPE_TEXT) return@forEachIndexed
      for (trackIndex in 0 until group.length) {
        val format = group.getTrackFormat(trackIndex)
        val id = trackId(group.type, groupIndex, trackIndex, format.id, format.language, format.sampleMimeType)
        trackTargets[id] = TrackTarget(
          id,
          group.getMediaTrackGroup(),
          trackIndex,
          group.type,
          playbackGeneration,
          group.isTrackSupported(trackIndex),
        )
        val track = Arguments.createMap().apply {
          putString("id", id)
          putString("type", if (group.type == C.TRACK_TYPE_AUDIO) "audio" else "text")
          putString("language", format.language ?: "")
          putString("label", format.label ?: "")
          putString("sampleMimeType", format.sampleMimeType ?: "")
          putString("codecs", format.codecs ?: "")
          putInt("roleFlags", format.roleFlags)
          putInt("selectionFlags", format.selectionFlags)
          putBoolean("supported", group.isTrackSupported(trackIndex))
          putBoolean("selected", group.isTrackSelected(trackIndex))
          if (format.bitrate != Format.NO_VALUE) putInt("bitrate", format.bitrate)
          if (format.channelCount != Format.NO_VALUE) putInt("channelCount", format.channelCount)
        }
        tracks.pushMap(track)
        if (group.type == C.TRACK_TYPE_AUDIO) {
          audioTracks.pushMap(track)
          if (group.isTrackSelected(trackIndex)) selectedAudio += id
        } else {
          textTracks.pushMap(track)
          if (group.isTrackSelected(trackIndex)) selectedText += id
        }
      }
    }
    val payload = snapshotPayload().apply {
      putArray("tracks", tracks)
      putArray("audioTracks", audioTracks)
      putArray("textTracks", textTracks)
      putStringOrNull(this, "selectedAudioTrackId", selectedAudio.firstOrNull())
      putStringOrNull(this, "selectedTextTrackId", selectedText.firstOrNull())
    }
    PorticoPlayerEvent.dispatch(this, PorticoPlayerEvent.EVENT_TRACKS, payload)
  }

  private fun emitPlaybackError(error: PlaybackException) {
    val chain = generateSequence(error as Throwable?) { it.cause }.toList()
    val responseCode = chain.filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
      .firstOrNull()?.responseCode
    val isGrantFailure = responseCode == 401 || responseCode == 403
    val category = when {
      isGrantFailure -> "grant"
      chain.any {
        it.javaClass.simpleName.contains("decoder", true) ||
          it.javaClass.simpleName.contains("codec", true)
      } -> "decoder"
      chain.any {
        val name = it.javaClass.simpleName.lowercase(Locale.US)
        name.contains("network") || name.contains("timeout") || name.contains("socket") ||
          name.contains("unknownhost") || name.contains("http")
      } -> "route"
      else -> "configuration"
    }
    val message = when {
      isGrantFailure -> "The Android playback grant was rejected and requires renewal."
      category == "decoder" -> "The Android decoder cannot play this stream."
      category == "route" -> "The Android playback route is unavailable."
      else -> "Android playback failed."
    }
    emitError(
      category = category,
      kind = if (isGrantFailure) "grant-renewal" else "playback",
      availability = "error",
      message = message,
      code = error.errorCode,
      httpStatus = responseCode,
      renewalKind = if (isGrantFailure) "grant" else null,
    )
    if (isGrantFailure) {
      handler.post {
        if (!released) {
          clearConfiguredMedia()
          emitState("error")
        }
      }
    }
  }

  private fun emitUnavailable(message: String) {
    emitError(
      category = "configuration",
      kind = "configuration",
      availability = "unavailable",
      message = message,
    )
  }

  private fun emitRuntimeUnavailable(isError: Boolean) {
    emitError(
      category = "configuration",
      kind = "configuration",
      availability = if (isError) "error" else "unavailable",
      message = if (isError) {
        "Android playback capability evidence failed."
      } else {
        "Android playback capability evidence is unavailable."
      },
    )
  }

  private fun emitError(
    category: String,
    kind: String,
    availability: String,
    message: String,
    code: Int? = null,
    httpStatus: Int? = null,
    renewalKind: String? = null,
  ) {
    val payload = Arguments.createMap().apply {
      if (code != null) putInt("code", code)
      if (httpStatus != null) putInt("httpStatus", httpStatus)
      putString("domain", "android.media3")
      putString("category", category)
      putString("kind", kind)
      putString("message", message)
      putString("availability", availability)
      putString("nativeState", if (availability == "error") "error" else "unavailable")
      putInt("generation", playbackGeneration)
      putBoolean("renewalRequired", renewalKind != null)
      putStringOrNull(this, "renewalKind", renewalKind)
      putString("sourceKind", activeSource?.kind ?: "unavailable")
    }
    PorticoPlayerEvent.dispatch(this, PorticoPlayerEvent.EVENT_ERROR, payload)
  }

  private fun emitStaleGeneration(expectedGeneration: Int) {
    emitError(
      category = "configuration",
      kind = "stale-generation",
      availability = "unavailable",
      message = "The Android playback command belongs to a stale generation.",
      renewalKind = "source",
    )
  }

  private fun failConfiguration(
    key: String,
    kind: String,
    message: String,
    renewalKind: String?,
  ) {
    if (lastFailureKey == key) return
    lastFailureKey = key
    clearConfiguredMedia()
    emitError(
      category = if (kind == "grant-renewal") "grant" else "configuration",
      kind = kind,
      availability = if (kind == "grant-renewal") "error" else "unavailable",
      message = message,
      renewalKind = renewalKind,
    )
  }

  private fun invalidateForConfiguration() {
    configurationEpoch += 1
    lastSourceKey = null
    clearConfiguredMedia()
  }

  private fun clearConfiguredMedia() {
    if (!released && player.mediaItemCount > 0) {
      player.clearMediaItems()
    }
    trackTargets.clear()
    activeSource = null
    activeDescriptor = null
    activeGeneration = null
  }

  private fun hasConfiguredMedia(): Boolean {
    if (activeSource == null || activeGeneration != playbackGeneration || player.mediaItemCount == 0) {
      emitError(
        category = "configuration",
        kind = "playback",
        availability = "unavailable",
        message = "Android playback is not prepared for the current generation.",
      )
      return false
    }
    return true
  }

  private fun currentPlaybackState(): String {
    return when (player.playbackState) {
      Player.STATE_BUFFERING -> "buffering"
      Player.STATE_READY -> if (player.isPlaying) "playing" else "paused"
      Player.STATE_ENDED -> "paused"
      else -> "loading"
    }
  }

  private fun snapshotPayload(): com.facebook.react.bridge.WritableMap {
    val snapshot = playbackSnapshot()
    return Arguments.createMap().apply {
      putInt("generation", playbackGeneration)
      putString("sourceKind", snapshot.sourceKind)
      putString("timelineType", snapshot.timelineType)
      putBoolean("isLive", snapshot.isLive)
      putBoolean("isDvr", snapshot.isDvr)
      putBoolean("seekable", snapshot.seekable)
      putDouble("seekableStartSeconds", snapshot.seekableStartSeconds)
      putDouble("seekableEndSeconds", snapshot.seekableEndSeconds)
      putDouble("liveOffsetSeconds", snapshot.liveOffsetSeconds)
    }
  }

  private fun playbackSnapshot(): PlaybackSnapshot {
    val source = activeSource
    val hasWindow = player.currentTimeline.windowCount > 0 &&
      player.currentWindowIndex >= 0 &&
      player.currentWindowIndex < player.currentTimeline.windowCount
    val window = Timeline.Window()
    if (hasWindow) player.currentTimeline.getWindow(player.currentWindowIndex, window)
    val durationMilliseconds = safeMilliseconds(player.duration).takeIf { it > 0 }
      ?: safeMilliseconds(if (hasWindow) window.durationMs else C.TIME_UNSET)
    val positionMilliseconds = safeMilliseconds(player.currentPosition)
    val bufferedMilliseconds = safeMilliseconds(player.bufferedPosition)
    val liveWindow = source?.isLive == true || (hasWindow && runCatching {
      player.isCurrentWindowLive
    }.getOrDefault(false))
    val seekable = hasWindow && window.isSeekable
    val seekableEnd = if (seekable) durationMilliseconds / 1000.0 else 0.0
    val timelineType = source?.timelineTypeHint ?: when {
      liveWindow && seekable && seekableEnd > 0.0 -> "dvr"
      liveWindow -> "live"
      else -> "vod"
    }
    return PlaybackSnapshot(
      sourceKind = source?.kind ?: "unavailable",
      timelineType = timelineType,
      isLive = liveWindow,
      isDvr = timelineType == "dvr",
      positionSeconds = positionMilliseconds / 1000.0,
      durationSeconds = durationMilliseconds / 1000.0,
      bufferedPositionSeconds = bufferedMilliseconds / 1000.0,
      seekable = seekable,
      seekableStartSeconds = 0.0,
      seekableEndSeconds = seekableEnd,
      liveOffsetSeconds = safeMilliseconds(player.currentLiveOffset) / 1000.0,
    )
  }

  private fun safeMilliseconds(value: Long): Long {
    return if (value == C.TIME_UNSET || value < 0L) 0L else value
  }

  private fun readString(map: ReadableMap, key: String): String? {
    if (!map.hasKey(key) || map.isNull(key) || map.getType(key) != ReadableType.String) return null
    return map.getString(key)?.trim()?.takeIf { it.isNotEmpty() }
  }

  private fun readMap(map: ReadableMap, key: String): ReadableMap? {
    if (!map.hasKey(key) || map.isNull(key) || map.getType(key) != ReadableType.Map) return null
    return map.getMap(key)
  }

  private fun readBoolean(map: ReadableMap, key: String): Boolean? {
    if (!map.hasKey(key) || map.isNull(key) || map.getType(key) != ReadableType.Boolean) return null
    return map.getBoolean(key)
  }

  private fun readDouble(map: ReadableMap, key: String): Double? {
    if (!map.hasKey(key) || map.isNull(key) || map.getType(key) != ReadableType.Number) return null
    return map.getDouble(key)
  }

  private fun readInt(map: ReadableMap, key: String, minimum: Int): Int? {
    val value = readDouble(map, key) ?: return null
    if (!value.isFinite() || value % 1.0 != 0.0 || value < minimum || value > Int.MAX_VALUE) return null
    return value.toInt()
  }

  private fun readStringArray(map: ReadableMap, key: String): List<String>? {
    if (!map.hasKey(key) || map.isNull(key) || map.getType(key) != ReadableType.Array) return null
    val array = map.getArray(key) ?: return null
    val result = mutableListOf<String>()
    for (index in 0 until array.size()) {
      if (array.isNull(index) || array.getType(index) != ReadableType.String) return null
      val value = array.getString(index)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
      result += value
    }
    return result
  }

  private fun parseAbsoluteUri(value: String): Uri? {
    val uri = try {
      Uri.parse(value)
    } catch (_: Throwable) {
      return null
    }
    return if (uri.scheme != null && !uri.host.isNullOrBlank() && parseOrigin(value) != null) uri else null
  }

  private fun resolveSourceUri(value: String, origins: List<String>, allowInsecureLan: Boolean): Uri? {
    if (value.length > MAX_SOURCE_LENGTH || value.any { it == '\u0000' || it == '\r' || it == '\n' } ||
      USER_INFO_PATTERN.containsMatchIn(value)
    ) return null
    val candidate = if (value.startsWith("/")) {
      Uri.parse(origins.first() + value)
    } else {
      parseAbsoluteUri(value) ?: return null
    }
    if (candidate.fragment != null || candidate.host.isNullOrBlank()) return null
    if (!isAllowedOrigin(candidate, origins, allowInsecureLan)) return null
    return candidate
  }

  private fun parseOrigin(value: String): String? {
    val uri = try {
      Uri.parse(value)
    } catch (_: Throwable) {
      return null
    }
    val scheme = uri.scheme?.lowercase(Locale.US) ?: return null
    val authority = uri.encodedAuthority ?: return null
    if (scheme != "http" && scheme != "https" || authority.isEmpty() ||
      authority.contains("@") || uri.path.orEmpty().isNotEmpty() && uri.path != "/" ||
      uri.query != null || uri.fragment != null
    ) return null
    return scheme + "://" + authority.lowercase(Locale.US)
  }

  private fun isAllowedOrigin(uri: Uri, origins: List<String>, allowInsecureLan: Boolean): Boolean {
    val origin = parseOrigin(
      uri.scheme.orEmpty() + "://" + uri.encodedAuthority.orEmpty(),
    ) ?: return false
    if (uri.scheme.equals("http", ignoreCase = true) &&
      (!allowInsecureLan || !isTrustedInsecureHost(uri.host.orEmpty()))
    ) return false
    return origins.mapNotNull { parseOrigin(it)?.lowercase(Locale.US) }
      .any { it == origin.lowercase(Locale.US) }
  }

  private fun sameOrigin(uri: Uri, origin: String): Boolean {
    val left = parseOrigin(uri.scheme.orEmpty() + "://" + uri.encodedAuthority.orEmpty())
    val right = parseOrigin(origin)
    return left != null && right != null && left.equals(right, ignoreCase = true)
  }

  private fun isTrustedInsecureHost(host: String): Boolean {
    val normalized = host.trim().lowercase(Locale.US).removePrefix("[").removeSuffix("]")
    if (normalized == "localhost" || normalized == "::1" || normalized.startsWith("fe80:")) return true
    val octets = normalized.split(".").mapNotNull { it.toIntOrNull() }
    if (octets.size != 4 || octets.any { it !in 0..255 }) return false
    val first = octets[0]
    val second = octets[1]
    return first == 127 || first == 10 ||
      (first == 172 && second in 16..31) ||
      (first == 192 && second == 168) ||
      (first == 169 && second == 254)
  }

  private fun isWithin(file: File, root: File): Boolean {
    val filePath = file.path
    val rootPath = root.path.trimEnd(File.separatorChar)
    return filePath == rootPath || filePath.startsWith(rootPath + File.separator)
  }

  private fun parseExpiry(value: String): Long? {
    val patterns = arrayOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX")
    for (pattern in patterns) {
      try {
        val formatter = SimpleDateFormat(pattern, Locale.US).apply {
          timeZone = TimeZone.getTimeZone("UTC")
          isLenient = false
        }
        val parsed: Date = formatter.parse(value) ?: continue
        return parsed.time
      } catch (_: Throwable) {
        // Try the next strict ISO-8601 precision.
      }
    }
    return null
  }

  private fun isHlsPath(uri: Uri): Boolean {
    val path = uri.path?.lowercase(Locale.US).orEmpty()
    return path.endsWith(".m3u8") || path.contains("/hls/")
  }

  private fun trackId(
    type: Int,
    groupIndex: Int,
    trackIndex: Int,
    formatId: String?,
    language: String?,
    sampleMimeType: String?,
  ): String {
    val typeName = if (type == C.TRACK_TYPE_AUDIO) "audio" else "text"
    val material = typeName + "|" + groupIndex + "|" + trackIndex + "|" +
      (formatId ?: "") + "|" + (language ?: "") + "|" + (sampleMimeType ?: "")
    return typeName + ":" + groupIndex + ":" + trackIndex + ":" + fingerprint(material).take(16)
  }

  private fun fingerprint(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { byte -> "%02x".format(Locale.US, byte.toInt() and 0xff) }
  }

  private fun putStringOrNull(
    map: com.facebook.react.bridge.WritableMap,
    key: String,
    value: String?,
  ) {
    if (value == null) map.putNull(key) else map.putString(key, value)
  }

  private data class ValidatedPlaybackDescriptor(
    val url: String,
    val resolvedUri: Uri,
    val mediaGrant: String,
    val sessionId: String,
    val revision: String,
    val generation: Int,
    val timelineType: String?,
  )

  private data class SourceConfiguration(
    val uri: Uri,
    val kind: String,
    val isHls: Boolean,
    val isLive: Boolean,
    val timelineTypeHint: String?,
    val authorization: String,
  )

  private data class TrackTarget(
    val id: String,
    val group: TrackGroup,
    val trackIndex: Int,
    val type: Int,
    val generation: Int,
    val supported: Boolean,
  )

  private data class PlaybackSnapshot(
    val sourceKind: String,
    val timelineType: String,
    val isLive: Boolean,
    val isDvr: Boolean,
    val positionSeconds: Double,
    val durationSeconds: Double,
    val bufferedPositionSeconds: Double,
    val seekable: Boolean,
    val seekableStartSeconds: Double,
    val seekableEndSeconds: Double,
    val liveOffsetSeconds: Double,
  )

  companion object {
    private const val MAX_SOURCE_LENGTH = 4096
    private const val MAX_AUTHORIZATION_LENGTH = 4096
    private const val PROGRESS_INTERVAL_MS = 250L
    private val USER_INFO_PATTERN = Regex("^[a-z][a-z0-9+.-]*://[^/?#]*@", RegexOption.IGNORE_CASE)
    private val API_RESOURCE_PATH_PATTERN = Regex("(^|/)api(/|$)", RegexOption.IGNORE_CASE)
    private val BLOCKED_QUERY_KEYS = setOf(
      "media_grant",
      "download_grant",
      "access_token",
      "token",
      "authorization",
      "credential",
      "password",
      "secret",
    )
    private val TIMELINE_TYPES = setOf("vod", "live", "dvr")
  }
}
