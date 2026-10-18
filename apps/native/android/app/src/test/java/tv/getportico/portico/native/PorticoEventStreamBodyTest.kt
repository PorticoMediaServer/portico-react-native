package tv.getportico.portico.native

import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Test

/**
 * An event stream ended while its reader is blocked inside the body (a server switch cancelling
 * the device's feed): a real OkHttp call over a loopback socket that sends one chunk of a chunked
 * event stream and then holds the connection open.
 *
 * Closing the response from the cancelling thread drains the chunked body inside the source the
 * reader is blocked in; okio then throws IllegalStateException("Unbalanced enter/exit") on the
 * cancelling thread, the crash seen on phone and TV. Ending must not throw, the read must fail as
 * an ordinary IOException, and the response must be closed once the read has returned.
 */
class PorticoEventStreamBodyTest {
  @Test
  fun endingWhileAReadIsBlockedInsideTheBodyNeverClosesUnderTheRead() {
    ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { server ->
      val release = CountDownLatch(1)
      val peerClosed = CountDownLatch(1)
      val peer = thread(isDaemon = true) { server.accept().use { socket -> serveOneChunk(socket, release, peerClosed) } }
      val client = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
      val call = client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/v1/events").build())
      val body = PorticoEventStreamBody(call)
      try {
        check(body.attach(call.execute()))
        check(body.claim())
        val first = ByteArray(64)
        check(body.read(first) == 5) { "the first chunk arrives" }
        check(body.claim()) { "the next read is claimed before it runs" }
        val failure = AtomicReference<Throwable?>()
        val reader = thread { try { body.read(ByteArray(64)); failure.set(AssertionError("the read returned")) } catch (e: Throwable) { failure.set(e) } }
        check(waitUntil { reader.stackTrace.any { it.className.contains("Socket") && it.methodName.contains("read", ignoreCase = true) } }) { "the reader is blocked in the socket read" }
        check(!body.isClosed)

        body.end()

        reader.join(5000)
        check(!reader.isAlive) { "cancelling the call interrupts the read" }
        val error = failure.get()
        check(error is IOException) { "the read fails as a transport error, not $error" }
        check(body.isClosed) { "the read closed the response as it returned" }
        check(!body.claim()) { "an ended stream takes no further read" }
        check(peerClosed.await(5, TimeUnit.SECONDS)) { "the connection is gone" }
      } finally {
        release.countDown(); call.cancel(); peer.join(5000); client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
      }
    }
  }

  @Test
  fun endingWithNoReadUnderWayClosesAtOnceAndOnlyOnce() {
    ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { server ->
      val release = CountDownLatch(1)
      val peerClosed = CountDownLatch(1)
      val peer = thread(isDaemon = true) { server.accept().use { socket -> serveOneChunk(socket, release, peerClosed) } }
      val client = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
      val call = client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/v1/events").build())
      val body = PorticoEventStreamBody(call)
      try {
        val response = call.execute()
        check(body.attach(response))
        body.end()
        check(body.isClosed)
        body.end()
        check(!body.claim())
        check(!body.attach(response)) { "a response arriving after the end is the caller's to close" }
        check(peerClosed.await(5, TimeUnit.SECONDS))
      } finally {
        release.countDown(); peer.join(5000); client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
      }
    }
  }

  /** Answers one request with a chunked event stream's first chunk, then holds until released or closed by the client. */
  private fun serveOneChunk(socket: Socket, release: CountDownLatch, closed: CountDownLatch) {
    val input = socket.getInputStream().bufferedReader()
    while (true) { val line = input.readLine() ?: return; if (line.isEmpty()) break }
    val out = socket.getOutputStream()
    out.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n: hi\n\r\n".toByteArray())
    out.flush()
    // The client closing its side is seen as the end of the input.
    thread(isDaemon = true) { try { while (socket.getInputStream().read() >= 0) Unit } catch (_: IOException) {} ; closed.countDown() }
    release.await(30, TimeUnit.SECONDS)
  }

  private fun waitUntil(condition: () -> Boolean): Boolean {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    while (System.nanoTime() < deadline) { if (condition()) return true; Thread.sleep(10) }
    return false
  }
}
