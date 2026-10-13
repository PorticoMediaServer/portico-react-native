package tv.getportico.portico.native

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.UnknownServiceException
import java.util.concurrent.Executors
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * The mpv engine's only way to the network: the Android counterpart of
 * `Native/PorticoMpvRelay.swift`.
 *
 * mpv (FFmpeg) has its own HTTP client. In the libmpv this app ships, that client cannot see the
 * system's trusted certificates, so it would either skip TLS validation or need a certificate
 * file of its own. Instead mpv is only ever given an address on this device
 * (`http://127.0.0.1:<port>/...`), and this relay fetches the real resource with the app's own
 * HTTP client: the same TLS validation, the same network security rules and the same
 * certificates the rest of the app trusts.
 *
 * The relay serves one playback at a time. It forwards a request only when its path lies under
 * the media grant of the source it was bound to (`/v1/media/<grant>/...`). That grant is the
 * capability the server issued for this playback, so another app on the device that does not
 * already hold it gets nothing here. Redirects are refused, as they are for the app's other
 * media fetches. Only GET and HEAD are served.
 */
internal class PorticoMpvRelay {
  /** What the last failed upstream request said, for the engine's error classification. */
  class Failure(
      /** The upstream HTTP status (400..599), or 0 when there was no answer. */
      val httpStatus: Int,
      /** With no answer: a failure waiting will not change (transport security, cleartext refused). */
      val permanent: Boolean,
      /** `SystemClock.elapsedRealtime()` when it happened. */
      val at: Long,
  )

  private class Exchange(val socket: Socket) {
    @Volatile var call: Call? = null
  }

  private val main = Handler(Looper.getMainLooper())
  private val control = Executors.newSingleThreadExecutor { task -> Thread(task, "portico-mpv-relay").apply { isDaemon = true } }
  private val workers = ThreadPoolExecutor(0, MAXIMUM_EXCHANGES, 30, TimeUnit.SECONDS, SynchronousQueue()) { task -> Thread(task, "portico-mpv-relay-io").apply { isDaemon = true } }
  private val lock = Any()

  // Guarded by `lock`.
  private var server: ServerSocket? = null
  private var port = 0
  private var origin: String? = null
  private var originScheme = ""
  private var originHost = ""
  private var originPort = -1
  private var prefixes: List<String> = emptyList()
  private val exchanges = HashSet<Exchange>()

  /** The most recent upstream failure, or null. Safe from any thread. */
  @Volatile var lastFailure: Failure? = null
    private set

  fun clearFailure() { lastFailure = null }

  private fun record(status: Int, permanent: Boolean) {
    lastFailure = Failure(status, permanent, SystemClock.elapsedRealtime())
  }

  /**
   * Binds the relay to [source] and answers with the address mpv should open instead, or null
   * when the relay could not listen. [completion] runs on the main thread.
   */
  fun bind(source: Uri, completion: (String?) -> Unit) {
    control.execute {
      val scheme = source.scheme?.lowercase()
      val host = source.host
      if ((scheme != "http" && scheme != "https") || host.isNullOrEmpty() || source.userInfo != null) {
        main.post { completion(null) }
        return@execute
      }
      val listening = synchronized(lock) {
        originScheme = scheme
        originHost = host.lowercase()
        originPort = source.port
        // An IPv6 literal keeps its brackets in an address.
        val name = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        origin = "$scheme://$name" + (if (source.port >= 0) ":${source.port}" else "")
        prefixes = prefixesFor(source.path ?: "/")
        cancelAllLocked()
        ensureListeningLocked()
      }
      val local = if (listening == 0) null else local(source, listening)
      main.post { completion(local) }
    }
  }

  /**
   * The loopback address for another resource of the bound playback (an external subtitle
   * file), or null when it is outside the bound scope or the relay is not listening.
   */
  fun localUrl(remote: Uri): String? = synchronized(lock) {
    if (origin == null || port == 0) return null
    if (remote.scheme?.lowercase() != originScheme || remote.host?.lowercase() != originHost || remote.port != originPort) return null
    if (remote.userInfo != null || remote.encodedFragment != null || !allowedLocked(remote.encodedPath ?: "")) return null
    local(remote, port)
  }

