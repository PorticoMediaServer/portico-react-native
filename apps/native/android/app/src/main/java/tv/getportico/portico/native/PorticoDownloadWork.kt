package tv.getportico.portico.native

import java.util.concurrent.Executor
import java.io.File
import java.io.FileOutputStream

/** File work for one download stays in order; unrelated downloads may run together. */
internal class PorticoDownloadWork(private val executor: Executor) {
  private val pending = HashMap<String, ArrayDeque<() -> Unit>>()

  fun execute(id: String, work: () -> Unit) {
    synchronized(pending) {
      val queue = pending.getOrPut(id) { ArrayDeque() }
      queue.addLast(work)
      if (queue.size == 1) dispatch(id, work)
    }
  }

  private fun dispatch(id: String, work: () -> Unit) {
    executor.execute {
      try { work() } finally {
        synchronized(pending) {
          val queue = checkNotNull(pending[id])
          queue.removeFirst()
          if (queue.isEmpty()) pending.remove(id) else dispatch(id, queue.first())
        }
      }
    }
  }
}

/** The bytes' identity stays beside them, independent of queued requests in the manifest. */
internal fun prepareDownloadPartial(directory: File, digest: String): Boolean = try {
  val part = File(directory, "partial.part")
  val identity = File(directory, "partial.sha256")
  val held = if (identity.isFile && identity.length() == 64L) identity.readText() else ""
  if (held != digest && part.exists() && !part.delete()) false
  else {
    val pending = File(directory, "partial.sha256.tmp")
    FileOutputStream(pending).use { it.write(digest.toByteArray(Charsets.US_ASCII)); it.fd.sync() }
    pending.renameTo(identity)
  }
} catch (_: Exception) { false }
