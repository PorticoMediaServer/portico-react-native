package tv.getportico.portico.native

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.*
import java.util.concurrent.atomic.AtomicBoolean

/** Only a bounded Markdown export; no caller-controlled path or generic writer. */
class PorticoHighlightsSave(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private class Operation(val id: String, val code: Int, val bytes: ByteArray, val promise: Promise) {
    val cancelled = AtomicBoolean(false)
    val settled = AtomicBoolean(false)
    fun finish(value: String) { if (settled.compareAndSet(false, true)) promise.resolve(value) }
    fun fail() { if (settled.compareAndSet(false, true)) promise.reject("highlights_save_failed", "Could not save highlights") }
  }
  @Volatile private var operation: Operation? = null
  private var nextCode = 46203
  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, code: Int, result: Int, data: Intent?) {
      val original = operation ?: return
      if (code != original.code) return
      if (result != Activity.RESULT_OK || data?.data == null) { cancel(original); return }
      val uri: Uri = data.data ?: return
      if (uri.scheme != "content") { original.fail(); release(original); return }
      Thread {
        try {
          if (original.cancelled.get() || operation !== original) return@Thread
          context.contentResolver.openOutputStream(uri, "w")?.use { output ->
            var offset = 0
            while (offset < original.bytes.size) {
              if (original.cancelled.get() || operation !== original) throw java.io.InterruptedIOException()
              val count = minOf(16384, original.bytes.size - offset)
              output.write(original.bytes, offset, count); offset += count
            }
            output.flush()
          } ?: throw java.io.IOException()
          if (!original.cancelled.get() && operation === original) original.finish("saved")
        } catch (_: Exception) { if (!original.cancelled.get()) original.fail() }
        finally { release(original) }
      }.start()
    }
  }
  init { context.addActivityEventListener(listener) }
  override fun getName() = "PorticoHighlightsSave"
  private fun release(value: Operation) { if (operation === value) operation = null; value.bytes.fill(0) }
  private fun cancel(value: Operation) { value.cancelled.set(true); value.bytes.fill(0); value.finish("cancelled"); if (operation === value) operation = null }
  @ReactMethod fun saveHighlights(id: String, name: String, markdown: String, promise: Promise) {
    if (!Regex("^[A-Za-z0-9_-]{32}$").matches(id) || !Regex("^[A-Za-z0-9 -]{1,64}-highlights\\.md$").matches(name) || markdown.length > 4194304 || !markdown.startsWith("# Highlights\n")) { promise.reject("invalid_highlights", "Invalid highlights export"); return }
    val bytes = markdown.toByteArray(Charsets.UTF_8)
    if (bytes.size > 4194304) { bytes.fill(0); promise.reject("invalid_highlights", "Invalid highlights export"); return }
    val activity = currentActivity
    if (activity == null || operation != null || nextCode > 65534) { bytes.fill(0); promise.reject("highlights_busy", "Save unavailable"); return }
    val original = Operation(id, nextCode++, bytes, promise); operation = original
    activity.runOnUiThread {
      if (operation !== original || original.cancelled.get()) { bytes.fill(0); return@runOnUiThread }
      try { activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/markdown").putExtra(Intent.EXTRA_TITLE, name), original.code) }
      catch (_: Exception) { original.fail(); release(original) }
    }
  }
  @ReactMethod fun cancelHighlights(id: String) {
    val original = operation ?: return
    if (original.id != id) return
    cancel(original)
    currentActivity?.runOnUiThread { currentActivity?.finishActivity(original.code) }
    // A selected provider document belongs to the user: never delete it on retirement.
  }
  override fun invalidate() { operation?.let { cancel(it) }; context.removeActivityEventListener(listener); super.invalidate() }
}
