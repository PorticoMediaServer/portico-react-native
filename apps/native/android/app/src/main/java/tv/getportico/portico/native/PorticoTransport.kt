package tv.getportico.portico.native

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer

/**
 * The bounded JSON control transport behind `PorticoRuntime`'s `queueRequest`, `networkRequest`
 * and `profileRequest`. These requests carry credentials and device proofs, so the transport
 * never follows a redirect, keeps no cookies and no cache, validates TLS against the system
 * trust store, and never accumulates an unbounded response.
 *
 * One shared client, so connections and TLS sessions are reused; at most 12 requests in flight
 * and 64 waiting in order, the same admission the Apple transport applies. The bounds are per
 * request: 1 MB bodies (8 MB for API reads) and 15 seconds.
 */
internal object PorticoTransport {
  private const val MAX_ACTIVE = 12
  private const val MAX_WAITING = 64
  const val DEFAULT_LIMIT = 1L shl 20
  const val READ_LIMIT = 8L shl 20

  private class Entry(val identifier: String, val owner: Any, val limit: Long, var promise: Promise?) {
    var call: Call? = null
    var completed = false
  }

  private val entries = HashMap<String, Entry>()

  private val client: OkHttpClient by lazy {
    OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .cache(null)
        .callTimeout(15, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .dispatcher(Dispatcher().apply { maxRequests = MAX_ACTIVE; maxRequestsPerHost = MAX_ACTIVE })
        .build()
  }

  /** A request URL the transport will carry: http or https, no credentials in it, no fragment. */
  fun target(url: String?): HttpUrl? {
    if (url == null || url.length > 8192) return null
    val parsed = url.toHttpUrlOrNull() ?: return null
    if (parsed.username.isNotEmpty() || parsed.password.isNotEmpty() || parsed.fragment != null) return null
    return parsed
  }

  /** Builds the wire request, or null when a header or the method cannot be sent as given. */
  fun request(url: HttpUrl, method: String, headers: ReadableMap?, body: ByteArray?): Request? = try {
    val builder = Request.Builder().url(url)
    if (headers != null) {
      val keys = headers.keySetIterator()
      while (keys.hasNextKey()) {
        val name = keys.nextKey()
        if (headers.getType(name) == ReadableType.String) builder.header(name, headers.getString(name) ?: "")
      }
    }
    // The caller's own Content-Type header describes the body; none is invented here.
    val payload = when (method) {
      "GET", "HEAD" -> null
      "DELETE" -> body?.toRequestBody(null)
      else -> (body ?: ByteArray(0)).toRequestBody(null)
    }
    builder.method(method, payload).build()
  } catch (_: IllegalArgumentException) {
    null
  }

  /** Admits a request: start it, queue it, or refuse it when 76 are already pending. */
  fun submit(owner: Any, identifier: String, request: Request, limit: Long, domain: String, busy: String, promise: Promise) {
    val entry = Entry(identifier, owner, limit, promise)
    val call: Call
    synchronized(entries) {
      if (entries.containsKey(identifier) || entries.size >= MAX_ACTIVE + MAX_WAITING) {
        promise.reject(domain, busy)
        return
      }
      entries[identifier] = entry
      call = client.newCall(request)
      entry.call = call
    }
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) = finish(entry, "The queue request could not be confirmed.", null)

      override fun onResponse(call: Call, response: Response) {
        response.use { read(entry, it) }
      }
    })
  }

  private fun read(entry: Entry, response: Response) {
    // A redirect is never followed: the next request would carry the caller's credentials to an
    // address the caller did not name.
    if (response.code in intArrayOf(301, 302, 303, 307, 308) && response.header("Location") != null) {
      finish(entry, "Queue control redirects are not allowed.", null)
      return
    }
    val bytes: ByteArray
    try {
      val body = response.body
      val buffer = Buffer()
      if (body != null) {
        if (body.contentLength() > entry.limit) {
          finish(entry, "Queue response exceeded its limit.", null)
          return
        }
        val source = body.source()
        while (source.read(buffer, 16384) != -1L) {
          if (buffer.size > entry.limit) {
            finish(entry, "Queue response exceeded its limit.", null)
            return
          }
        }
      }
      bytes = buffer.readByteArray()
    } catch (_: IOException) {
      finish(entry, "The queue request could not be confirmed.", null)
      return
    }
    val text = try {
      Charsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(bytes))
          .toString()
    } catch (_: CharacterCodingException) {
      finish(entry, "Invalid queue response.", null)
      return
    }
    val headers = Arguments.createMap()
    for (name in response.headers.names()) headers.putString(name, response.headers.values(name).joinToString(", "))
    val result = Arguments.createMap()
    result.putInt("status", response.code)
    result.putMap("headers", headers)
    result.putString("body", text)
    finish(entry, null, result)
  }

  private fun finish(entry: Entry, failure: String?, result: Any?) {
    val promise: Promise?
    synchronized(entry) {
      if (entry.completed) return
      entry.completed = true
      promise = entry.promise
      entry.promise = null
    }
    synchronized(entries) { if (entries[entry.identifier] === entry) entries.remove(entry.identifier) }
    if (failure != null) {
      entry.call?.cancel()
      promise?.reject("queue_transport", failure)
    } else {
      promise?.resolve(result)
    }
  }

  fun cancel(identifier: String) {
    val entry = synchronized(entries) { entries[identifier] } ?: return
    finish(entry, "Queue request cancelled.", null)
  }

  /**
   * A JavaScript reload abandons its promises; release their slots at once instead of leaving
   * them to time out while the new JavaScript's first requests wait behind them.
   */
  fun cancelOwnedBy(owner: Any) {
    val owned = synchronized(entries) { entries.values.filter { it.owner === owner } }
    for (entry in owned) finish(entry, "The app reloaded.", null)
  }
}
