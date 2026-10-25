package tv.getportico.portico.native

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.concurrent.Executors
import tv.getportico.portico.TelevisionDisplay

private val pickerWork = Executors.newSingleThreadExecutor { Thread(it, "portico-pickers") }

private fun displayName(context: Context, uri: Uri): String {
  try {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0)?.let { return it }
    }
  } catch (_: Exception) {}
  return uri.lastPathSegment ?: ""
}

/**
 * `NativeModules.PorticoImagePicker.pick()`: one picture from the system picker, at most 1024
 * pixels on its long side, as JPEG. Answers `null` when nothing was chosen, and on a television.
 * Only the bytes cross the bridge; no address and no lasting permission.
 */
class PorticoImagePicker(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var pending: Promise? = null

  private val listener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST) return
      val promise = pending ?: return
      pending = null
      val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
      if (uri == null) { promise.resolve(null); return }
      pickerWork.execute { promise.resolve(read(uri)) }
    }
  }

  init { context.addActivityEventListener(listener) }

  override fun getName(): String = "PorticoImagePicker"

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(listener)
    pending?.resolve(null)
    pending = null
    super.invalidate()
  }

  @ReactMethod
  fun pick(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (TelevisionDisplay.isTelevision || activity == null) { promise.resolve(null); return }
    pending?.resolve(null)
    pending = promise
    try {
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"), REQUEST)
    } catch (_: Exception) {
      pending = null
      promise.resolve(null)
    }
  }

  private fun read(uri: Uri): Any? = try {
    val resolver = reactApplicationContext.contentResolver
    val source: Bitmap? = if (Build.VERSION.SDK_INT >= 28) {
      // The decoder applies the picture's own rotation and never allocates more than it needs.
      ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val longest = Math.max(info.size.width, info.size.height)
        if (longest > 1024) decoder.setTargetSize(Math.max(1, info.size.width * 1024 / longest), Math.max(1, info.size.height * 1024 / longest))
      }
    } else @Suppress("DEPRECATION") MediaStore.Images.Media.getBitmap(resolver, uri)
    if (source == null) null else {
      val longest = Math.max(source.width, source.height)
      val scale = if (longest > 1024) 1024.0 / longest else 1.0
      val width = Math.max(1, Math.floor(source.width * scale).toInt())
      val height = Math.max(1, Math.floor(source.height * scale).toInt())
      // Opaque, on black: a transparent picture must not become a white or garbage background.
      val flat = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      Canvas(flat).apply { drawColor(Color.BLACK); drawBitmap(source, null, Rect(0, 0, width, height), null) }
      val out = ByteArrayOutputStream()
      flat.compress(Bitmap.CompressFormat.JPEG, 90, out)
      source.recycle(); flat.recycle()
      val bytes = out.toByteArray()
      Arguments.createMap().apply {
        putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        putString("contentType", "image/jpeg")
        putInt("bytes", bytes.size)
      }
    }
  } catch (_: Exception) { null } catch (_: OutOfMemoryError) { null }

  private companion object { const val REQUEST = 0x5049 }
}

/**
 * `NativeModules.PorticoSubtitleFiles.pick()`: one subtitle file (SRT, VTT, ASS/SSA, SUP) or a
 * matching IDX + SUB pair from the system picker, as bounded bytes. Phones and tablets; a
 * television says the picker is unavailable, as tvOS does.
 */
