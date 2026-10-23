package tv.getportico.portico.native

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Display
import android.hardware.display.DisplayManager
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.TsExtractor
import android.os.Build
import android.view.Surface
import tv.getportico.portico.TelevisionDisplay
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

/**
 * The app's one video player: the Android counterpart of `Native/PorticoPlaybackController.m`,
 * on Media3 (ExoPlayer).
 *
 * JavaScript owns the playback session. It takes a lease, then sends commands (a binding, a
 * source, paused, a rate, a pending seek, the chosen audio and subtitles), each with a rising
 * revision. This validates a command in full before changing anything, and reports what the
 * engine did as numbered facts stamped with the last command it had seen, so nothing from a
 * superseded item, route or seek can be read as current.
 *
 * Main thread only.
 */
internal class PorticoPlaybackController(private val context: Context) {
  var onFact: ((WritableMap) -> Unit)? = null
  var onPictureInPicture: ((WritableMap) -> Unit)? = null
  /** The listening owner reads every fact before JavaScript does. */
  var onListeningFact: ((Map<String, Any?>) -> Unit)? = null
  /** Audio focus while a listening owner plays: `began`, `ended` (a call, another app for a moment) or `lost`. */
  var onInterruption: ((String) -> Unit)? = null

  /** The player view listens for these: the lease or player changed; the subtitle text changed; the picture's size changed. */
  val attachmentListeners = LinkedHashSet<() -> Unit>()
  val subtitleListeners = LinkedHashSet<() -> Unit>()
  val videoSizeListeners = LinkedHashSet<() -> Unit>()

  val instanceId: String = UUID.randomUUID().toString()
  var lease: String? = null
    private set
  var player: ExoPlayer? = null
    private set
  var subtitleCue = PorticoSubtitleSelection.Display("", italic = false, top = false)
    private set
  /** Portico's caption style for the line the app draws ({scale, background}), from the subtitle command in force. */
  var subtitleStyle: Map<*, *>? = null
    private set
  /** The picture's size as the player last reported it (it keeps the last one across a reload of the same film). */
  val videoSize: VideoSize get() = player?.videoSize?.takeIf { it.width > 0 && it.height > 0 } ?: lastVideoSize
  private var lastVideoSize: VideoSize = VideoSize.UNKNOWN

  /** The chosen subtitles are drawn by the app. */
  val subtitleOverlayActive: Boolean get() = subtitles.overlayActive || richSubtitles.active
  val richSubtitles = PorticoSubtitleOverlay(context)
  fun subtitlePositionUs(): Long = (sourcePosition().takeIf { it.isFinite() }?.times(1_000_000)?.toLong() ?: 0L)
  val binding: Map<String, Any?>? get() = currentBinding
  val paused: Boolean get() = desiredPaused
  /** A picture is being decoded (music and audiobooks have none). */
  val hasVideo: Boolean get() = player?.currentTracks?.isTypeSelected(C.TRACK_TYPE_VIDEO) == true
  val listeningActive: Boolean get() = listeningOwner != null

  /** Read-only capture fence. Private source/frame identity never crosses the bridge. */
  fun snapshotIdentity(expected: Map<String, Any?>): List<Any?>? {
    val engine = player ?: return null
    if (invalidated || lease.isNullOrEmpty() || !PorticoSnapshotBinding.matches(expected, currentBinding) ||
        expected["lease"] != lease || source.isNullOrEmpty() || !hasVideo || !hasPlayed || seeking || routeSuspended || routeSeeking ||
        firstFrameItem != itemInstanceId || itemInstanceId.isEmpty() || engine.currentMediaItem?.localConfiguration?.drmConfiguration != null) return null
    if (engine.currentTracks.groups.any { group -> (0 until group.length).any { group.getTrackFormat(it).drmInitData != null } }) return null
    val transfer = engine.videoFormat?.colorInfo?.colorTransfer
    if (transfer == C.COLOR_TRANSFER_ST2084 || transfer == C.COLOR_TRANSFER_HLG) return null
    return listOf(instanceId, lease, currentBinding?.toMap(), itemInstanceId, source, engine, firstFrameItem)
  }

  private val main = Handler(Looper.getMainLooper())
  private val subtitles = PorticoSubtitleSelection()
  private val audioSelection = PorticoAudioSelection()
  private var owner: String? = null
  private var commandRevision = 0L
  private var factSequence = 0L
  private var currentBinding: Map<String, Any?>? = null
  private var command: Map<String, Any?>? = null
  private var source: String? = null
  private var intentId = 0L
  private var itemInstanceId = ""
  private var desiredPaused = true
  private var timelineOriginMs: Double? = null
  private var invalidated = false

  private var seeking = false
  /** A direct MP3 opened from its start before its seek index was read; the first seek once it is here reopens it. */
  private var unindexedMedia: String? = null
  private var seekRevision = -1L
  private var acceptedSeekRevision = -1L
  private var acceptedSeekTarget = 0.0
  private var seekRetired = false
  private var seekWait: SeekWait? = null

  private var routeSuspended = false
  private var routeResume = false
  private var routeSeeking = false
  private var routeFailed = false
  private var routeEpoch = 0
  private var routePosition = 0.0

  private var hasPlayed = false
  private var previousProgress = Double.NaN
  private var readyAnnounced = false
  /** What the player last measured of the connection (bits a second), and when. */
  private var measuredBitrate = 0L
  private var measuredAt = 0L
  /** The player in use came out of a music crossfade: it was built for music, not for a film. */
  private var playerIsDeck = false
  /** Television: the title is held until the display has matched it (its rate, its HDR mode). */
  private var displayHold = false
  private var displayWait = 0
  private var displayMatchedItem = ""
  private var firstFrameItem = ""
  private var frameRateVoted = false
  private var frameRateClear: Runnable? = null
  /** The surface the picture is drawn on, lent by the view that shows it (for the display's frame rate). */
  var displaySurface: (() -> Surface?)? = null
  /** The app is off the screen with a video that is not in a Picture in Picture window: it waits. */
  private var backgroundHold = false
  private val visibility: (Boolean) -> Unit = { visible -> if (visible) enteredForeground() else enteredBackground() }
  private var lastProgress = ""
  private var ticking = false

  // The listening owner's hold on this player (music and audiobooks under Playback v1).
  private var listeningOwner: String? = null
  private var listeningAttachment: Map<String, Any?>? = null
  private var listeningState: Map<String, Any?>? = null
  private var listeningOrigin = ""
  private var listeningAllowed = false
  private var listeningSeek: Map<String, Any?>? = null
  private var listeningRender: Map<String, Any?>? = null
  private var listeningRouteRevision = 0L
  private var listeningRouteReady = true
  private var applyingListening = false

  // The version 2 audio plan being played, and the next one queued behind it (§18.2, §18.3).
  private var enginePlan: String? = null
  private var nextToken: String? = null
  private var nextPlan: Map<String, Any?>? = null
  private var nextQueuedAt = 0L
  private var preparedSent = false
  private var commitSent = false
  private var committedToken: String? = null
  private var crossfade = false
  private var heldAtEnd = false
  private var incoming: ExoPlayer? = null
  private var fadeStartedAt = 0L
  private var fadeSeconds = 0.0

  private class SeekWait(val revision: Long, val target: Double, val binding: Map<String, Any?>?, val intent: Long, val item: String)

  init {
    PorticoAppVisibility.listeners.add(visibility)
    subtitles.onText = { cue -> subtitleCue = cue; subtitleListeners.toList().forEach { it() } }
    subtitles.onStatus = { error -> emit("subtitleStatus", error) }
    richSubtitles.onStatus = { error -> emit("subtitleStatus", error) }
    // A downloaded title's plain subtitles are a WebVTT file beside it, inside Downloads.
    subtitles.allowsLocalFile = { url -> allowedLocalSource(url) }
    audioSelection.onFact = { fact ->
      if (source?.isNotEmpty() == true && (fact["audioBinding"] as? Map<*, *>)?.get("intentId")?.let { number(it) } == intentId.toDouble()) {
        val out = HashMap(fact)
        out["intentId"] = intentId.toDouble()
        out["instanceId"] = instanceId
        val position = sourcePosition()
        out["position"] = if (position.isFinite()) position else 0.0
        out["paused"] = isPaused()
        out.putAll(rateFacts())
        publish(out)
      }
    }
  }

  // --- lease -----------------------------------------------------------------------------

  fun acquire(owner: String?): Map<String, Any?>? {
    if (invalidated || owner.isNullOrEmpty() || owner.length > 128) return null
    if (lease != null && this.owner != owner) return null
    if (lease == null) {
      this.owner = owner
      lease = UUID.randomUUID().toString()
      commandRevision = 0
      factSequence = 0
      backgroundHold = !PorticoAppVisibility.visible
    }
    return mapOf("lease" to lease, "instanceId" to instanceId, "engine" to "native")
  }

