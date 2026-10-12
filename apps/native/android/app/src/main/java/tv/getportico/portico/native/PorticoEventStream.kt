package tv.getportico.portico.native

import android.util.Base64
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Response

/** Pull-based, bounded SSE transport. Route selection and identity proof belong to the caller. */
internal object PorticoEventStream {
  private class Entry(val owner: Any, val call: Call) {
    val startedAt = SystemClock.elapsedRealtime()
    var response: Response? = null
    var reading = false
    var received = 0L
  }

  private val entries = HashMap<String, Entry>()
  private val readers = Executors.newFixedThreadPool(4)
  private val client by lazy {
    OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .cache(null).callTimeout(2100, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
        .build()
  }

  fun open(owner: Any, id: String?, url: String?, headers: ReadableMap?, promise: Promise) {
    val target = PorticoTransport.target(url)
    val path = target?.encodedPath ?: ""
    val allowed = path == "/v1/notifications/events" || GROUP_EVENTS.matches(path)
    val request = if (target != null && allowed && id != null && id.isNotEmpty() && id.length <= 128)
      PorticoTransport.request(target, "GET", headers, null) else null
    if (request == null || id == null) { promise.reject("event_local", "Invalid event request."); return }
    val entry = Entry(owner, client.newCall(request))
    synchronized(entries) {
      if (entries.size >= 4 || entries.containsKey(id)) { promise.reject("event_local", "Too many event streams."); return }
      entries[id] = entry
    }
    entry.call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        cancel(id)
        // No response has begun, so a time-out here is a route that does not answer: route
        // evidence, as it is for an ordinary request. Only an open stream that goes quiet is idle.
        promise.reject("event_transport", "The event connection could not be opened.")
      }
      override fun onResponse(call: Call, response: Response) {
        if (response.code in 300..399) {
          response.close(); cancel(id)
          promise.reject("event_redirect", "Event redirects are not allowed.")
          return
        }
        val result = Arguments.createMap()
        result.putInt("status", response.code)
        val fields = Arguments.createMap()
        for (name in response.headers.names()) fields.putString(name, response.headers.values(name).joinToString(", "))
        result.putMap("headers", fields)
        synchronized(entries) {
          if (entries[id] !== entry) {
            response.close()
            promise.reject("event_cancelled", "The event stream was cancelled.")
            return
          }
          entry.response = response
        }
        promise.resolve(result)
      }
    })
  }

  fun read(id: String?, promise: Promise) {
    val entry: Entry
    synchronized(entries) {
      val found = entries[id]
      if (found == null || found.response == null || found.reading) {
        promise.reject("event_local", "The event stream is unavailable."); return
      }
      entry = found
      entry.reading = true
    }
    readers.execute {
      try {
        val bytes = ByteArray(16384)
        val count = entry.response?.body?.byteStream()?.read(bytes) ?: -1
        val ended = synchronized(entries) {
          if (entries[id] !== entry) throw IOException("Event stream cancelled.")
          if (count > 0) entry.received += count
          entry.reading = false
          count < 0 || entry.received > 1048576
        }
        val result = Arguments.createMap()
        result.putBoolean("done", ended)
        if (!ended && count > 0) result.putString("data", Base64.encodeToString(bytes.copyOf(count), Base64.NO_WRAP))
        if (ended) cancel(id)
        promise.resolve(result)
      } catch (e: Exception) {
        val expired = SystemClock.elapsedRealtime() - entry.startedAt >= 2_100_000
        val cancelled = synchronized(entries) { entries[id] !== entry }
        cancel(id)
        if (expired) promise.resolve(Arguments.createMap().apply { putBoolean("done", true) })
        else {
          val code = when {
            cancelled -> "event_cancelled"
            e is InterruptedIOException -> "event_timeout"
            e is IOException -> "event_transport"
            else -> "event_local"
          }
          promise.reject(code, "The event connection was interrupted.")
        }
      }
    }
  }

  fun cancel(id: String?) {
    val entry = synchronized(entries) { entries.remove(id) } ?: return
    entry.call.cancel()
    entry.response?.close()
  }

  fun cancelOwnedBy(owner: Any) {
    val ids = synchronized(entries) { entries.filterValues { it.owner === owner }.keys.toList() }
    for (id in ids) cancel(id)
  }

  private val GROUP_EVENTS = Regex("^/v1/groups/[A-Za-z0-9_-]{1,128}/events$")
}
