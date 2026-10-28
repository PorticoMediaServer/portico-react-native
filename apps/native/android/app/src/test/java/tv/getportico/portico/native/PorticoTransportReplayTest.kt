package tv.getportico.portico.native

import java.io.IOException
import java.io.File
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

/** Real production request bodies and client selection; no replay-policy substitute. */
class PorticoTransportReplayTest {
  private fun request(server: MockWebServer, method: String, bytes: ByteArray?): Request =
      checkNotNull(PorticoTransport.request(server.url("/mutation"), method, null, bytes))

  @Test fun onlySubtitleUploadsGetTheLongTimeouts() {
    val url = "https://server.test/v1/items/item_1/subtitles".toHttpUrl()
    val file = File.createTempFile("portico-subtitle-", ".srt").canonicalFile
    try {
      file.writeText("1\n00:00:00,000 --> 00:00:01,000\nSubtitle\n")
      for (method in listOf("POST", "PUT")) {
        val ordinary = checkNotNull(PorticoTransport.request(url, method, null, ByteArray(0)))
        val base = PorticoTransport.clientFor(ordinary)
        val upload = checkNotNull(PorticoTransport.uploadRequest(url, method, null, "{}", listOf(file to "subtitle.srt")))
        val client = PorticoTransport.clientFor(upload)
        assertEquals(110_000, client.callTimeoutMillis)
        assertEquals(60_000, client.readTimeoutMillis)
        assertEquals(60_000, client.writeTimeoutMillis)
        assertEquals(15_000, client.connectTimeoutMillis)
        assertSame(base.connectionPool, client.connectionPool)
        assertSame(base.dispatcher, client.dispatcher)
        assertSame(base.sslSocketFactory, client.sslSocketFactory)
        assertSame(base.hostnameVerifier, client.hostnameVerifier)
        assertFalse(client.retryOnConnectionFailure)
        assertTrue(checkNotNull(upload.body).isOneShot())
      }
      // Same endpoints and methods with ordinary bodies must retain their original policy.
      for (method in listOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")) {
        val ordinary = checkNotNull(PorticoTransport.request(url, method, null, null))
        for (client in listOf(PorticoTransport.clientFor(ordinary), PorticoTransport.clientFor(ordinary, streaming = true))) {
          assertEquals(15_000, client.callTimeoutMillis)
          assertEquals(15_000, client.connectTimeoutMillis)
          assertEquals(15_000, client.readTimeoutMillis)
          assertEquals(15_000, client.writeTimeoutMillis)
        }
      }
    } finally { file.delete() }
  }

  @Test fun everyMutationBodyIsOneShotIncludingAnEmptyBody() {
    MockWebServer().use { server ->
      server.start()
      for (method in listOf("POST", "PUT", "DELETE")) {
        for (bytes in listOf(null, "disposable request".toByteArray())) {
          val request = request(server, method, bytes)
          val body = checkNotNull(request.body)
          val expected = bytes ?: ByteArray(0)
          assertTrue("$method must not replay its body", body.isOneShot())
          assertEquals(expected.size.toLong(), body.contentLength())
          val buffer = Buffer()
          body.writeTo(buffer)
          assertArrayEquals(expected, buffer.readByteArray())
          assertFalse(PorticoTransport.clientFor(request).retryOnConnectionFailure)
          assertFalse(PorticoTransport.clientFor(request, streaming = true).retryOnConnectionFailure)
        }
      }
      for (method in listOf("GET", "HEAD")) {
        val request = request(server, method, null)
        assertNull(request.body)
        assertTrue(PorticoTransport.clientFor(request).retryOnConnectionFailure)
      }
    }
  }

  @Test fun aRetryable503DoesNotReplayAMutation() {
    for (method in listOf("POST", "PUT", "DELETE")) {
      for (bytes in listOf(null, "disposable request".toByteArray())) {
        MockWebServer().use { server ->
          server.enqueue(MockResponse().setResponseCode(503).setHeader("Retry-After", "0"))
          // This answer makes an erroneous follow-up complete, so the count/status fails promptly.
          server.enqueue(MockResponse().setResponseCode(200))
          server.start()
          val request = request(server, method, bytes)
          PorticoTransport.clientFor(request).newCall(request).execute().use { response ->
            assertEquals("$method must expose the first response", 503, response.code)
          }
          val received = checkNotNull(server.takeRequest(1, TimeUnit.SECONDS))
          assertEquals(method, received.method)
          assertArrayEquals(bytes ?: ByteArray(0), received.body.readByteArray())
          assertEquals("$method was sent more than once", 1, server.requestCount)
        }
      }
    }
  }

  @Test fun aLostResponseDoesNotReplayAMutation() {
    for (method in listOf("POST", "PUT", "DELETE")) {
      MockWebServer().use { server ->
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setResponseCode(200))
        server.start()
        val request = request(server, method, "disposable request".toByteArray())
        try {
          PorticoTransport.clientFor(request).newCall(request).execute().use {
            fail("$method unexpectedly received a replay response")
          }
        } catch (_: IOException) {
          // The write may have arrived; the owner receives an indeterminate outcome.
        }
        assertEquals(method, checkNotNull(server.takeRequest(1, TimeUnit.SECONDS)).method)
        assertEquals("$method was sent more than once after losing its response", 1, server.requestCount)
      }
    }
  }
}