class PorticoSubtitleFiles(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var pending: Promise? = null

  private val listener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST) return
      val promise = pending ?: return
      pending = null
      val chosen = ArrayList<Uri>()
      if (resultCode == Activity.RESULT_OK) {
        data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) chosen.add(clip.getItemAt(i).uri) }
        if (chosen.isEmpty()) data?.data?.let { chosen.add(it) }
      }
      if (chosen.isEmpty()) { promise.reject("cancelled", "Subtitle file selection cancelled."); return }
      pickerWork.execute { read(chosen, promise) }
    }
  }

  init { context.addActivityEventListener(listener) }

  override fun getName(): String = "PorticoSubtitleFiles"

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(listener)
    pending?.reject("cancelled", "Subtitle file selection cancelled.")
    pending = null
    super.invalidate()
  }

  @ReactMethod
  fun pick(promise: Promise) {
    if (TelevisionDisplay.isTelevision) { promise.reject("subtitle_picker_unavailable", "Manage subtitle files from the web or a phone."); return }
    if (pending != null) { promise.reject("subtitle_picker_busy", "Another subtitle file is being read."); return }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) { promise.reject("subtitle_picker_unavailable", "Open the player before choosing a subtitle."); return }
    pending = promise
    try {
      // Subtitle files have no dependable media type: the extension is checked once a file is chosen.
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true), REQUEST)
    } catch (_: Exception) {
      pending = null
      promise.reject("subtitle_picker_unavailable", "Open the player before choosing a subtitle.")
    }
  }

  private fun read(chosen: List<Uri>, promise: Promise) {
    val context = reactApplicationContext
    val named = chosen.map { it to displayName(context, it) }
    val companion = named.firstOrNull { it.second.lowercase().endsWith(".sub") }
    val main = named.firstOrNull { !it.second.lowercase().endsWith(".sub") }
    val format = main?.second?.substringAfterLast('.', "")?.lowercase() ?: ""
    val pair = format == "idx"
    var valid = main != null && chosen.size == (if (pair) 2 else 1) && format in FORMATS
    if (pair) valid = valid && companion != null && companion.second.lowercase() == main!!.second.substringBeforeLast('.').lowercase() + ".sub"
    if (!valid) { promise.reject("subtitle_format", "Choose one SRT, VTT, ASS/SSA, SUP file, or a matching IDX + SUB pair."); return }
    val limit = if (format == "sup") 33554432 else 4194304
    val data = bounded(context, main!!.first, limit)
    val second = if (data != null && pair) bounded(context, companion!!.first, 33554432 - data.size) else null
    if (data == null || (pair && second == null)) { promise.reject("subtitle_file", "Read failed or size limit exceeded. Text/index: 4 MiB; binary total: 32 MiB."); return }
    val result = Arguments.createMap()
    result.putString("data", Base64.encodeToString(data, Base64.NO_WRAP))
    result.putString("format", format)
    result.putString("title", main.second.take(160))
    if (second != null) result.putString("companion", Base64.encodeToString(second, Base64.NO_WRAP))
    promise.resolve(result)
  }

  /** The file's bytes, or null when it is empty, unreadable or larger than [limit]. */
  private fun bounded(context: Context, uri: Uri, limit: Int): ByteArray? = try {
    context.contentResolver.openInputStream(uri)?.use { input ->
      val out = ByteArrayOutputStream()
      val chunk = ByteArray(65536)
      while (out.size() <= limit) {
        val read = input.read(chunk, 0, Math.min(chunk.size, limit + 1 - out.size()))
        if (read <= 0) break
        out.write(chunk, 0, read)
      }
      if (out.size() in 1..limit) out.toByteArray() else null
    }
  } catch (_: Exception) { null }

  private companion object {
    const val REQUEST = 0x5053
    val FORMATS = setOf("srt", "vtt", "ass", "ssa", "sup", "idx")
  }
}

/**
 * `NativeModules.PorticoDocumentFiles.pick(requestId, kind)`: one M3U/M3U8 or XML
 * file from the system picker as bounded, strictly decoded UTF-8 text. Phones and
 * tablets only; no path or lasting permission crosses the bridge.
 */