  fun release(lease: String?) {
    if (lease == null || this.lease != lease) return
    subtitles.invalidate(); richSubtitles.invalidate()
    audioSelection.invalidate()
    unload()
    source = null
    currentBinding = null
    command = null
    timelineOriginMs = null
    this.lease = null
    owner = null
    seeking = false
    seekWait = null
    routeSuspended = false
    routeResume = false
    routeSeeking = false
    routeFailed = false
    routeEpoch++
    stopTicking()
    val retiring = player
    player = null
    playerIsDeck = false
    if (retiring != null) audioGains.remove(retiring)
    // Views detach while the player is still valid. Media3 release waits for its playback
    // thread to close the renderer and audio sink before the module resolves this release.
    attachmentListeners.toList().forEach { it() }
    retiring?.let { it.removeListener(listener); it.release() }
  }

  fun invalidate() {
    invalidated = true
    onFact = null
    PorticoAppVisibility.listeners.remove(visibility)
    release(lease)
    player?.release()
    player = null
    richSubtitles.close()
  }

  // --- commands --------------------------------------------------------------------------

  /** Null when the command is accepted; otherwise why it was refused. All validation precedes mutation. */
  fun accept(command: Map<String, Any?>?): String? {
    if (invalidated) return "Playback controller is closed."
    val binding = command?.get("binding") as? Map<*, *> ?: return "Invalid playback binding."
    @Suppress("UNCHECKED_CAST") val bound = binding as Map<String, Any?>
    if (listeningOwner != null && !applyingListening) {
      // A delayed JavaScript command may attach the visual surface; it cannot undo a native pause,
      // a timer, an interruption or the end of the owner's authority.
      val media = listeningState?.get("media") as? Map<*, *> ?: return null
      if (command["listeningOwner"] != listeningOwner || bound["sessionId"] != listeningState?.get("playbackId") || number(bound["generation"]) != number(media["generation"])) return null
      if (lease == null || bound["lease"] != lease) return "Playback lease is no longer active."
      applyListeningCommand(command)
      return null
    }
    if (lease == null || bound["lease"] != lease) return "Playback lease is no longer active."
    if (command["paused"] !is Boolean) return "Invalid paused flag."
    val next = command["source"] as? String
    val rate = number(command["rate"])
    if (next == null || rate == null) return "Invalid playback command."
    for (field in listOf("intentId", "generation")) if (!positiveInteger(bound[field])) return "Invalid playback binding."
    if (!positiveInteger(command["commandRevision"])) return "Invalid playback revision."
    val revision = number(command["commandRevision"])!!.toLong()
    if (revision < commandRevision) return "Stale playback command."
    if (revision == commandRevision) return if (this.command == command) null else "Conflicting playback command."
    if (bound["sessionId"] !is String || bound["itemId"] !is String) return "Invalid playback binding."
    val clock = command["timelineOriginMs"]
    val linear = clock != null
    if (linear && (clock is Boolean || !positiveInteger(clock))) return "Invalid channel clock."
    val connection = command["connectionState"]
    val route = command["routeRevision"]
    if (connection != null && (connection !in CONNECTION_STATES || route is Boolean || !wholeNumber(route))) return "Invalid route transition."
    val previousRoute = number(this.command?.get("routeRevision"))
    val nextRoute = number(route)
    if (previousRoute != null && (nextRoute == null || nextRoute < previousRoute)) return "Stale route transition."
    val current = currentBinding
    if (current != null) {
      val intent = number(bound["intentId"])!!
      val old = number(current["intentId"])!!
      val sameBinding = current == bound
      val sameSource = source == next
      val oldUrl = source?.let { parse(it) }
      val nextUrl = parse(next)
      val sameResource = oldUrl != null && nextUrl != null && oldUrl.path == nextUrl.path && (oldUrl.encodedQuery ?: "") == (nextUrl.encodedQuery ?: "") &&
          nextUrl.userInfo == null && nextUrl.encodedFragment == null
      val routeChange = sameBinding && sameResource && nextRoute != null && nextRoute > (previousRoute ?: 0.0)
      val same = sameBinding && (sameSource || routeChange)
      // A channel's next window, or the session planned again in place, is a newer generation
      // of the same playback.
      val replanned = PorticoMpvSupport.replannedInPlace(current, bound)
      if (intent < old || (intent == old && !same && !replanned)) return "Stale playback binding."
      if (same && ((timelineOriginMs != null) != linear || (linear && timelineOriginMs != number(clock)))) return "Channel clock changed within a binding."
    }
    val pending = command["pendingSeek"]
    if (pending != null) {
      val seek = pending as? Map<*, *> ?: return "Invalid seek command."
      for (field in listOf("revision", "positionSeconds")) {
        val value = number(seek[field])
        if (value == null || Math.abs(value) > MAX_INTEGER || (value < 0 && (!linear || field == "revision"))) return "Invalid seek command."
      }
      if (!positiveInteger(seek["revision"])) return "Invalid seek revision."
    }
    val sameBinding = current == bound
    val seek = pending as? Map<*, *>
    val incoming = seek?.let { number(it["revision"])!!.toLong() } ?: -1
    val target = seek?.let { number(it["positionSeconds"])!! } ?: 0.0
    if (sameBinding && seek != null) {
      if (incoming < acceptedSeekRevision) return "Stale seek command."
      if (incoming == acceptedSeekRevision && (seekRetired || target != acceptedSeekTarget)) return "Conflicting or retired seek command."
    }
    // A version 2 audio plan comes only from the listening owner, and is checked in full.
    val render = command["audioRender"]
    if (render != null) {
      if (!applyingListening || render !is Map<*, *>) return "Unsupported audio render context."
      PorticoAudioPlan.validate(render, next)?.let { return it }
    }

    if (!sameBinding) { acceptedSeekRevision = -1; seekRetired = false }
    if (seek != null) { acceptedSeekRevision = incoming; acceptedSeekTarget = target; seekRetired = false }
    else if (acceptedSeekRevision >= 0) seekRetired = true
    timelineOriginMs = if (linear) number(clock) else null
    commandRevision = revision
    currentBinding = bound
    apply(command)
    attachmentListeners.toList().forEach { it() }
    return null
  }

  private fun apply(next: Map<String, Any?>) {
    val sameBinding = command?.get("binding") == next["binding"]
    val verifying = next["connectionState"] == "verifying"
    val nextId = number((next["binding"] as Map<*, *>)["intentId"])!!.toLong()
    val nextSource = next["source"] as String
    if (!sameBinding) { routeResume = false; routeSeeking = false; routeSuspended = false; routeFailed = false; routeEpoch++ }
    val changed = source != nextSource
    // A transport rebind is not a new playback intent or a seek: keep the position it had.
    if (sameBinding && (verifying || changed) && !routeResume && !routeSuspended) {
      val position = if (routeFailed) routePosition else sourcePosition()
      if (position.isFinite() && (timelineOriginMs != null || position >= 0)) { routePosition = position; routeResume = true; routeFailed = false; routeEpoch++ }
    }
    command = next
    desiredPaused = next["paused"] as Boolean
    if (verifying) {
      if (!routeSuspended) { subtitles.invalidate(); richSubtitles.invalidate(); audioSelection.invalidate(); unload(); routeSeeking = false; seeking = false; seekWait = null }
      routeSuspended = true
      return
    }
    @Suppress("UNCHECKED_CAST") val render = next["audioRender"] as? Map<String, Any?>
    @Suppress("UNCHECKED_CAST") val plan = render?.get("plan") as? Map<String, Any?>
    // After a gapless or crossfaded edge the engine already plays the next plan: the new binding is
    // adopted without touching the sound.
    val adopted = plan != null && plan["id"] == enginePlan && !routeSuspended && player?.currentMediaItem != null
    val reload = if (plan != null) !adopted else (routeSuspended || nextId != intentId || changed || player?.currentMediaItem == null || enginePlan != null)
    routeSuspended = false
    if (adopted && (nextId != intentId || changed)) {
      intentId = nextId
      source = nextSource
      itemInstanceId = UUID.randomUUID().toString()
      seekRevision = -1
      readyAnnounced = false
      if (player?.playbackState == Player.STATE_READY) { readyAnnounced = true; emit("ready", null) }
    }
    if (reload) {
      routeEpoch++
      subtitles.invalidate(); richSubtitles.invalidate()
      audioSelection.invalidate()
      unload()
      seeking = false
      seekWait = null
      routeSeeking = false
      intentId = nextId
      source = nextSource
      seekRevision = -1
      val address = (plan?.get("url") as? String) ?: nextSource
      if (address.isNotEmpty()) {
        val url = parse(address)
        if (url == null || !PorticoMpvSupport.allowedSource(context, url)) { emit("error", "media_address_invalid"); return }
        val pendingStart = (next["pendingSeek"] as? Map<*, *>)?.get("positionSeconds")?.let { number(it) }
        // A direct MP3 or ADTS file with a seek index from the server lands exactly (rendered or not).
        @Suppress("UNCHECKED_CAST") val indexed = PorticoSeekIndex.spec(plan ?: next["seekPlan"] as? Map<String, Any?>, url.toString())
        load(url, if (plan != null && !routeResume) pendingStart else null, indexed)
        enginePlan = plan?.get("id") as? String
        if (routeResume) {
          val epoch = routeEpoch
          val item = itemInstanceId
          main.postDelayed({
            if (!invalidated && routeEpoch == epoch && itemInstanceId == item && routeResume) {
              routeResume = false; routeSeeking = false; routeFailed = true; routeEpoch++
              player?.playWhenReady = false
              emit("error", "seek_unavailable")
            }
          }, 10_000)
        }
      }
    }
    val pending = next["pendingSeek"] as? Map<*, *>
    if (pending != null && (routeResume || routeSeeking || routeFailed)) { routeResume = false; routeSeeking = false; routeFailed = false; routeEpoch++ }
    if (pending == null && seeking) { seeking = false; seekWait = null }
    audioSelection.apply(scoped(next["audio"]), player, itemInstanceId)
    val chosenSubtitles = scoped(next["subtitles"])
    val style = chosenSubtitles?.get("style") as? Map<*, *>
    if (style != subtitleStyle) { subtitleStyle = style; subtitleListeners.toList().forEach { it() } }
    richSubtitles.apply(chosenSubtitles, source)
    subtitles.apply(if (richSubtitles.active) null else chosenSubtitles, source)
    applyRenderEdges(render)
    applyRouteResume()
    applyPendingSeek()
    applyIntent()
    startTicking()
  }

