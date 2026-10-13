package tv.getportico.portico.native

import java.nio.file.Files
import java.io.File
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Standalone JVM regression for cancellation, replacement and independent file work. */
fun main() {
  val pool = Executors.newFixedThreadPool(2)
  val work = PorticoDownloadWork(pool)
  val held = CountDownLatch(1)
  val entered = CountDownLatch(1)
  val independent = CountDownLatch(1)
  val finished = CountDownLatch(1)
  val order = Collections.synchronizedList(ArrayList<String>())
  try {
    work.execute("film") {
      order.add("old-open")
      entered.countDown()
      check(held.await(5, TimeUnit.SECONDS))
      order.add("old-closed")
    }
    check(entered.await(5, TimeUnit.SECONDS))
    work.execute("film") { order.add("remove") }
    work.execute("film") {
      order.add("replacement")
      work.execute("film") { order.add("later"); finished.countDown() }
    }
    work.execute("another") { independent.countDown() }
    check(independent.await(5, TimeUnit.SECONDS))
    check(order.toList() == listOf("old-open"))
    held.countDown()
    check(finished.await(5, TimeUnit.SECONDS))
    check(order.toList() == listOf("old-open", "old-closed", "remove", "replacement", "later"))
  } finally { held.countDown(); pool.shutdownNow() }

  val directory = Files.createTempDirectory("portico-download-partial").toFile()
  try {
    val part = File(directory, "partial.part")
    val first = "a".repeat(64)
    val next = "b".repeat(64)
    check(prepareDownloadPartial(directory, first))
    part.writeText("first file prefix")
    check(prepareDownloadPartial(directory, first))
    check(part.readText() == "first file prefix")
    // A request for the next digest may be cancelled before it runs. The manifest's desired
    // digest is then already next; only this marker establishes whose bytes actually arrived.
    check(prepareDownloadPartial(directory, next))
    check(!part.exists())
    part.writeText("next file prefix")
    check(prepareDownloadPartial(directory, next))
    check(part.readText() == "next file prefix")
    File(directory, "partial.sha256").writeText("damaged")
    check(prepareDownloadPartial(directory, next))
    check(!part.exists())
  } finally { directory.deleteRecursively() }
}
