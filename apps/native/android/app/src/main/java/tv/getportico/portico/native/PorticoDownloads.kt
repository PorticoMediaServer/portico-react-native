package tv.getportico.portico.native

import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File

/**
 * `NativeModules.PorticoDownloads`: the methods and the event of the Apple module
 * (`PorticoDownloadChanged`). A download plays in Portico's own player (`localFile`). Phones and tablets only; a television has
 * no such module, and the app hides downloads there.
 */
class PorticoDownloads(context: ReactApplicationContext) : PorticoEventModule(context) {
  @Volatile private var invalidated = false
  private val changed: (Map<String, Any?>) -> Unit = { entry ->
    if (!invalidated) emit("PorticoDownloadChanged", Arguments.makeNativeMap(entry))
  }

  override fun getName(): String = "PorticoDownloads"

  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}

  override fun initialize() {
    super.initialize()
    PorticoDownloadCenter.post {
      if (invalidated) return@post
      PorticoDownloadCenter.open(reactApplicationContext)
      PorticoDownloadCenter.onChanged = changed
    }
  }

  override fun invalidate() {
    invalidated = true
    // Transfers belong to the process and go on; only the listener goes.
    PorticoDownloadCenter.post {
      if (PorticoDownloadCenter.onChanged === changed) PorticoDownloadCenter.onChanged = null
    }
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
  fun setMetas(metas: ReadableMap?, promise: Promise) {
    val value = metas?.toHashMap()
    PorticoDownloadCenter.post {
      when (if (value == null) "too_large" else PorticoDownloadCenter.setMetas(value)) {
        null -> promise.resolve(null)
        "too_large" -> promise.reject("too_large", "This download's details are too large to keep.")
        else -> promise.reject("write_failed", "This download's details could not be saved.")
      }
    }
  }

  @ReactMethod
  fun writeExtra(identifier: String?, name: String?, text: String?, promise: Promise) = PorticoDownloadCenter.post {
    if (PorticoDownloadCenter.writeExtra(identifier, name, text)) promise.resolve(null) else promise.reject("write_failed", "This download's details could not be saved.")
  }

  @ReactMethod
  fun readExtra(identifier: String?, name: String?, promise: Promise) = PorticoDownloadCenter.post { promise.resolve(PorticoDownloadCenter.readExtra(identifier, name)) }

  @ReactMethod
  fun fetchExtra(identifier: String?, name: String?, url: String?, promise: Promise) = PorticoDownloadCenter.post {
    PorticoDownloadCenter.fetchExtra(identifier, name, url) { outcome -> promise.resolve(outcome) }
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
}

