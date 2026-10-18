package tv.getportico.portico.native

import java.io.IOException
import okhttp3.Call
import okhttp3.Response

/**
 * One event stream's response, shared by the reader pool and whichever thread ends the stream
 * (the JS module thread's cancel, a server switch or sign-out).
 *
 * okio's sources are single-threaded. Closing a chunked body drains what is left of it, which is a
 * second read inside the same source: while a reader is blocked there, the two threads enter the
 * socket's AsyncTimeout together and okio throws "Unbalanced enter/exit" on the closing thread,
 * which crashed the app on the module thread when a server switch cancelled the device's feed.
 *
 * So ending never touches a body a read is inside. It cancels the call, OkHttp's thread-safe way
 * to interrupt a read in progress (the socket closes and the read fails), and the response is
 * closed exactly once: at once when no read is under way, otherwise by that read as it returns.
 */
internal class PorticoEventStreamBody(private val call: Call) {
  private val lock = Any()
  private var response: Response? = null
  private var reading = false
  private var ended = false
  private var closed = false

  /** The response arrived: kept, or false once the stream has ended (the caller closes it; no read can hold it). */
  fun attach(response: Response): Boolean = synchronized(lock) {
    if (ended) false else { this.response = response; true }
  }

  /** Claims the one read allowed at a time: false before the response, while another read runs, or once ended. */
  fun claim(): Boolean = synchronized(lock) {
    if (ended || reading || response == null) false else { reading = true; true }
  }

  /**
   * The claimed read: what has arrived, or -1 at the end of the body. Throws when the stream ends
   * during it. Either way the claim is released, and a stream ended meanwhile is closed here.
   */
  fun read(into: ByteArray): Int {
    val source = synchronized(lock) {
      check(reading) { "Read without a claim." }
      if (ended) null else response?.body?.byteStream()
    }
    try {
      return source?.read(into) ?: throw IOException("Event stream cancelled.")
    } finally {
      val close = synchronized(lock) { reading = false; if (ended) take() else null }
      close?.close()
    }
  }

  /** Ends the stream, from any thread, at most once in effect; never closes under a read in progress. */
  fun end() {
    val close = synchronized(lock) { ended = true; take() }
    call.cancel()
    close?.close()
  }

  /** Whether the response has been closed (or there was none to close when the stream ended). */
  val isClosed: Boolean get() = synchronized(lock) { closed }

  /** The response to close now, once, and only with no read inside it. Called with the lock held. */
  private fun take(): Response? {
    if (reading || closed) return null
    closed = true
    return response
  }
}