  /** The audio or subtitle part of a command, only when it names this binding. */
  private fun scoped(value: Any?): Map<String, Any?>? {
    @Suppress("UNCHECKED_CAST") val part = value as? Map<String, Any?> ?: return null
    val named = part["binding"] as? Map<*, *> ?: return null
    val bound = currentBinding ?: return null
    for (field in listOf("intentId", "sessionId", "generation")) if (named[field] != bound[field]) return null
    return part
  }

  // --- the engine ------------------------------------------------------------------------

  /** Listening players put a gain stage on decoded sound, so normalization can raise a quiet track as well as lower a loud one. */
  private val audioGains = java.util.WeakHashMap<ExoPlayer, PorticoAudioGain>()
  fun applyEqualizer(value: PorticoPcmDsp.Eq) {
    audioGains.values.forEach { it.equalizer = value }
  }
  private fun musicGain(engine: ExoPlayer, gain: Float, normalization: Float = 1f) {
    val processor = audioGains[engine]
    if (processor != null) { processor.setGain(gain, normalization); engine.volume = 1f }
    else engine.volume = gain.coerceIn(0f, 1f)
  }

  /**
   * One way to build a player, for the player itself and for the second one a music crossfade
   * starts under it (which then becomes the player): the same data source, the same memory limit
   * on a small device, the same cap at the screen's size, and no subtitles of the player's own.
   * Every decoded player consumes the app/device EQ. A receiver's encoded bitstream stays
   * untouched and reports EQ not applied; changing the EQ never replaces the player.
   */
  private fun build(music: Boolean, ownsFocus: Boolean, listening: Boolean = music): ExoPlayer {
    val http = OkHttpDataSource.Factory(mediaClient)
    val load = DefaultLoadControl.Builder()
    // A high-bitrate stream must not take memory the interface needs on a small device.
    if (lowMemory(context)) load.setBufferDurationsMs(15_000, 30_000, 2_500, 5_000)
    // A transport stream is searched further for the time asked for, so a seek in one lands.
    // MP3 and ADTS files whose seek index has been read are placed by it (PorticoSeekIndex).
    val extractors = PorticoSeekIndex.Factory(DefaultExtractorsFactory().setTsExtractorTimestampSearchBytes(1500 * TsExtractor.TS_PACKET_SIZE))
    val gain = PorticoAudioGain().apply {
      val plan = planOf(command?.get("audioRender"))
      setGain(if (listening) PorticoAudioPlan.gain(plan, settings()) else 1f,
          if (listening) PorticoAudioPlan.normalizationGain(plan, settings()) else 1f)
      PorticoEqualizerStore(context).use { equalizer = it.read() }
    }
    val untouched = !listening || (settings()?.get("normalization") == "off" && (number(settings()?.get("crossfadeSeconds")) ?: 0.0) == 0.0)
    val renderers = PorticoAudioRenderers(context, gain, untouched)
    val made = ExoPlayer.Builder(context, renderers.setEnableDecoderFallback(true))
        .setMediaSourceFactory(PorticoPlanMediaSource.Factory(DefaultDataSource.Factory(context, http), extractors))
        .setLoadControl(load.build())
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(if (music) C.AUDIO_CONTENT_TYPE_MUSIC else C.AUDIO_CONTENT_TYPE_MOVIE).build(), ownsFocus)
        .setHandleAudioBecomingNoisy(false)
        // Music goes on with the screen off: the processor and the network stay awake while it plays.
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .build()
    // Device fit, not quality (the viewer's quality choice stays with the server's plan): never
    // an adaptive variant larger than the screen. The app draws subtitles itself.
    val screen = screenSize(context)
    made.trackSelectionParameters = made.trackSelectionParameters.buildUpon()
        .setMaxVideoSize(screen.first, screen.second)
        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        .build()
    // On a television the app asks the display to match the title itself, and waits for it
    // (matchDisplay): the player's own request is only ever for a switch nobody sees.
    if (TelevisionDisplay.isTelevision) made.videoChangeFrameRateStrategy = C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF
    made.addAnalyticsListener(bandwidth)
    audioGains[made] = gain
    return made
  }

  private fun engine(): ExoPlayer {
    player?.let { return it }
    val made = build(music = false, ownsFocus = true, listening = listeningOwner != null)
    made.addListener(listener)
    player = made
    playerIsDeck = false
    return made
  }

  /** What the player measures of the connection as it downloads, for Automatic quality. */
  private val bandwidth = object : AnalyticsListener {
    override fun onBandwidthEstimate(eventTime: AnalyticsListener.EventTime, totalLoadTimeMs: Int, totalBytesLoaded: Long, bitrateEstimate: Long) {
      if (bitrateEstimate > 0 && totalBytesLoaded > 0) { measuredBitrate = bitrateEstimate; measuredAt = SystemClock.elapsedRealtime() }
    }
  }

  private fun load(url: Uri, startSeconds: Double? = null, index: PorticoSeekIndex.Spec? = null) {
    // A player that came out of a music crossfade was built for music (its sound is announced to
    // the system as music). A title with a picture gets the app's own player again.
    if (playerIsDeck && listeningOwner == null) {
      player?.let { it.removeListener(listener); it.release() }
      player = null
      playerIsDeck = false
      attachmentListeners.toList().forEach { it() }
    }
    val engine = engine()
    itemInstanceId = UUID.randomUUID().toString()
    hasPlayed = false
    previousProgress = Double.NaN
    readyAnnounced = false
    measuredBitrate = 0
    measuredAt = 0
    displayHold = false
    displayWait++
    val start = if (routeResume && timelineOriginMs == null) (routePosition * 1000).toLong()
        else if (startSeconds != null && startSeconds > 0 && timelineOriginMs == null) (startSeconds * 1000).toLong() else C.TIME_UNSET
    engine.playWhenReady = false
    // The index is read before the file is opened when it will be used: a part-way start, a
    // resume, or any ADTS file (which Media3 cannot place at all without it).
    val address = url.toString()
    val resuming = (number(listeningSeek?.get("positionSeconds")) ?: 0.0) > 0
    val wanted = index != null && PorticoSeekIndex.cached(address) == null && (start != C.TIME_UNSET || routeResume || resuming || index.container == "adts")
    unindexedMedia = null
    if (!wanted) {
      engine.setMediaItem(PorticoPlanMediaSource.item(url.toString(),planOf(command?.get("audioRender"))), start)
      engine.prepare()
      // Started from the beginning, an MP3 plays at once; its index is read meanwhile, so a later
      // scrub lands exactly too (applyPendingSeek).
      if (index != null && PorticoSeekIndex.cached(address) == null) {
        unindexedMedia = address
        PorticoSeekIndex.load(mediaClient, address, index) {}
      }
      return
    }
    // Nothing is loaded meanwhile, so a seek waits for the file instead of moving the previous one.
    engine.stop()
    engine.clearMediaItems()
    val item = itemInstanceId
    PorticoSeekIndex.load(mediaClient, address, index!!) {
      if (invalidated || player !== engine || itemInstanceId != item || source == null) return@load
      engine.setMediaItem(PorticoPlanMediaSource.item(url.toString(),planOf(command?.get("audioRender"))), start)
      engine.prepare()
      applyRouteResume()
      applyPendingSeek()
      applyIntent()
    }
  }

  private fun unload() {
    unindexedMedia = null
    hasPlayed = false
    previousProgress = Double.NaN
    closeIncoming()
    enginePlan = null
    nextToken = null
    nextPlan = null
    committedToken = null
    preparedSent = false
    commitSent = false
    heldAtEnd = false
    val engine = player ?: return
    engine.playWhenReady = false
    engine.pauseAtEndOfMediaItems = false
    musicGain(engine, 1f)
    engine.stop()
    engine.clearMediaItems()
    readyAnnounced = false
    displayHold = false
    displayWait++
    scheduleFrameRateClear()
  }

  private val listener = object : Player.Listener {
    override fun onPlaybackStateChanged(state: Int) {
      when (state) {
        Player.STATE_READY -> {
          // A television is asked to match the title first; the rest happens when it has.
          if (matchDisplay { becameReady() }) return
          becameReady()
        }
        // The buffer ran dry while the item is still healthy.
        Player.STATE_BUFFERING -> if (readyAnnounced && !seeking && player?.playWhenReady == true) emit("stalled", null)
        Player.STATE_ENDED -> emit("ended", null)
        else -> {}
      }
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      // The queued plan became the one heard, with no gap: the boundary of a committed edge.
      val token = nextToken ?: return
      if (mediaItem?.mediaId != token || reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) return
      val engine = player ?: return
      if (engine.currentMediaItemIndex > 0) engine.removeMediaItems(0, engine.currentMediaItemIndex)
      finishEdge(token)
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      if (playWhenReady) return
      if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
        // The track ran out while the next one waits for the server's commit.
        heldAtEnd = true
        if (!commitSent || nextToken == null) dropNext()
      } else if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS && listeningOwner != null) onInterruption?.invoke("lost")
    }

    override fun onPlaybackSuppressionReasonChanged(reason: Int) {
      if (listeningOwner == null) return
      onInterruption?.invoke(if (reason == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS) "began" else "ended")
    }

    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
      // A seek inside what is already buffered never leaves READY, so no state change announces it.
      if (reason == Player.DISCONTINUITY_REASON_SEEK) main.post { if (player?.playbackState == Player.STATE_READY) finishSeek() }
    }

    override fun onPlayerError(error: PlaybackException) = publishFailure(error)

    override fun onRenderedFirstFrame() { hasPlayed = true; firstFrameItem = itemInstanceId; if (lease != null) emit("firstFrame", null) }

    override fun onTracksChanged(tracks: Tracks) = audioSelection.tracksChanged(tracks)

    override fun onVideoSizeChanged(size: VideoSize) {
      if (size.width > 0 && size.height > 0) lastVideoSize = size
      videoSizeListeners.toList().forEach { it() }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) { lastProgress = "" }
  }

  private fun becameReady() {
    if (player?.playbackState != Player.STATE_READY) return
    applyRouteResume()
    if (!readyAnnounced && !routeResume && !routeFailed) { readyAnnounced = true; emit("ready", null) }
    finishSeek()
    applyPendingSeek()
    applyIntent()
  }

  // --- matching the display (television) ---------------------------------------------------

  private fun voteFrameRate(target: Surface, fps: Float): Boolean {
    if (Build.VERSION.SDK_INT < 30) {
      val display=(context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.getDisplay(Display.DEFAULT_DISPLAY)
      return PorticoDisplayRate.vote(display,fps).also { if(it) frameRateVoted=true }
    }
    return try {
      if (Build.VERSION.SDK_INT >= 31) target.setFrameRate(fps, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE, Surface.CHANGE_FRAME_RATE_ALWAYS)
      else target.setFrameRate(fps, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE)
      frameRateVoted = true
      true
    } catch (_: Exception) { false }
  }

  /** The display goes back to its own rate a moment after playback is left, not between two episodes. */
  private fun scheduleFrameRateClear() {
    frameRateClear?.let { main.removeCallbacks(it) }
    if (!frameRateVoted) return
    val work = Runnable {
      frameRateClear = null
      val target = try { displaySurface?.invoke() } catch (_: Exception) { null }
      if (lease != null && player?.currentMediaItem != null) return@Runnable
      frameRateVoted = false
      if (Build.VERSION.SDK_INT < 30) { PorticoDisplayRate.clear(); return@Runnable }
      if (target == null || !target.isValid) return@Runnable
      try { target.setFrameRate(0f, Surface.FRAME_RATE_COMPATIBILITY_DEFAULT) } catch (_: Exception) {}
    }
    frameRateClear = work
    main.postDelayed(work, 2000)
  }

  /**
   * On a television, before a title is announced ready: the display is asked to match the
   * title's frame rate (the system's own request, so its "match content frame rate" setting
   * decides, Android 11 and later), and the title is held while the television may be changing
   * mode, so its opening seconds are not played into a screen that is renegotiating. An HDR title
   * on a television that shows HDR is held a moment after its first picture as well: that is when
   * the television changes to HDR. Bounded (10 s), once for each load, never for music, and never
   * on a phone or tablet, which change rate without a break. `done` runs when the wait is over;
   * false means there is nothing to wait for.
   */
  private fun matchDisplay(deadline: Long = SystemClock.elapsedRealtime() + 10_000, done: () -> Unit): Boolean {
    val engine = player ?: return false
    if (displayHold) return true
    val item = itemInstanceId
    if (!TelevisionDisplay.isTelevision || listeningOwner != null || displayMatchedItem == item) return false
    val format = engine.videoFormat ?: return false
    val displays = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager ?: return false
    val display = displays.getDisplay(Display.DEFAULT_DISPLAY) ?: return false
    val transfer = format.colorInfo?.colorTransfer
    val hdrTitle = transfer == C.COLOR_TRANSFER_ST2084 || transfer == C.COLOR_TRANSFER_HLG
    val hdrScreen = try { @Suppress("DEPRECATION") (display.hdrCapabilities?.supportedHdrTypes?.isNotEmpty() == true) } catch (_: Exception) { false }
    val hdrSwitch = hdrTitle && hdrScreen
    // The viewer's setting, where the system has one (Android 12): never, only when the picture
    // does not break, or always.
    val preference = if (Build.VERSION.SDK_INT >= 31) displays.matchContentFrameRateUserPreference else null
    val never = preference == DisplayManager.MATCH_CONTENT_FRAMERATE_NEVER
    val fps = format.frameRate.takeIf { it.isFinite() && it >= 1f && it <= 240f }
    val target = try { displaySurface?.invoke() } catch (_: Exception) { null }
    if (Build.VERSION.SDK_INT >= 30 && !never && fps != null && (target == null || !target.isValid) && !backgroundHold) {
      // READY can arrive before React has mounted the surface. Keep the opening frame until
      // there is somewhere to make the rate request, within the same bounded startup wait.
      val wait = ++displayWait
      val until = deadline
      displayHold = true
      engine.playWhenReady = false
      val poll = object : Runnable {
        override fun run() {
          if (invalidated || displayWait != wait || itemInstanceId != item || !displayHold) return
          val surface = try { displaySurface?.invoke() } catch (_: Exception) { null }
          if (surface?.isValid == true) {
            displayHold = false
            if (!matchDisplay(until, done)) done()
          } else if (SystemClock.elapsedRealtime() >= until || backgroundHold) {
            displayHold = false
            displayMatchedItem = item
            done()
          } else main.postDelayed(this, 50)
        }
      }
      main.postDelayed(poll, 50)
      return true
    }
    displayMatchedItem = item
    val before = display.mode
    val voted = !never && fps != null && target != null && target.isValid && voteFrameRate(target, fps)
    val mayBreak = voted && preference != DisplayManager.MATCH_CONTENT_FRAMERATE_SEAMLESSS_ONLY
    if (!mayBreak && !hdrSwitch) return false
    val wait = ++displayWait
    displayHold = true
    // Nothing plays while the television may be switching.
    engine.playWhenReady = false
    var settled = false
    var listener: DisplayManager.DisplayListener? = null
    val settle = {
      if (!settled) {
        settled = true
        listener?.let { displays.unregisterDisplayListener(it) }
        if (displayWait == wait && displayHold && itemInstanceId == item) {
          displayHold = false
          done()
        }
      }
    }
    var switching = false
    listener = object : DisplayManager.DisplayListener {
      override fun onDisplayAdded(displayId: Int) {}
      override fun onDisplayRemoved(displayId: Int) {}
      override fun onDisplayChanged(displayId: Int) {
        if (displayId != Display.DEFAULT_DISPLAY || switching) return
        val now = display.mode
        if (now.modeId == before.modeId && Math.abs(now.refreshRate - before.refreshRate) < 0.01f) return
        switching = true
        // A switch the television makes without renegotiating its connection shows no break;
        // any other needs a moment before its picture is steady.
        val seamless = Build.VERSION.SDK_INT >= 31 && before.alternativeRefreshRates.any { Math.abs(it - now.refreshRate) < 0.01f }
        main.postDelayed({ settle() }, if (seamless) 100 else 2000)
      }
    }
    displays.registerDisplayListener(listener, main)
    // No switch begins when the television is already in the right mode. An HDR title is given
    // its first picture first, and then the time a television takes to change to HDR.
    val quiet = object : Runnable {
      var waited = 0
      override fun run() {
        if (settled || switching) return
        waited += 250
        val shown = firstFrameItem == item
        if (hdrSwitch && !shown && waited < 3000) { main.postDelayed(this, 250); return }
        if (hdrSwitch && shown) { main.postDelayed({ if (!switching) settle() }, 1500); return }
        if (waited >= 1000) settle() else main.postDelayed(this, 250)
      }
    }
    main.postDelayed(quiet, 250)
    main.postDelayed({ settle() }, (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
    return true
  }

  /** Restore the retained position on this exact lease, session and presentation, then resume the desired state. */
  private fun applyRouteResume() {
    val engine = player ?: return
    if (!routeResume || routeSuspended || routeSeeking || routeFailed || engine.playbackState != Player.STATE_READY) return
    val target = routePosition
    if (timelineOriginMs != null) {
      val position = linearTarget(target) ?: return
      routeSeeking = true
      engine.playWhenReady = false
      engine.seekTo(position)
      val epoch = routeEpoch
      main.postDelayed({ if (routeEpoch == epoch && routeSeeking) settleRoute(target) }, 1500)
      return
    }
    settleRoute(target)
  }

  private fun settleRoute(target: Double) {
    routeSeeking = false
    val actual = sourcePosition()
    if (!actual.isFinite() || Math.abs(actual - target) > 0.5) {
      routeResume = false; routeFailed = true; routeEpoch++
      player?.playWhenReady = false
      emit("error", "seek_unavailable")
      return
    }
    routeResume = false
    readyAnnounced = true
    emit("ready", null)
    applyIntent()
  }

  private fun applyPendingSeek() {
    val engine = player ?: return
    val pending = command?.get("pendingSeek") as? Map<*, *> ?: return
    if (routeSuspended || routeResume || routeSeeking || engine.playbackState == Player.STATE_IDLE || engine.currentMediaItem == null) return
    val revision = number(pending["revision"])!!.toLong()
    if (revision <= seekRevision) return
    val target = number(pending["positionSeconds"]) ?: return
    val position = if (timelineOriginMs != null) linearTarget(target) ?: return else { if (target < 0) return; (target * 1000).toLong() }
    seekRevision = revision
    seeking = true
    engine.playWhenReady = false
    seekWait = SeekWait(revision, target, currentBinding, intentId, itemInstanceId)
    // An MP3 opened before its seek index arrived is opened again at the position once it has:
    // Media3 alone only guesses an MP3's places, the index lands exactly. A queued next item
    // (gapless music) keeps the ordinary seek.
    val reopen = unindexedMedia
    if (reopen != null && timelineOriginMs == null && engine.mediaItemCount == 1 && PorticoSeekIndex.cached(reopen) != null) {
      unindexedMedia = null
      engine.setMediaItem(MediaItem.fromUri(reopen), position)
      engine.prepare()
      return
    }
    engine.seekTo(position)
  }

  private fun finishSeek() {
    val wait = seekWait ?: return
    val current = command?.get("pendingSeek") as? Map<*, *>
    seekWait = null
    if (currentBinding != wait.binding || intentId != wait.intent || itemInstanceId != wait.item || seekRevision != wait.revision ||
        current == null || number(current["revision"])?.toLong() != wait.revision) return
    seeking = false
    val observed = sourcePosition()
    val applied = observed.isFinite() && Math.abs(observed - wait.target) <= 0.5
    // A file the player cannot seek in at all (a Matroska file with no index, some transport
    // streams) lands at its start whatever is asked. That is the player being unable to play this
    // file as it was given, not a position that will be there in a moment: the server is told,
    // and delivers the title another way (repackaged, with a timeline that seeks) at the place
    // asked for. A download has no other way and keeps the plain answer.
    val engine = player
    if (!applied && engine != null && timelineOriginMs == null && listeningOwner == null && !engine.isCurrentMediaItemSeekable &&
        engine.playbackState == Player.STATE_READY && source?.startsWith("file:") != true) {
      val fact = HashMap<String, Any?>()
      fact["instanceId"] = instanceId
      fact["type"] = "error"
      fact["intentId"] = wait.intent.toDouble()
      fact["position"] = wait.target
      fact["paused"] = true
      fact["networkError"] = false
      fact["deliveryError"] = false
      fact["httpStatus"] = 0.0
      fact["hasPlayed"] = hasPlayed
      fact["uncertain"] = false
      fact["engineCode"] = "source_not_supported"
      fact["errorDetail"] = "The file has no index to seek by."
      fact["error"] = "playback_failed"
      fact.putAll(rateFacts())
      engine.playWhenReady = false
      publish(fact)
      return
    }
    val fact = HashMap<String, Any?>()
    fact["instanceId"] = instanceId
    fact["type"] = if (applied) "seekApplied" else "seekFailed"
    fact["intentId"] = wait.intent.toDouble()
    fact["seekRevision"] = wait.revision.toDouble()
    fact["position"] = if (observed.isFinite()) observed else 0.0
    fact["paused"] = isPaused()
    fact["error"] = if (applied) "" else "seek_unavailable"
    fact.putAll(rateFacts())
    publish(fact)
  }

  private fun applyIntent() {
    val engine = player ?: return
    val pending = command?.get("pendingSeek") is Map<*, *>
    if (desiredPaused || seeking || pending || displayHold || (!readyAnnounced && listeningOwner == null) || routeSuspended || routeResume || routeSeeking || routeFailed || (backgroundHold && listeningOwner == null) || (listeningOwner != null && !listeningAllowed)) {
      engine.playWhenReady = false
      incoming?.playWhenReady = false
    } else if (heldAtEnd) {
      // Waiting at the end of a track for the commit: nothing to play yet.
    } else if (engine.playbackState == Player.STATE_READY || engine.playbackState == Player.STATE_BUFFERING) {
      val rate = desiredRate()
      if (supportedRates().contains(rate)) {
        if (engine.playbackParameters.speed != rate.toFloat()) engine.setPlaybackSpeed(rate.toFloat())
        engine.playWhenReady = true
        incoming?.let { it.setPlaybackSpeed(rate.toFloat()); it.playWhenReady = true }
      } else engine.playWhenReady = false
    }
    emit("rateStatus", null)
  }

  // --- leaving the screen ------------------------------------------------------------------

  /**
   * The app left the screen (Home on a television, the screen switched off) and the picture is
   * not in a Picture in Picture window, which would have kept the activity on screen. A video
   * stops: its sound must not carry on behind the launcher. JavaScript is told, so its intent
   * becomes "paused" and one press continues when the viewer comes back. Music and audiobooks
   * (the listening owner's, or a file with no picture) play on.
   */
  private fun enteredBackground() {
    val engine = player
    if (lease == null || listeningOwner != null || engine == null || engine.currentMediaItem == null) return
    val tracks = engine.currentTracks
    if (!tracks.isEmpty && !tracks.isTypeSelected(C.TRACK_TYPE_VIDEO)) return
    backgroundHold = true
    val wasPlaying = !desiredPaused
    engine.playWhenReady = false
    if (wasPlaying) emit("systemPaused", null, mapOf("paused" to true, "reason" to "background"))
  }

  private fun enteredForeground() {
    if (!backgroundHold) return
    backgroundHold = false
    if (lease != null) applyIntent()
  }

  // --- gapless and crossfade (the version 2 audio plan) ------------------------------------

  private fun settings(): Map<*, *>? = (command?.get("audioRender") as? Map<*, *>)?.get("settings") as? Map<*, *>

  private fun planOf(part: Any?): Map<String, Any?>? {
    @Suppress("UNCHECKED_CAST") return (part as? Map<*, *>)?.get("plan") as? Map<String, Any?>
  }

  /**
   * The next track, as the owner has it: prepared (the server reserved it) or committed (the server
   * moved the queue). A prepared track is queued behind the current one and held at the end of the
   * current one; only a commit lets the player cross into it.
   */
  private fun applyRenderEdges(render: Map<String, Any?>?) {
    val engine = player ?: return
    if (render == null || engine.currentMediaItem == null) { if (nextToken != null) dropNext(); return }
    if (incoming == null) musicGain(engine, PorticoAudioPlan.gain(planOf(render), settings()), PorticoAudioPlan.normalizationGain(planOf(render), settings()))
    val committed = render["committed"] as? Map<*, *>
    val wanted = committed ?: render["prepared"] as? Map<*, *>
    val token = wanted?.get("token") as? String
    val plan = planOf(wanted)
    if (token == null || plan == null) { if (nextToken != null && committedToken == null) dropNext(); return }
    if (nextToken != token) {
      dropNext()
      engine.addMediaItem(PorticoPlanMediaSource.item(plan["url"] as String,plan,token))
      engine.pauseAtEndOfMediaItems = true
      nextToken = token
      nextPlan = plan
      nextQueuedAt = SystemClock.elapsedRealtime()
      preparedSent = false
      commitSent = false
    }
    if (committed != null && committedToken != token) {
      committedToken = token
      preparedSent = true
      commitSent = true
      fadeSeconds = number(settings()?.get("crossfadeSeconds")) ?: 0.0
      // Consecutive tracks of one album are joined, never crossfaded.
      crossfade = fadeSeconds > 0 && wanted["sameAlbum"] != true
      if (!crossfade || heldAtEnd) {
        crossfade = false
        engine.pauseAtEndOfMediaItems = false
        // The commit came after the track had run out: cross now.
        if (heldAtEnd) { heldAtEnd = false; main.post { if (player === engine && nextToken == token) { engine.seekToNextMediaItem(); applyIntent() } } }
      }
    }
  }

  /** The reserved track goes: a pause, a seek, a queue change, or a commit that never came. */
  private fun dropNext() {
    val engine = player
    closeIncoming()
    val held = heldAtEnd
    nextToken = null
    nextPlan = null
    committedToken = null
    preparedSent = false
    commitSent = false
    heldAtEnd = false
    crossfade = false
    if (engine != null) {
      if (engine.mediaItemCount > 1) engine.removeMediaItems(1, engine.mediaItemCount)
      engine.pauseAtEndOfMediaItems = false
    }
    // The current track had already run out waiting: it ends now, and the queue moves as usual.
    if (held) emit("ended", null)
  }

  private fun closeIncoming() {
    incoming?.let { it.removeListener(incomingListener); it.release() }
    incoming = null
  }

  /** Twice a second: say when the next track is buffered, when it is time to commit, and start a crossfade. */
  private fun watchEdge() {
    val engine = player ?: return
    val token = nextToken ?: return
    if (engine.playbackState != Player.STATE_READY || seeking || routeResume || routeSuspended) return
    val duration = engine.duration
    if (duration == C.TIME_UNSET || duration <= 0) return
    val rate = Math.max(0.25, engine.playbackParameters.speed.toDouble())
    val remaining = (duration - engine.currentPosition) / 1000.0 / rate
    if (!preparedSent && (engine.bufferedPosition >= duration - 1000 || SystemClock.elapsedRealtime() - nextQueuedAt > 3000)) {
      preparedSent = true
      emit("audioPrepared", null, mapOf("token" to token))
    }
    val fade = number(settings()?.get("crossfadeSeconds")) ?: 0.0
    if (preparedSent && !commitSent && committedToken == null && engine.playWhenReady && remaining <= fade + 2) {
      commitSent = true
      emit("audioCommit", null, mapOf("token" to token))
    }
    if (committedToken == token && crossfade && incoming == null && engine.playWhenReady && remaining * rate <= fadeSeconds) startCrossfade(Math.max(0.2, remaining * rate))
  }

  /** The next track starts on a second player under the end of this one; when the fade is done it is the player. */
  private fun startCrossfade(seconds: Double) {
    val plan = nextPlan ?: return
    // Built like the player itself (the memory limit on a small device, the cap at the screen's
    // size): when the fade is done it is the player.
    val deck = build(music = true, ownsFocus = false)
    musicGain(deck, 0f, PorticoAudioPlan.normalizationGain(plan, settings()))
    deck.addListener(incomingListener)
    deck.setMediaItem(PorticoPlanMediaSource.item(plan["url"] as String,plan))
    deck.setPlaybackSpeed(player?.playbackParameters?.speed ?: 1f)
    deck.prepare()
    deck.playWhenReady = true
    incoming = deck
    fadeSeconds = seconds
    fadeStartedAt = 0L
    main.post(fadeTick)
  }

  private val incomingListener = object : Player.Listener {
    override fun onPlayerError(error: PlaybackException) {
      // The successor could not start under the fade: the owner starts it as an ordinary track.
      val token = nextToken
      closeIncoming()
      if (token != null) emit("audioPreparationFailed", "audio_preparation_failed", mapOf("token" to token))
    }
  }

  private val fadeTick = object : Runnable {
    override fun run() {
      val deck = incoming ?: return
      val old = player ?: return
      if (deck.isPlaying && fadeStartedAt == 0L) fadeStartedAt = SystemClock.elapsedRealtime()
      val rate = Math.max(0.25, old.playbackParameters.speed.toDouble())
      val t = if (fadeStartedAt == 0L) 0.0 else Math.min(1.0, (SystemClock.elapsedRealtime() - fadeStartedAt) / 1000.0 * rate / fadeSeconds)
      val outgoing = PorticoAudioPlan.gain(planOf(command?.get("audioRender")), settings())
      val arriving = PorticoAudioPlan.gain(nextPlan, settings())
      musicGain(old, (outgoing * Math.cos(t * Math.PI / 2)).toFloat(), PorticoAudioPlan.normalizationGain(planOf(command?.get("audioRender")), settings()))
      musicGain(deck, (arriving * Math.sin(t * Math.PI / 2)).toFloat(), PorticoAudioPlan.normalizationGain(nextPlan, settings()))
      val over = t >= 1 || (fadeStartedAt != 0L && (heldAtEnd || old.playbackState == Player.STATE_ENDED))
      if (!over) { main.postDelayed(this, 40); return }
      // The new track is the player from here: position, facts and the next edge are its own.
      val token = nextToken ?: return
      deck.removeListener(incomingListener)
      incoming = null
      old.removeListener(listener)
      old.release()
      musicGain(deck, arriving, PorticoAudioPlan.normalizationGain(nextPlan, settings()))
      deck.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
      deck.addListener(listener)
      player = deck
      playerIsDeck = true
      finishEdge(token)
      attachmentListeners.toList().forEach { it() }
    }
  }

  private fun finishEdge(token: String) {
    enginePlan = nextPlan?.get("id") as? String
    nextToken = null
    nextPlan = null
    committedToken = null
    preparedSent = false
    commitSent = false
    heldAtEnd = false
    crossfade = false
    player?.pauseAtEndOfMediaItems = false
    lastProgress = ""
    emit("audioBoundary", null, mapOf("token" to token))
  }

  // --- the listening owner -------------------------------------------------------------------

  /** What the owner reports and decides from: the engine's clock and readiness under the current binding. */
  fun listeningSnapshot(): MutableMap<String, Any?> {
    val engine = player
    val position = sourcePosition()
    val loaded = engine != null && engine.currentMediaItem != null
    val state = engine?.playbackState ?: Player.STATE_IDLE
    val ready = loaded && (state == Player.STATE_READY || state == Player.STATE_ENDED)
    val rates = rateFacts()
    val output = engine?.let { audioGains[it]?.dsp?.outputStatus } ?: emptyMap<String, Any?>()
    return hashMapOf(
        "binding" to currentBinding,
        "commandRevision" to commandRevision.toDouble(),
        "positionSeconds" to (if (position.isFinite()) Math.max(0.0, position) else 0.0),
        "observed" to (loaded && position.isFinite() && (ready || (state == Player.STATE_BUFFERING && readyAnnounced))),
        "ready" to ready,
        "seeking" to (seeking || command?.get("pendingSeek") is Map<*, *>),
        "effectiveRate" to rates["effectiveRate"],
        "supportedRates" to RATES,
        "rateWaiting" to rates["rateWaiting"],
        "rateError" to rates["rateError"],
        "rendering" to (enginePlan != null),
        "eqApplied" to (loaded && output["eqApplied"] == true),
        "levelingApplied" to (loaded && output["levelingApplied"] == true),
        "output" to output)
  }

  /** The owner's whole intent for the engine: what plays, whether it may, where it starts, and its audio plan. */
  fun listeningOwner(owner: String, state: Map<String, Any?>, origin: String, allowed: Boolean, seek: Map<String, Any?>?, render: Map<String, Any?>?) {
    if (listeningOwner != owner) {
      player?.playWhenReady = false; incoming?.playWhenReady = false
      // A prior video player's sink cannot apply the listening PCM gain.
      player?.takeIf { !audioGains.containsKey(it) }?.let { old ->
        unload(); old.removeListener(listener); old.release(); player = null; source = null
      }
    }
    listeningOwner = owner
    listeningState = state
    listeningOrigin = origin
    listeningAllowed = allowed
    listeningSeek = seek
    listeningRender = render
    if (!allowed) { player?.playWhenReady = false; incoming?.playWhenReady = false }
    applyListeningCommand(null)
  }

  fun clearListeningOwner(owner: String) {
    if (listeningOwner != owner) return
    player?.playWhenReady = false
    listeningAllowed = false
    listeningOwner = null
    listeningAttachment = null
    listeningState = null
    listeningOrigin = ""
    listeningSeek = null
    listeningRender = null
    // Retire the transport too: a command kept from before the pause must not restart the player.
    lease?.let { release(it) }
    // A listening/crossfade sink must not become the next video's sink or buffer policy.
    player?.let { old -> old.removeListener(listener); old.release(); audioGains.remove(old) }
    player = null
    playerIsDeck = false
    attachmentListeners.toList().forEach { it() }
  }

  /** A clean engine under the same lease: a retry, or a committed track started as an ordinary one. */
  fun resetListeningEngine(owner: String) {
    if (listeningOwner != owner) return
    listeningAttachment = currentBinding?.let { mapOf("binding" to it) } ?: listeningAttachment
    subtitles.invalidate(); richSubtitles.invalidate()
    audioSelection.invalidate()
    unload()
    source = null
    currentBinding = null
    command = null
    seeking = false
    seekWait = null
    seekRevision = -1
    acceptedSeekRevision = -1
    seekRetired = false
    routeSuspended = false
    routeResume = false
    routeSeeking = false
    routeFailed = false
    attachmentListeners.toList().forEach { it() }
  }

  fun listeningRoute(owner: String, ready: Boolean, revision: Long) {
    if (listeningOwner != null && (listeningOwner != owner || revision < listeningRouteRevision)) return
    listeningRouteRevision = revision
    listeningRouteReady = ready
    if (!ready) { player?.playWhenReady = false; incoming?.playWhenReady = false }
  }

  /** The owner's state as the command JavaScript would have sent, under the lease JavaScript holds. */
  private fun applyListeningCommand(attachment: Map<String, Any?>?) {
    if (attachment != null) listeningAttachment = attachment
    val attached = listeningAttachment
    @Suppress("UNCHECKED_CAST") val media = listeningState?.get("media") as? Map<String, Any?>
    @Suppress("UNCHECKED_CAST") val attachedBinding = attached?.get("binding") as? Map<String, Any?>
    if (lease == null || (currentBinding == null && attachedBinding == null) || media == null) return
    @Suppress("UNCHECKED_CAST") val desired = listeningState?.get("desired") as Map<String, Any?>
    val bound = HashMap(currentBinding ?: attachedBinding!!)
    bound["lease"] = lease
    if (bound["sessionId"] != media["id"] || number(bound["generation"]) != number(media["generation"])) {
      bound["intentId"] = (number(bound["intentId"]) ?: 0.0) + 1
      bound["sessionId"] = media["id"]
      bound["generation"] = media["generation"]
      bound["itemId"] = (desired["context"] as Map<*, *>)["itemId"]
    }
    val next = HashMap<String, Any?>()
    next["binding"] = bound
    next["commandRevision"] = (commandRevision + 1).toDouble()
    next["source"] = listeningOrigin + (media["streamUrl"] as String)
    next["connectionState"] = if (listeningRouteReady) "ready" else "verifying"
    next["routeRevision"] = listeningRouteRevision.toDouble()
    next["paused"] = !listeningRouteReady || !listeningAllowed || desired["state"] != "playing"
    next["rate"] = number(desired["rate"]) ?: 1.0
    next["timelineOriginMs"] = null
    next["pendingSeek"] = listeningSeek
    next["audioRender"] = listeningRender
    next["seekPlan"] = media["seekPlan"]
    next["audio"] = attached?.get("audio") ?: command?.get("audio")
    next["subtitles"] = attached?.get("subtitles") ?: command?.get("subtitles")
    // The same command again changes nothing, and must not churn JavaScript's command barrier.
    val before = command?.let { HashMap(it).apply { remove("commandRevision") } }
    if (before == HashMap(next).apply { remove("commandRevision") }) return
    applyingListening = true
    val error = accept(next)
    applyingListening = false
    if (error != null) {
      player?.playWhenReady = false
      val fact = HashMap<String, Any?>()
      fact["instanceId"] = instanceId
      fact["type"] = "error"
      fact["intentId"] = intentId.toDouble()
      fact["error"] = error
      fact["position"] = sourcePosition().takeIf { it.isFinite() } ?: 0.0
      fact["paused"] = true
      publish(fact)
    }
  }

  // --- time ------------------------------------------------------------------------------

  /** The position in the media's own timeline: seconds from its start, or from the channel's origin. */
  fun sourcePosition(): Double {
    val engine = player ?: return Double.NaN
    if (engine.currentMediaItem == null) return Double.NaN
    val origin = timelineOriginMs
    if (origin != null) {
      val start = windowStartMs(engine) ?: return Double.NaN
      return (start + engine.currentPosition - origin) / 1000.0
    }
    return engine.currentPosition / 1000.0
  }

  private fun windowStartMs(engine: ExoPlayer): Long? {
    val timeline = engine.currentTimeline
    if (timeline.isEmpty) return null
    val start = timeline.getWindow(engine.currentMediaItemIndex, Timeline.Window()).windowStartTimeMs
    return if (start == C.TIME_UNSET) null else start
  }

  /** A position on the channel's timeline as a position in the player's window. */
  private fun linearTarget(seconds: Double): Long? {
    val engine = player ?: return null
    val start = windowStartMs(engine) ?: return null
    return (timelineOriginMs!! + seconds * 1000 - start).toLong()
  }

  private fun desiredRate(): Double = number(command?.get("rate")) ?: 1.0

  private fun supportedRates(): List<Double> {
    val engine = player
    if (engine == null || !(engine.playbackState == Player.STATE_READY || engine.playbackState == Player.STATE_BUFFERING)) return emptyList()
    return if (timelineOriginMs != null) LINEAR_RATES else RATES
  }

  private fun isPaused(): Boolean = player?.playWhenReady != true && !seeking && !routeResume

  private fun rateFacts(): Map<String, Any?> {
    val engine = player
    val ready = engine != null && (engine.playbackState == Player.STATE_READY || engine.playbackState == Player.STATE_BUFFERING)
    val valid = supportedRates().contains(desiredRate())
    return mapOf(
        "effectiveRate" to (if (engine?.isPlaying == true) engine.playbackParameters.speed.toDouble() else 0.0),
        "supportedRates" to supportedRates(),
        "rateReady" to ready,
        "rateWaiting" to (engine?.playWhenReady == true && engine.playbackState == Player.STATE_BUFFERING),
        "rateError" to (if (ready && !valid) "rate_unavailable" else ""),
        "monotonicSeconds" to SystemClock.elapsedRealtime() / 1000.0)
  }

  private fun startTicking() {
    if (ticking) return
    ticking = true
    main.postDelayed(progressTick, 500)
    main.postDelayed(subtitleTick, 50)
  }

  private fun stopTicking() {
    ticking = false
    main.removeCallbacks(progressTick)
    main.removeCallbacks(subtitleTick)
  }

  private val progressTick = object : Runnable {
    override fun run() {
      if (!ticking) return
      applyRouteResume()
      applyPendingSeek()
      watchEdge()
      // While nothing moves there is nothing new to say.
      val position = sourcePosition()
      if (player?.isPlaying == true && !seeking && !routeResume && position.isFinite() && previousProgress.isFinite() && position > previousProgress + 0.05) hasPlayed = true
      previousProgress = position
      val signature = "${if (position.isFinite()) (position * 2).toLong() else -1}/${isPaused()}/${player?.playbackState}"
      if (player?.isPlaying == true || signature != lastProgress) { lastProgress = signature; emit("progress", null) }
      main.postDelayed(this, 500)
    }
  }

  private val subtitleTick = object : Runnable {
    override fun run() {
      if (!ticking) return
      val engine = player
      if (engine != null && subtitles.overlayActive && engine.currentMediaItem != null) subtitles.tick(engine.currentPosition * 1000)
      main.postDelayed(this, 50)
    }
  }

  // --- facts -----------------------------------------------------------------------------

  private fun emit(type: String, error: String?, extra: Map<String, Any?>? = null) {
    if (onFact == null || source.isNullOrEmpty()) return
    val position = if (routeResume || routeFailed) routePosition else sourcePosition()
    if (timelineOriginMs != null && !position.isFinite() && (type == "progress" || type == "ended")) return
    val fact = HashMap<String, Any?>()
    fact["instanceId"] = instanceId
    fact["type"] = type
    fact["intentId"] = intentId.toDouble()
    fact["position"] = if (position.isFinite()) position else 0.0
    fact["paused"] = isPaused()
    fact["error"] = error ?: ""
    fact.putAll(rateFacts())
    if (type == "progress") connectionFacts(fact)
    if (extra != null) fact.putAll(extra)
    publish(fact)
  }

  /**
   * What the player measured of the connection and how much it holds ahead of the picture, for
   * Automatic quality. A measurement is said only while it is fresh: with a full buffer nothing
   * is downloaded, and an old figure says nothing about the connection now.
   */
  private fun connectionFacts(fact: MutableMap<String, Any?>) {
    val engine = player ?: return
    if (timelineOriginMs != null || listeningOwner != null || source?.startsWith("file:") == true) return
    if (measuredBitrate > 0 && SystemClock.elapsedRealtime() - measuredAt <= 15_000) fact["throughputKbps"] = Math.round(measuredBitrate / 1000.0).toDouble()
    val buffered = engine.totalBufferedDuration
    if (buffered >= 0) fact["bufferedSeconds"] = buffered / 1000.0
  }

  private fun publish(fact: MutableMap<String, Any?>) {
    val send = onFact ?: return
    val bound = currentBinding ?: return
    if (lease == null || routeSuspended || ((routeResume || routeSeeking || routeFailed) && fact["type"] != "error")) return
    fact["itemInstanceId"] = itemInstanceId
    fact["binding"] = bound
    fact["factSequence"] = (++factSequence).toDouble()
    fact["lastCommandRevision"] = commandRevision.toDouble()
    fact["seeking"] = seeking || command?.get("pendingSeek") is Map<*, *>
    send(Arguments.makeNativeMap(fact))
    // The owner may answer with a new command: it reads the fact after this call has unwound, so
    // nothing here is re-entered half way through.
    if (listeningOwner != null) main.post { onListeningFact?.invoke(fact) }
  }

  /**
   * One failure, classified. A network failure is weather and is retried on the same route. An
   * engine failure (the decoder or the parser refusing what it was given) carries its class and
   * the underlying code, so the app can tell the server which route failed and ask for the next.
   */
  private fun publishFailure(error: PlaybackException) {
    val httpStatus = generateSequence<Throwable>(error) { it.cause }.take(4)
        .filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.responseCode ?: 0
    val delivery = httpStatus >= 400 || error.errorCode in DELIVERY_ERRORS
    val network = if (httpStatus >= 400) httpStatus in 500..599 || httpStatus == 408 || httpStatus == 429
        else error.errorCode in NETWORK_ERRORS
    val engine = when (error.errorCode) {
      in DECODE_ERRORS -> "decode_error"
      in SOURCE_ERRORS -> "source_not_supported"
      else -> ""
    }
    val position = if (routeResume || routeFailed) routePosition else sourcePosition()
    val fact = HashMap<String, Any?>()
    fact["instanceId"] = instanceId
    fact["type"] = "error"
    fact["intentId"] = intentId.toDouble()
    fact["position"] = if (position.isFinite()) position else 0.0
    fact["paused"] = true
    fact["networkError"] = network
    fact["deliveryError"] = delivery
    fact["httpStatus"] = httpStatus
    fact["hasPlayed"] = hasPlayed
    // A time-out, or a failure in another process, says nothing about the media: at start-up it
    // must not be taken for an incompatibility (the Apple runtime marks its interruptions too).
    fact["uncertain"] = !network && !delivery && engine.isEmpty() && error.errorCode in UNCERTAIN_ERRORS
    fact["engineCode"] = if (network || delivery) "" else engine
    fact["errorDetail"] = "media3 ${error.errorCode} ${error.errorCodeName}" + (error.cause?.let { " / ${it.javaClass.simpleName}" } ?: "")
    fact["error"] = if (network) "media_connection_interrupted" else "playback_failed"
    fact.putAll(rateFacts())
    publish(fact)
  }

  /**
   * A downloaded title plays here like a streamed one. A file is accepted only inside the app's
   * own Downloads folder, resolved after symlinks, and never from anywhere else on the device.
   */
  private fun allowedLocalSource(url: Uri): Boolean {
    if (url.scheme != "file" || url.encodedQuery != null || url.encodedFragment != null) return false
    return try {
      val root = File(context.noBackupFilesDir, "Downloads").canonicalPath
      val file = File(url.path ?: return false).canonicalFile
      file.path.startsWith("$root/") && file.isFile
    } catch (_: Exception) {
      false
    }
  }

  companion object {
    private const val MAX_INTEGER = 9007199254740991.0
    private val CONNECTION_STATES = setOf("ready", "verifying")
    // 2.5x and 3x are for audiobooks (the menu offers them only there), as on web.
    private val RATES = listOf(0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0)
    private val LINEAR_RATES = listOf(1.0)
    private val NETWORK_ERRORS = setOf(
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
        PlaybackException.ERROR_CODE_IO_UNSPECIFIED)
    private val DELIVERY_ERRORS = setOf(
        PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
        PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE, PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
        PlaybackException.ERROR_CODE_IO_NO_PERMISSION, PlaybackException.ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED,
        PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
    private val DECODE_ERRORS = setOf(
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED, PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FAILED, PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED)
    private val SOURCE_ERRORS = setOf(
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED, PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED, PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED)
    private val UNCERTAIN_ERRORS = setOf(
        PlaybackException.ERROR_CODE_TIMEOUT, PlaybackException.ERROR_CODE_REMOTE_ERROR,
        PlaybackException.ERROR_CODE_DECODING_RESOURCES_RECLAIMED,
        PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED, PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED)

    /** The app's one playback controller, for the player view and the system media surfaces. */
    @Volatile var shared: PorticoPlaybackController? = null

    /** Media addresses are capability URLs; one client keeps their connections warm. */
    private val mediaClient: OkHttpClient by lazy {
      OkHttpClient.Builder().porticoTrust().followRedirects(false).followSslRedirects(false)
          .connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
    }

    fun number(value: Any?): Double? = (value as? Number)?.toDouble()?.takeIf { it.isFinite() }

    private fun wholeNumber(value: Any?): Boolean {
      val n = number(value) ?: return false
      return n >= 0 && n <= MAX_INTEGER && Math.floor(n) == n
    }

    private fun positiveInteger(value: Any?): Boolean = wholeNumber(value) && number(value)!! >= 1

    private fun parse(value: String): Uri? = try { Uri.parse(value).takeIf { it.scheme != null } } catch (_: Exception) { null }

    private fun lowMemory(context: Context): Boolean {
      val info = ActivityManager.MemoryInfo()
      (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(info)
      return info.totalMem in 1..(2_684_354_560L)
    }

    /** The panel's real size, long side first. */
    private fun screenSize(context: Context): Pair<Int, Int> {
      val metrics = DisplayMetrics()
      val display = (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.getDisplay(Display.DEFAULT_DISPLAY)
      @Suppress("DEPRECATION") display?.getRealMetrics(metrics)
      var width = maxOf(metrics.widthPixels, metrics.heightPixels)
      var height = minOf(metrics.widthPixels, metrics.heightPixels)
      // A television's interface is often 1080p on a 4K panel; video may use the panel.
      for (mode in display?.supportedModes ?: emptyArray()) {
        if (mode.physicalWidth.toLong() * mode.physicalHeight > width.toLong() * height) { width = maxOf(mode.physicalWidth, mode.physicalHeight); height = minOf(mode.physicalWidth, mode.physicalHeight) }
      }
      return Pair(if (width > 0) width else Int.MAX_VALUE, if (height > 0) height else Int.MAX_VALUE)
    }
  }
}
