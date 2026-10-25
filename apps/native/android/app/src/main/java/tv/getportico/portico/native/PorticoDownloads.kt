package tv.getportico.portico.native

import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * `NativeModules.PorticoDownloads`: the methods and the event of the Apple module
 * (`PorticoDownloadChanged`). A download plays in Portico's own player (`localFile`). Phones and tablets only; a television has
 * no such module, and the app hides downloads there.
 */
class PorticoDownloads(context: ReactApplicationContext) : PorticoEventModule(context) {
  private val publications = PorticoPublicationReads()
  /** Cover-page temp files this very module created; opaque handle -> private cache file. */
  private val coverImages = mutableMapOf<String, File>()
  private val coverLock = Any()
  private var coverRetired = false
  private var coverGeneration = 0L
  private val coverBase64 = Regex("^[A-Za-z0-9+/]*={0,2}$")
  private val maxCoverEncoded = ((10 * 1024 * 1024 + 2) / 3) * 4
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
    publications.invalidate()
    val retired = synchronized(coverLock) {
      coverRetired = true; coverGeneration++
      val files = coverImages.values.toList(); coverImages.clear(); files
    }
    retired.forEach { it.delete() }
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
  @ReactMethod fun publicationOpen(handle: String, identifier: String, owner: String, digest: String, promise: Promise) = PorticoDownloadCenter.post {
    val found = if (!invalidated) PorticoDownloadCenter.publication(identifier, owner, digest) else null
    if (found == null) promise.reject("reading_unavailable", "reading_unavailable")
    else publications.open(handle, found.first, found.first.length(), digest, found.second, promise)
  }
  @ReactMethod fun publicationRead(handle: String, operation: Double, offset: Double, length: Double, promise: Promise) = publications.range(handle, operation, offset, length, promise)
  @ReactMethod fun publicationMember(handle: String, operation: Double, offset: Double, compressed: Double, size: Double, method: Double, digest: String, promise: Promise) = publications.member(handle, operation, offset, compressed, size, method, digest, promise)
  @ReactMethod fun publicationMemberRead(handle: String, operation: Double, offset: Double, length: Double, promise: Promise) = publications.memberRange(handle, operation, offset, length, promise)
  @ReactMethod fun publicationCancel(handle: String, operation: Double) {publications.cancel(handle, operation)}
  @ReactMethod fun publicationClose(handle: String) {publications.close(handle)}

  private fun coverDirectory(): File {
    val directory = File(reactApplicationContext.cacheDir, "portico-cover-uploads")
    if (!directory.exists() && !directory.mkdirs()) throw java.io.IOException("cover_directory")
    return directory.canonicalFile
  }
  private fun coverMime(data: ByteArray): String? {
    fun at(index: Int, value: Int) = index < data.size && (data[index].toInt() and 0xFF) == value
    return when {
      at(0, 0xFF) && at(1, 0xD8) && at(2, 0xFF) -> "image/jpeg"
      at(0, 0x89) && at(1, 0x50) && at(2, 0x4E) && at(3, 0x47) && at(4, 0x0D) && at(5, 0x0A) && at(6, 0x1A) && at(7, 0x0A) -> "image/png"
      at(0, 0x52) && at(1, 0x49) && at(2, 0x46) && at(3, 0x46) && at(8, 0x57) && at(9, 0x45) && at(10, 0x42) && at(11, 0x50) -> "image/webp"
      else -> null
    }
  }
  private fun coverExtension(mime: String) = when (mime) { "image/jpeg" -> ".jpg"; "image/png" -> ".png"; else -> ".webp" }

  /** One bounded image-only private temp file. Caller sends only bytes; the
   * filename, directory and handle are generated here. A write that loses its
   * module generation never registers and deletes its own partial file. */
  @ReactMethod
  fun writeCoverImage(mime: String?, base64: String?, promise: Promise) {
    val type = mime ?: run { promise.reject("invalid_image", "invalid_image"); return }
    if (type != "image/jpeg" && type != "image/png" && type != "image/webp") { promise.reject("unsupported_image", "unsupported_image"); return }
    val encoded = base64 ?: run { promise.reject("invalid_image", "invalid_image"); return }
    // Bound the bridge string before any decode allocation; strict canonical
    // base64, so no whitespace, ignored character or malformed tail is accepted.
    if (encoded.length == 0 || encoded.length > maxCoverEncoded || encoded.length % 4 != 0 || !coverBase64.matches(encoded)) {
      promise.reject("invalid_image", "invalid_image"); return
    }
    val data = try { Base64.decode(encoded, Base64.NO_WRAP) } catch (_: IllegalArgumentException) { promise.reject("invalid_image", "invalid_image"); return }
    // Canonical equality also rejects non-zero unused tail bits in the last sextet.
    if (Base64.encodeToString(data, Base64.NO_WRAP) != encoded) { promise.reject("invalid_image", "invalid_image"); return }
    if (data.isEmpty() || data.size > 10 * 1024 * 1024) { promise.reject("invalid_image", "invalid_image"); return }
    if (coverMime(data) != type) { promise.reject("unsupported_image", "unsupported_image"); return }
    val generation = synchronized(coverLock) { if (coverRetired) -1L else coverGeneration }
    if (generation < 0) { promise.reject("cancelled", "cancelled"); return }
    var file: File? = null
    try {
      val target = File(coverDirectory(), UUID.randomUUID().toString() + coverExtension(type))
      file = target
      FileOutputStream(target).use { out -> out.write(data); out.flush(); out.fd.sync() }
      if (!target.isFile || target.length() != data.size.toLong()) throw java.io.IOException("cover_write")
      val handle = UUID.randomUUID().toString()
      val registered = synchronized(coverLock) {
        if (coverRetired || coverGeneration != generation) false else { coverImages[handle] = target; true }
      }
      if (!registered) { target.delete(); promise.reject("cancelled", "cancelled"); return }
      val result = Arguments.createMap()
      result.putString("handle", handle)
      result.putString("uri", Uri.fromFile(target).toString())
      result.putDouble("size", target.length().toDouble())
      promise.resolve(result)
    } catch (_: Exception) {
      file?.delete()
      promise.reject("write_failed", "write_failed")
    }
  }
  /** Idempotent. A handle is removed only after its private file is gone; a
   * failed delete keeps the exact bookkeeping so teardown can retry. */
  @ReactMethod
  fun deleteCoverImage(handle: String?, promise: Promise) {
    val file = handle?.let { synchronized(coverLock) { coverImages[it] } }
    if (file == null) { promise.resolve(null); return }
    val directory = reactApplicationContext.cacheDir.resolve("portico-cover-uploads").canonicalFile
    if (file.canonicalFile.parentFile != directory) {
      synchronized(coverLock) { coverImages.remove(handle) }
      promise.reject("invalid_handle", "invalid_handle"); return
    }
    if (file.delete() || !file.exists()) {
      synchronized(coverLock) { coverImages.remove(handle) }
      promise.resolve(null)
    } else promise.reject("delete_failed", "delete_failed")
  }
}