class PorticoDocumentFiles(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private class Request(val code: Int, val id: String, val kind: String, val promise: Promise) {
    @Volatile var cancelled = false
    @Volatile var reading = false
  }
  private var active: Request? = null
  @Volatile private var closed = false
  private var nextCode = 0x5044
  private val main = Handler(Looper.getMainLooper())

  private val listener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (closed) return
      val request = active ?: return
      if (request.code != requestCode || request.reading) return
      request.reading = true
      // Keep this exact request active through the bounded read; completion clears it.
      val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
      if (uri == null) { finish(request, null, "cancelled", "File selection cancelled."); return }
      pickerWork.execute { read(uri, request) }
    }
  }

  init { context.addActivityEventListener(listener) }

  override fun getName(): String = "PorticoDocumentFiles"

  override fun invalidate() {
    closed = true
    reactApplicationContext.removeActivityEventListener(listener)
    val request = active; active = null
    if (request != null) { request.cancelled = true; request.promise.resolve(null) }
    super.invalidate()
  }

  @ReactMethod
  fun pick(requestId: String, kind: String, promise: Promise) {
    if (closed) { promise.reject("bridge_closed", "bridge_closed"); return }
    if (TelevisionDisplay.isTelevision) { promise.reject("document_picker_unavailable", "Choose playlist files on a phone or tablet."); return }
    if (!requestId.matches(Regex("^[A-Za-z0-9_-]{1,128}$")) || (kind != "playlist" && kind != "guide")) { promise.reject("document_request_invalid", "Invalid document request."); return }
    if (active != null) { promise.reject("document_picker_busy", "Another file is being read."); return }
    if (nextCode > 0x7fff) { promise.reject("document_picker_exhausted", "Restart the app before choosing another file."); return }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) { promise.reject("document_picker_unavailable", "Open the app before choosing a file."); return }
    val request = Request(nextCode++, requestId, kind, promise); active = request
    try {
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), request.code)
    } catch (_: Exception) {
      active = null; request.cancelled = true
      promise.reject("document_picker_unavailable", "Open the app before choosing a file.")
    }
  }

  @ReactMethod
  fun cancel(requestId: String, promise: Promise) {
    if (closed) { promise.resolve(false); return }
    val request = active
    val current = request != null && request.id == requestId
    if (current) { request!!.cancelled = true; active = null; request.promise.resolve(null) }
    promise.resolve(current)
  }

  private fun finish(request: Request, result: com.facebook.react.bridge.WritableMap?, code: String?, message: String?) {
    if (closed || active !== request || request.cancelled) return
    active = null
    if (result != null) request.promise.resolve(result)
    else request.promise.reject(code ?: "document_file", message ?: "Read failed.")
  }

  private fun read(uri: Uri, request: Request) {
    if (closed || request.cancelled) return
    val context = reactApplicationContext
    val name = displayName(context, uri)
    val extension = name.substringAfterLast('.', "").lowercase()
    val allowed = if (request.kind == "playlist") setOf("m3u", "m3u8") else setOf("xml")
    if (extension !in allowed) { main.post { finish(request, null, "document_format", if (request.kind == "playlist") "Choose an M3U playlist file." else "Choose an XMLTV guide file.") }; return }
    val bytes = boundedDocument(context, uri, 16 * 1024 * 1024, request)
    if (bytes == null || closed || request.cancelled) { if (!closed && !request.cancelled) main.post { finish(request, null, "document_file", "Read failed, the file is empty, or it is larger than 16 MB.") }; return }
    val text = try {
      Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes)).toString()
    } catch (_: CharacterCodingException) {
      main.post { finish(request, null, "document_encoding", "The file is not valid UTF-8 text.") }; return
    }
    if (text.isEmpty()) { main.post { finish(request, null, "document_file", "Read failed, the file is empty, or it is larger than 16 MB.") }; return }
    val result = Arguments.createMap()
    result.putString("data", text)
    result.putString("title", name.take(160))
    result.putInt("bytes", bytes.size)
    main.post { finish(request, result, null, null) }
  }

  private fun boundedDocument(context: Context, uri: Uri, limit: Int, request: Request): ByteArray? = try {
    context.contentResolver.openInputStream(uri)?.use { input ->
      val out = ByteArrayOutputStream()
      val chunk = ByteArray(65536)
      while (!closed && !request.cancelled && out.size() <= limit) {
        val read = input.read(chunk, 0, Math.min(chunk.size, limit + 1 - out.size()))
        if (read <= 0) break
        out.write(chunk, 0, read)
      }
      if (!closed && !request.cancelled && out.size() in 1..limit) out.toByteArray() else null
    }
  } catch (_: Exception) { null }

}