  /** Ends every transfer and forgets the bound source. The listener stays for the next playback. */
  fun unbind() {
    control.execute {
      synchronized(lock) {
        origin = null
        prefixes = emptyList()
        cancelAllLocked()
      }
    }
  }

  /** Stops listening and ends every transfer. */
  fun stop() {
    control.execute {
      synchronized(lock) {
        origin = null
        prefixes = emptyList()
        cancelAllLocked()
        try { server?.close() } catch (_: IOException) {}
        server = null
        port = 0
      }
    }
  }

  // --- scope ------------------------------------------------------------------------------

  private fun prefixesFor(path: String): List<String> {
    val parts = path.split('/').filter { it.isNotEmpty() }
    if (parts.size >= 3 && parts[0] == "v1" && parts[1] == "media") return listOf("/v1/media/" + parts[2])
    // Anything else is scoped to the folder the source is in.
    val slash = path.lastIndexOf('/')
    if (slash >= 0) return listOf(path.substring(0, slash).ifEmpty { "/" })
    return listOf("/")
  }

  private fun local(remote: Uri, port: Int): String {
    val query = remote.encodedQuery
    return "http://127.0.0.1:$port" + (remote.encodedPath ?: "/") + (if (query != null) "?$query" else "")
  }

  private fun allowedLocked(path: String): Boolean {
    if (!path.startsWith("/") || path.contains('\\')) return false
    val lowered = path.lowercase()
    if (lowered.contains("%2e") || lowered.contains("%2f") || lowered.contains("%5c")) return false
    if (path.split('/').any { it == ".." || it == "." }) return false
    for (prefix in prefixes) {
      if (prefix == "/") return true
      if (path == prefix || path.startsWith("$prefix/")) return true
    }
    return false
  }

  // --- listener ---------------------------------------------------------------------------

