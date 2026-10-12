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
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
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
  /** The picture's size as the player last reported it (it keeps the last one across a reload of the same film). */
  val videoSize: VideoSize get() = player?.videoSize?.takeIf { it.width > 0 && it.height > 0 } ?: lastVideoSize
  private var lastVideoSize: VideoSize = VideoSize.UNKNOWN

  /** The chosen subtitles are drawn by the app. */
  val subtitleOverlayActive: Boolean get() = subtitles.overlayActive
  val binding: Map<String, Any?>? get() = currentBinding
  val paused: Boolean get() = desiredPaused
  /** A picture is being decoded (music and audiobooks have none). */
  val hasVideo: Boolean get() = player?.currentTracks?.isTypeSelected(C.TRACK_TYPE_VIDEO) == true
  val listeningActive: Boolean get() = listeningOwner != null

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

  private var readyAnnounced = false
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
    subtitles.onText = { cue -> subtitleCue = cue; subtitleListeners.toList().forEach { it() } }
    subtitles.onStatus = { error -> emit("subtitleStatus", error) }
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
    }
    return mapOf("lease" to lease, "instanceId" to instanceId)
  }

  fun release(lease: String?) {
    if (lease == null || this.lease != lease) return
    subtitles.invalidate()
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
    attachmentListeners.toList().forEach { it() }
  }

  fun invalidate() {
    invalidated = true
    onFact = null
    release(lease)
    player?.release()
    player = null
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
    if (previousRoute != null && (route == null || number(route)!! < previousRoute)) return "Stale route transition."
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
      val routeChange = sameBinding && sameResource && route != null && number(route)!! > (previousRoute ?: 0.0)
      val same = sameBinding && (sameSource || routeChange)
      val newWindow = linear && timelineOriginMs != null && bound["sessionId"] == current["sessionId"] && bound["itemId"] == current["itemId"] &&
          number(bound["generation"])!! > number(current["generation"])!!
      if (intent < old || (intent == old && !same && !newWindow)) return "Stale playback binding."
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
      if (!routeSuspended) { subtitles.invalidate(); audioSelection.invalidate(); unload(); routeSeeking = false; seeking = false; seekWait = null }
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
      subtitles.invalidate()
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
        if (url == null || !(url.scheme == "http" || url.scheme == "https" || allowedLocalSource(url))) { emit("error", "Invalid media address."); return }
        val pendingStart = (next["pendingSeek"] as? Map<*, *>)?.get("positionSeconds")?.let { number(it) }
        load(url, if (plan != null && !routeResume) pendingStart else null)
        enginePlan = plan?.get("id") as? String
        if (routeResume) {
          val epoch = routeEpoch
          val item = itemInstanceId
          main.postDelayed({
            if (!invalidated && routeEpoch == epoch && itemInstanceId == item && routeResume) {
              routeResume = false; routeSeeking = false; routeFailed = true; routeEpoch++
              player?.playWhenReady = false
              emit("error", "Connection restored, but the retained position is not available. Your playback session was not replaced.")
            }
          }, 10_000)
        }
      }
    }
    val pending = next["pendingSeek"] as? Map<*, *>
    if (pending != null && (routeResume || routeSeeking || routeFailed)) { routeResume = false; routeSeeking = false; routeFailed = false; routeEpoch++ }
    if (pending == null && seeking) { seeking = false; seekWait = null }
    audioSelection.apply(scoped(next["audio"]), player, itemInstanceId)
    subtitles.apply(scoped(next["subtitles"]), source)
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

  private fun engine(): ExoPlayer {
    player?.let { return it }
    val http = OkHttpDataSource.Factory(mediaClient)
    val load = DefaultLoadControl.Builder()
    // A high-bitrate stream must not take memory the interface needs on a small device.
    if (lowMemory(context)) load.setBufferDurationsMs(15_000, 30_000, 2_500, 5_000)
    val made = ExoPlayer.Builder(context, DefaultRenderersFactory(context).setEnableDecoderFallback(true))
        .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(context, http)))
        .setLoadControl(load.build())
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
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
    made.addListener(listener)
    player = made
    return made
  }

  private fun load(url: Uri, startSeconds: Double? = null) {
    val engine = engine()
    itemInstanceId = UUID.randomUUID().toString()
    readyAnnounced = false
    val start = if (routeResume && timelineOriginMs == null) (routePosition * 1000).toLong()
        else if (startSeconds != null && startSeconds > 0 && timelineOriginMs == null) (startSeconds * 1000).toLong() else C.TIME_UNSET
    engine.playWhenReady = false
    engine.setMediaItem(MediaItem.fromUri(url), start)
    engine.prepare()
  }

  private fun unload() {
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
    engine.volume = 1f
    engine.stop()
    engine.clearMediaItems()
    readyAnnounced = false
  }

  private val listener = object : Player.Listener {
    override fun onPlaybackStateChanged(state: Int) {
      when (state) {
        Player.STATE_READY -> {
          applyRouteResume()
          if (!readyAnnounced && !routeResume && !routeFailed) { readyAnnounced = true; emit("ready", null) }
          finishSeek()
          applyPendingSeek()
          applyIntent()
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

    override fun onRenderedFirstFrame() { if (lease != null) emit("firstFrame", null) }

    override fun onTracksChanged(tracks: Tracks) = audioSelection.tracksChanged(tracks)

    override fun onVideoSizeChanged(size: VideoSize) {
      if (size.width > 0 && size.height > 0) lastVideoSize = size
      videoSizeListeners.toList().forEach { it() }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) { lastProgress = "" }
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
      emit("error", "The previous playback position is unavailable on this connection. Your position has been retained.")
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
    val fact = HashMap<String, Any?>()
    fact["instanceId"] = instanceId
    fact["type"] = if (applied) "seekApplied" else "seekFailed"
    fact["intentId"] = wait.intent.toDouble()
    fact["seekRevision"] = wait.revision.toDouble()
    fact["position"] = if (observed.isFinite()) observed else 0.0
    fact["paused"] = isPaused()
    fact["error"] = if (applied) "" else "That position is not available yet. Try seeking again."
    fact.putAll(rateFacts())
    publish(fact)
  }

  private fun applyIntent() {
    val engine = player ?: return
    val pending = command?.get("pendingSeek") is Map<*, *>
    if (desiredPaused || seeking || pending || routeSuspended || routeResume || routeSeeking || routeFailed || (listeningOwner != null && !listeningAllowed)) {
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
    if (incoming == null) engine.volume = PorticoAudioPlan.gain(planOf(render), settings())
    val committed = render["committed"] as? Map<*, *>
    val wanted = committed ?: render["prepared"] as? Map<*, *>
    val token = wanted?.get("token") as? String
    val plan = planOf(wanted)
    if (token == null || plan == null) { if (nextToken != null && committedToken == null) dropNext(); return }
    if (nextToken != token) {
      dropNext()
      engine.addMediaItem(MediaItem.Builder().setUri(plan["url"] as String).setMediaId(token).build())
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
    val deck = ExoPlayer.Builder(context, DefaultRenderersFactory(context).setEnableDecoderFallback(true))
        .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(context, OkHttpDataSource.Factory(mediaClient))))
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), false)
        .setHandleAudioBecomingNoisy(false)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .build()
    deck.volume = 0f
    deck.addListener(incomingListener)
    deck.setMediaItem(MediaItem.fromUri(plan["url"] as String))
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
      if (token != null) emit("audioPreparationFailed", "The next track could not be buffered.", mapOf("token" to token))
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
      old.volume = (outgoing * Math.cos(t * Math.PI / 2)).toFloat()
      deck.volume = (arriving * Math.sin(t * Math.PI / 2)).toFloat()
      val over = t >= 1 || (fadeStartedAt != 0L && (heldAtEnd || old.playbackState == Player.STATE_ENDED))
      if (!over) { main.postDelayed(this, 40); return }
      // The new track is the player from here: position, facts and the next edge are its own.
      val token = nextToken ?: return
      deck.removeListener(incomingListener)
      incoming = null
      old.removeListener(listener)
      old.release()
      deck.volume = arriving
      deck.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
      deck.trackSelectionParameters = deck.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
      deck.addListener(listener)
      player = deck
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
        "rendering" to (enginePlan != null))
  }

  /** The owner's whole intent for the engine: what plays, whether it may, where it starts, and its audio plan. */
  fun listeningOwner(owner: String, state: Map<String, Any?>, origin: String, allowed: Boolean, seek: Map<String, Any?>?, render: Map<String, Any?>?) {
    if (listeningOwner != owner) { player?.playWhenReady = false; incoming?.playWhenReady = false }
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
  }

  /** A clean engine under the same lease: a retry, or a committed track started as an ordinary one. */
  fun resetListeningEngine(owner: String) {
    if (listeningOwner != owner) return
    listeningAttachment = currentBinding?.let { mapOf("binding" to it) } ?: listeningAttachment
    subtitles.invalidate()
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
        "rateError" to (if (ready && !valid) "This speed is unavailable for this media. Choose a supported speed, then press Play." else ""),
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
    if (extra != null) fact.putAll(extra)
    publish(fact)
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
    val network = error.errorCode in NETWORK_ERRORS
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
    fact["engineCode"] = if (network) "" else engine
    fact["errorDetail"] = "media3 ${error.errorCode} ${error.errorCodeName}" + (error.cause?.let { " / ${it.javaClass.simpleName}" } ?: "")
    fact["error"] = if (network) "The media connection was interrupted. Verifying another route." else "This media could not be played. Check its format or try again."
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
    private val RATES = listOf(0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0)
    private val LINEAR_RATES = listOf(1.0)
    private val NETWORK_ERRORS = setOf(
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
        PlaybackException.ERROR_CODE_IO_UNSPECIFIED, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
        PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE, PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
        PlaybackException.ERROR_CODE_IO_NO_PERMISSION, PlaybackException.ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED,
        PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
    private val DECODE_ERRORS = setOf(
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED, PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FAILED, PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, PlaybackException.ERROR_CODE_DECODING_RESOURCES_RECLAIMED,
        PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED, PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED)
    private val SOURCE_ERRORS = setOf(
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED, PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED, PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED)

    /** The app's one playback controller, for the player view and the system media surfaces. */
    @Volatile var shared: PorticoPlaybackController? = null

    /** Media addresses are capability URLs; one client keeps their connections warm. */
    private val mediaClient: OkHttpClient by lazy {
      OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
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
