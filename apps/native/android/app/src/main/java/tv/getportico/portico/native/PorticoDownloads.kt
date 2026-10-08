package tv.getportico.portico.native

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.VideoView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File

/**
 * `NativeModules.PorticoDownloads`: the twelve methods and two events of the Apple module
 * (`PorticoDownloadChanged`, `PorticoDownloadPlayback`). Phones and tablets only; a television has
 * no such module, and the app hides downloads there.
 */
class PorticoDownloads(context: ReactApplicationContext) : PorticoEventModule(context) {
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var invalidated = false

  override fun getName(): String = "PorticoDownloads"

  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}

  override fun initialize() {
    super.initialize()
    current = this
    PorticoDownloadCenter.post {
      PorticoDownloadCenter.open(reactApplicationContext)
      PorticoDownloadCenter.onChanged = { entry -> if (!invalidated) emit("PorticoDownloadChanged", Arguments.makeNativeMap(entry)) }
    }
  }

  override fun invalidate() {
    invalidated = true
    if (current === this) current = null
    // Transfers belong to the process and go on; only the listener goes.
    PorticoDownloadCenter.post { PorticoDownloadCenter.onChanged = null }
    super.invalidate()
  }

  @ReactMethod
  fun list(promise: Promise) = PorticoDownloadCenter.post { promise.resolve(Arguments.makeNativeArray(PorticoDownloadCenter.list())) }

  @ReactMethod
  fun start(request: ReadableMap?, promise: Promise) {
    val value = request?.toHashMap()
    PorticoDownloadCenter.post {
      val entry = value?.let { PorticoDownloadCenter.start(it) }
      if (entry != null) promise.resolve(Arguments.makeNativeMap(entry)) else promise.reject("invalid_download", "The download request is invalid.")
    }
  }

  @ReactMethod
  fun pause(identifier: String?, promise: Promise) = PorticoDownloadCenter.post { PorticoDownloadCenter.pause(identifier); promise.resolve(null) }

  @ReactMethod
  fun remove(identifier: String?, promise: Promise) = PorticoDownloadCenter.post {
    if (PorticoDownloadCenter.remove(identifier)) promise.resolve(null) else promise.reject("invalid_download", "The download is invalid.")
  }

  @ReactMethod
  fun setMeta(identifier: String?, meta: String?, promise: Promise) = PorticoDownloadCenter.post {
    when (PorticoDownloadCenter.setMeta(identifier, meta)) {
      null -> promise.resolve(null)
      "not_found" -> promise.reject("not_found", "This download no longer exists.")
      "too_large" -> promise.reject("too_large", "This download's details are too large to keep.")
      else -> promise.reject("write_failed", "This download's details could not be saved.")
    }
  }

  @ReactMethod
  fun storage(promise: Promise) = PorticoDownloadCenter.post { promise.resolve(Arguments.makeNativeMap(PorticoDownloadCenter.storage())) }

  @ReactMethod
  fun setCellular(allowed: Boolean, promise: Promise) = PorticoDownloadCenter.post { PorticoDownloadCenter.setCellular(allowed); promise.resolve(null) }

  @ReactMethod
  fun readState(promise: Promise) = PorticoDownloadCenter.post { promise.resolve(PorticoDownloadCenter.readState()) }

  @ReactMethod
  fun writeState(json: String?, promise: Promise) = PorticoDownloadCenter.post {
    if (json == null || json.length >= 1048576) promise.reject("too_large", "Download settings are too large to keep.")
    else if (PorticoDownloadCenter.writeState(json)) promise.resolve(null)
    else promise.reject("write_failed", "Download settings could not be saved.")
  }

  private fun fileOr(identifier: String?, promise: Promise): File? = when (val found = PorticoDownloadCenter.file(identifier)) {
    is File -> found
    "missing_file" -> { promise.reject("missing_file", "This download’s file is missing. Remove it and download it again."); null }
    else -> { promise.reject("not_ready", "This download is not ready to play."); null }
  }

  /** The file of a finished download, for Portico's own player (it accepts a file only inside the downloads folder). */
  @ReactMethod
  fun localFile(identifier: String?, promise: Promise) = PorticoDownloadCenter.post {
    val file = fileOr(identifier, promise) ?: return@post
    val result = Arguments.createMap()
    result.putString("url", Uri.fromFile(file).toString())
    result.putDouble("durationSeconds", PorticoDownloadCenter.durationSeconds(file))
    promise.resolve(result)
  }

  /**
   * Plays a finished download in a plain full-screen player (the launch flow's offline Downloads,
   * where Portico's player isn't mounted). No server is involved; the position is reported back
   * so it can be sent to the server later.
   */
  @ReactMethod
  fun play(identifier: String?, startSeconds: Double, promise: Promise) = PorticoDownloadCenter.post {
    val file = fileOr(identifier, promise) ?: return@post
    main.post {
      val activity = reactApplicationContext.currentActivity
      if (activity == null) { promise.reject("no_window", "The player could not be shown."); return@post }
      activity.startActivity(Intent(activity, PorticoOfflinePlayerActivity::class.java)
          .putExtra("id", identifier).putExtra("path", file.path).putExtra("startSeconds", startSeconds))
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    main.post { PorticoOfflinePlayerActivity.current?.finish(); promise.resolve(null) }
  }

  internal fun playback(id: String, positionSeconds: Double, durationSeconds: Double, ended: Boolean) {
    if (invalidated) return
    val body = Arguments.createMap()
    body.putString("id", id)
    body.putDouble("positionSeconds", positionSeconds)
    body.putDouble("durationSeconds", durationSeconds)
    body.putBoolean("ended", ended)
    emit("PorticoDownloadPlayback", body)
  }

  companion object {
    @Volatile internal var current: PorticoDownloads? = null
  }
}

