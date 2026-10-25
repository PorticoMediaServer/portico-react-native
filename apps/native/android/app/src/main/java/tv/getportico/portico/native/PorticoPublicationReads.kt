package tv.getportico.portico.native

import android.system.Os
import android.system.OsConstants
import android.util.Base64
import com.facebook.react.bridge.Promise
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.Inflater

/** Private download handles only: no filesystem URL, server URL or guest fetch.
 * Each extent comes from the receipt-bound descriptor; delivery is <=48KiB.
 * One member (<=32MiB) is expanded at a time, with cancellation between chunks. */
internal class PorticoPublicationReads {
  private class Ticket(val current: () -> Boolean) {
    val closed = AtomicBoolean(false)
    val busy = AtomicBoolean(false)
    var channel: FileChannel? = null
    var member: ByteArray? = null
  }
  private val tickets = ConcurrentHashMap<String, Ticket>()
  private val retired = HashSet<String>()
  private val io = Executors.newSingleThreadExecutor()
  @Volatile private var closed = false
  private fun requireLive(t: Ticket) {check(!closed && !t.closed.get())}
  private fun release(t: Ticket) {t.member = null; runCatching {t.channel?.close()}; t.channel = null}
  @Synchronized fun close(handle: String) {if (retired.size >= 4096) closed = true; retired.add(handle); tickets.remove(handle)?.let {t -> t.closed.set(true); io.execute {release(t)}}}
  fun invalidate() {closed = true; tickets.keys.toList().forEach(::close)}
  private fun run(handle: String, promise: Promise, work: (Ticket) -> Any?) {
    val t = tickets[handle]
    if (t == null || closed || t.closed.get() || !t.busy.compareAndSet(false, true)) {promise.reject("reading_unavailable", "reading_unavailable"); return}
    PorticoDownloadCenter.post {
      if (!t.current() || t.closed.get()) {t.busy.set(false); promise.reject("reading_unavailable", "reading_unavailable"); return@post}
      io.execute {
        try {
          requireLive(t); val result = work(t); requireLive(t)
          PorticoDownloadCenter.post {t.busy.set(false); if (tickets[handle] === t && !t.closed.get() && !closed && t.current()) promise.resolve(result) else promise.reject("reading_retired", "reading_retired")}
        } catch (_: Exception) {t.busy.set(false); close(handle); promise.reject("reading_unavailable", "reading_unavailable")}
      }
    }
  }
  @Synchronized fun open(handle: String, file: File, bytes: Long, digest: String, current: () -> Boolean, promise: Promise) {
    if (closed || retired.contains(handle) || tickets.size >= 2 || !handle.matches(Regex("[A-Za-z0-9_-]{8,128}")) || !digest.matches(Regex("[0-9a-f]{64}"))) {promise.reject("reading_unavailable", "reading_unavailable"); return}
    val t = Ticket(current)
    if (tickets.putIfAbsent(handle, t) != null) {promise.reject("reading_unavailable", "reading_unavailable"); return}
    run(handle, promise) {
      val fd = Os.open(file.path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW, 0)
      val stat = Os.fstat(fd)
      if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size != bytes || bytes < 1 || bytes > 2147483648L) {Os.close(fd); error("reading_unavailable")}
      val channel = FileInputStream(fd).channel; t.channel = channel
      val hash = MessageDigest.getInstance("SHA-256"); val buffer = ByteBuffer.allocate(65536)
      var seen = 0L
      while (true) {requireLive(t); buffer.clear(); val n = channel.read(buffer); if (n < 0) break; if (n == 0) error("reading_unavailable"); hash.update(buffer.array(), 0, n); seen += n}
      check(seen == bytes && hash.digest().joinToString("") {"%02x".format(it)} == digest)
      bytes.toDouble()
    }
  }
  private fun read(t: Ticket, offset: Long, count: Int): ByteArray {
    requireLive(t); val channel = t.channel ?: error("reading_unavailable")
    check(offset >= 0 && count >= 0 && offset <= channel.size() - count)
    val out = ByteArray(count); val buffer = ByteBuffer.wrap(out); var position = offset
    while (buffer.hasRemaining()) {requireLive(t); val n = channel.read(buffer, position); check(n > 0); position += n}
    return out
  }
  fun range(handle: String, offset: Double, length: Double, promise: Promise) = run(handle, promise) {t ->
    check(offset.isFinite() && offset == offset.toLong().toDouble() && length.isFinite() && length == length.toInt().toDouble() && length >= 0 && length <= 49152)
    Base64.encodeToString(read(t, offset.toLong(), length.toInt()), Base64.NO_WRAP)
  }
  fun member(handle: String, offset: Double, compressed: Double, size: Double, method: Double, digest: String, promise: Promise) = run(handle, promise) {t ->
    check(offset.isFinite() && offset == offset.toLong().toDouble() && compressed.isFinite() && compressed == compressed.toLong().toDouble() && compressed >= 0 && compressed <= 2147483648.0 && size.isFinite() && size == size.toInt().toDouble() && size >= 0 && size <= 33554432 && (method == 0.0 || method == 8.0) && digest.matches(Regex("[0-9a-f]{64}")))
    t.member = null
    val out = ByteArray(size.toInt()); var written = 0; var consumed = 0L
    val inflater = if (method == 8.0) Inflater(true) else null
    try {
      while (consumed < compressed.toLong()) {
        requireLive(t); val input = read(t, offset.toLong() + consumed, minOf(65536L, compressed.toLong() - consumed).toInt()); consumed += input.size
        if (inflater == null) {check(written <= out.size - input.size); input.copyInto(out, written); written += input.size}
        else {
          inflater.setInput(input)
          while (!inflater.needsInput() && !inflater.finished()) {
            requireLive(t)
            if (written == out.size) {val extra = ByteArray(1); check(inflater.inflate(extra) == 0 && inflater.finished()); break}
            val n = inflater.inflate(out, written, minOf(65536, out.size - written)); check(n > 0 || inflater.finished()); written += n
          }
          if (inflater.finished()) {check(consumed == compressed.toLong() && inflater.remaining == 0); break}
        }
      }
      check(written == out.size && (inflater == null || inflater.finished()))
      check(MessageDigest.getInstance("SHA-256").digest(out).joinToString("") {"%02x".format(it)} == digest)
      requireLive(t); t.member = out; out.size
    } finally {inflater?.end()}
  }
  fun memberRange(handle: String, offset: Double, length: Double, promise: Promise) = run(handle, promise) {t ->
    val data = t.member ?: error("reading_unavailable")
    check(offset.isFinite() && offset == offset.toInt().toDouble() && length.isFinite() && length == length.toInt().toDouble() && offset >= 0 && length >= 0 && length <= 49152 && offset <= data.size - length)
    Base64.encodeToString(data.copyOfRange(offset.toInt(), offset.toInt() + length.toInt()), Base64.NO_WRAP)
  }
}