  /** The port being listened on, or 0. */
  private fun ensureListeningLocked(): Int {
    server?.let { if (!it.isClosed && port != 0) return port }
    val made = try { ServerSocket(0, 16, InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))) } catch (_: IOException) { return 0 }
    server = made
    port = made.localPort
    Thread({ acceptLoop(made) }, "portico-mpv-relay-accept").apply { isDaemon = true }.start()
    return port
  }

  private fun acceptLoop(listener: ServerSocket) {
    while (true) {
      val socket = try { listener.accept() } catch (_: IOException) { break }
      val exchange = Exchange(socket)
      synchronized(lock) { exchanges.add(exchange) }
      try {
        workers.execute {
          try { serve(exchange) } catch (_: Exception) {} finally { end(exchange) }
        }
      } catch (_: Exception) {
        // Too many transfers at once: this one is refused.
        end(exchange)
      }
    }
    synchronized(lock) {
      if (server === listener) { server = null; port = 0 }
    }
  }

  private fun end(exchange: Exchange) {
    synchronized(lock) { exchanges.remove(exchange) }
    exchange.call?.cancel()
    try { exchange.socket.close() } catch (_: IOException) {}
  }

  private fun cancelAllLocked() {
    for (exchange in exchanges.toList()) {
      exchange.call?.cancel()
      try { exchange.socket.close() } catch (_: IOException) {}
    }
    exchanges.clear()
  }

  // --- one request ------------------------------------------------------------------------

  /** A short answer the relay makes itself (a refusal or an upstream failure). */
  private fun reply(out: OutputStream, status: Int) {
    out.write("HTTP/1.1 $status Relay\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
    out.flush()
  }

  /** The request head, without its final blank line; null when it is too long or the peer left. */
  private fun readHead(socket: Socket): String? {
    // Nothing after the head is read from this connection, so reading ahead loses nothing.
    val input = socket.getInputStream().buffered(4096)
    val head = ByteArrayOutputStream(1024)
    var matched = 0
    while (head.size() <= MAXIMUM_HEAD) {
      val byte = input.read()
      if (byte < 0) return null
      head.write(byte)
      matched = when {
        byte == '\r'.code && (matched == 0 || matched == 2) -> matched + 1
        byte == '\n'.code && (matched == 1 || matched == 3) -> matched + 1
        byte == '\r'.code -> 1
        else -> 0
      }
      if (matched == 4) return String(head.toByteArray(), 0, head.size() - 4, Charsets.UTF_8)
    }
    return null
  }

  private fun serve(exchange: Exchange) {
    val socket = exchange.socket
    socket.soTimeout = 15_000
    val out = socket.getOutputStream()
    val head = readHead(socket) ?: return
    val lines = head.split("\r\n")
    val request = lines.first().split(' ').filter { it.isNotEmpty() }
    if (request.size != 3 || (request[0] != "GET" && request[0] != "HEAD")) { reply(out, 405); return }
    val target = request[1]
    val base: String?
    val permitted: Boolean
    val path = target.substringBefore('?')
    synchronized(lock) {
      base = origin
      permitted = allowedLocked(path)
    }
    if (!target.startsWith("/") || target.toByteArray(Charsets.UTF_8).size > 8192 || base == null || !permitted) { reply(out, 404); return }
    var range: String? = null
    for (line in lines.drop(1)) {
      val colon = line.indexOf(':')
      if (colon <= 0) continue
      if (line.substring(0, colon).trim().lowercase() == "range") {
        val value = line.substring(colon + 1).trim()
        if (value.length <= 128 && RANGE.matches(value)) range = value
      }
    }
    val wire = try {
      Request.Builder().url(base + target).method(request[0], null)
          .header("Accept-Encoding", "identity").header("Accept", "*/*")
          .apply { if (range != null) header("Range", range) }
          .build()
    } catch (_: IllegalArgumentException) {
      reply(out, 404)
      return
    }
    val call = client.newCall(wire)
    exchange.call = call
    val response = try {
      call.execute()
    } catch (error: IOException) {
      if (!call.isCanceled()) {
        record(0, permanent(error))
        try { reply(out, 502) } catch (_: IOException) {}
      }
      return
    }
    response.use { answer ->
      val status = answer.code
      if (status in 300..399) {
        // A redirect is never followed, and mpv must not follow it on its own either.
        record(502, false)
        reply(out, 502)
        return
      }
      if (status >= 400) record(status, false)
      val text = StringBuilder("HTTP/1.1 $status Relay\r\n")
      for (name in FORWARDED) {
        val value = answer.header(name) ?: continue
        if (value.toByteArray(Charsets.UTF_8).size <= 1024 && !value.contains('\r') && !value.contains('\n')) text.append(name).append(": ").append(value).append("\r\n")
      }
      text.append("Connection: close\r\n\r\n")
      out.write(text.toString().toByteArray(Charsets.ISO_8859_1))
      out.flush()
      if (request[0] == "HEAD") return
      val source = answer.body?.byteStream() ?: return
      val buffer = ByteArray(64 * 1024)
      // mpv stops reading when its cache is full; the write then waits, and the upstream
      // transfer waits with it.
      socket.soTimeout = 0
      while (true) {
        val count = try {
          source.read(buffer)
        } catch (error: IOException) {
          // The body was cut short: closing here lets mpv ask again from where it stopped.
          if (!call.isCanceled()) record(0, permanent(error))
          return
        }
        if (count < 0) break
        out.write(buffer, 0, count)
      }
      out.flush()
    }
  }

  companion object {
    private const val MAXIMUM_EXCHANGES = 12
    private const val MAXIMUM_HEAD = 16 * 1024
    private val RANGE = Regex("^bytes=[0-9]*-[0-9]*$")
    private val FORWARDED = listOf("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified")

    /** Media addresses are capability URLs: no cookies, no cache, no redirects. */
    private val client: OkHttpClient by lazy {
      OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).cache(null)
          .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    }

    /** A failure that waiting will not change: the connection is refused on security grounds. */
    private fun permanent(error: IOException): Boolean =
        generateSequence<Throwable>(error) { it.cause }.take(4).any { it is SSLException || it is UnknownServiceException || it is java.security.cert.CertificateException }
  }
}