/** The plain full-screen player for a downloaded file: the system's video view and its controls. */
class PorticoOfflinePlayerActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())
  private var video: VideoView? = null
  private var id = ""

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val path = intent.getStringExtra("path")
    id = intent.getStringExtra("id") ?: ""
    // Only a file inside the downloads folder is ever played here.
    val root = File(noBackupFilesDir, "Downloads").canonicalPath
    val file = path?.let { File(it).canonicalFile }
    if (file == null || !file.path.startsWith("$root/") || !file.isFile) { finish(); return }
    current = this
    val view = VideoView(this)
    val frame = FrameLayout(this)
    frame.setBackgroundColor(0xFF000000.toInt())
    frame.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER))
    setContentView(frame)
    view.setMediaController(MediaController(this).also { it.setAnchorView(view) })
    view.setVideoURI(Uri.fromFile(file))
    val start = intent.getDoubleExtra("startSeconds", 0.0)
    view.setOnPreparedListener { if (start > 1) view.seekTo((start * 1000).toInt()); view.start() }
    view.setOnCompletionListener { report(true) }
    view.setOnErrorListener { _, _, _ -> finish(); true }
    video = view
    main.postDelayed(tick, 5000)
  }

  private val tick = object : Runnable {
    override fun run() { report(false); main.postDelayed(this, 5000) }
  }

  private fun report(ended: Boolean) {
    val view = video ?: return
    val duration = view.duration
    PorticoDownloads.current?.playback(id, view.currentPosition / 1000.0, if (duration > 0) duration / 1000.0 else 0.0, ended)
  }

  override fun onPause() {
    super.onPause()
    report(false)
    video?.pause()
  }

  override fun onDestroy() {
    main.removeCallbacks(tick)
    video?.stopPlayback()
    video = null
    if (current === this) current = null
    super.onDestroy()
  }

  companion object {
    @Volatile internal var current: PorticoOfflinePlayerActivity? = null
  }
}
