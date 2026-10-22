package tv.getportico.portico.native

import android.security.keystore.KeyPermanentlyInvalidatedException
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import java.security.UnrecoverableKeyException
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.*
import org.junit.Test

/** Real store inspection/decryption with a read-only JVM filesystem and existing-key seam. */
class PorticoRecordInspectionTest {
  private class JvmFiles : RecordInspectionFiles {
    val operations = Collections.synchronizedList(ArrayList<Pair<String, File>>())
    var beforeMetadata: (File) -> Unit = {}
    var beforeOpen: (File) -> Unit = {}
    var replacementInput: ((File) -> InputStream?)? = null

    override fun metadata(file: File): InspectionFileMetadata? {
      operations.add("metadata" to file)
      beforeMetadata(file)
      val attrs = try {
        Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
      } catch (_: NoSuchFileException) { return null }
      return InspectionFileMetadata(when {
        attrs.isRegularFile -> InspectionFileKind.REGULAR
        attrs.isDirectory -> InspectionFileKind.DIRECTORY
        else -> InspectionFileKind.OTHER
      }, attrs.size())
    }

    override fun open(file: File): InputStream {
      operations.add("open" to file)
      beforeOpen(file)
      return replacementInput?.invoke(file) ?: Files.newInputStream(file.toPath(), LinkOption.NOFOLLOW_LINKS)
    }
  }

  private class Fixture : AutoCloseable {
    val home = Files.createTempDirectory("portico-record-inspection").toFile()
    val root = File(home, "portico-records")
    val pending = File(home, "portico-records.key-loss-pending")
    val notice = File(home, "portico-records.key-loss-notice")
    val files = JvmFiles()
    val fixtureKey = SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES")
    var key: SecretKey? = fixtureKey
    var keyFailure: Exception? = null
    var keyReads = 0
    var beforeKey: () -> Unit = {}
    val store = PorticoRecordStore(root, files) {
      assertTrue(Thread.holdsLock(storeReference!!))
      keyReads++
      beforeKey()
      keyFailure?.let { throw it }
      key
    }
    private var storeReference: PorticoRecordStore? = null

    init { storeReference = store }

    fun path(service: String, account: String): File = File(File(root, service),
        PorticoRecordStore.hex(MessageDigest.getInstance("SHA-256").digest(account.toByteArray(Charsets.UTF_8))))
    val connection get() = path("queues", "network.selected.v1")
    val viewer get() = path("credentials", "portico:selected-viewer:v1")

    /** Fixture construction only: the test never substitutes a read/decode algorithm. */
    fun seal(service: String, account: String, plain: ByteArray, aad: String = service + "\u0000" + account): File {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, fixtureKey)
      cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
      val sealed = cipher.doFinal(plain)
      assertEquals(12, cipher.iv.size)
      return path(service, account).also {
        assertTrue(it.parentFile!!.isDirectory || it.parentFile!!.mkdirs())
        it.writeBytes(byteArrayOf(1) + cipher.iv + sealed)
      }
    }

    fun healthy() {
      seal("queues", "network.selected.v1", CONNECTION.toByteArray(Charsets.UTF_8))
      seal("credentials", "portico:selected-viewer:v1", VIEWER.toByteArray(Charsets.UTF_8))
      seal("profile-trust", "unrelated", byteArrayOf(1, 2, 3))
      notice.writeText("fixture notice must remain")
    }

    fun latch(): Boolean = latchField().getBoolean(store)
    fun latch(value: Boolean) { latchField().setBoolean(store, value) }
    private fun latchField() = PorticoRecordStore::class.java.getDeclaredField("keyChecked").apply { isAccessible = true }

    fun snapshot(): Map<String, String> = home.walkTopDown().associate { file ->
      file.relativeTo(home).path to when {
        Files.isSymbolicLink(file.toPath()) -> "link:" + Files.readSymbolicLink(file.toPath())
        file.isDirectory -> "directory"
        else -> "file:" + PorticoRecordStore.hex(file.readBytes())
      }
    }

    fun inspect(quarantine: () -> Boolean = { false }): SessionRecordInspection {
      val before = snapshot()
      val checked = latch()
      val result = store.inspectSessionRecords {
        assertTrue(Thread.holdsLock(store))
        quarantine()
      }
      assertEquals("Inspection changed fixture files", before, snapshot())
      assertEquals("Inspection changed the normal recovery latch", checked, latch())
      return result
    }

    override fun close() { home.deleteRecursively() }
  }

  private fun value(result: SessionRecordInspection): SessionRecordInspection.Value {
    assertTrue("Expected the whole pair", result is SessionRecordInspection.Value)
    return result as SessionRecordInspection.Value
  }

  private fun unreadable(result: SessionRecordInspection) = assertSame(SessionRecordInspection.Unreadable, result)

  private fun refuses(block: () -> Unit) {
    try { block(); fail("Expected a closed boundary") } catch (_: IllegalStateException) { }
  }

  @Test fun healthyPairReturnsExactRawTextAndLeavesNoticeUnconsumed() = Fixture().use { f ->
    f.healthy()
    f.files.beforeMetadata = { assertTrue(Thread.holdsLock(f.store)) }
    f.files.beforeOpen = { assertTrue(Thread.holdsLock(f.store)) }
    val pair = value(f.inspect())
    assertEquals(CONNECTION, pair.connection)
    assertEquals(VIEWER, pair.viewer)
    assertEquals(1, f.keyReads)
    assertEquals(setOf(f.connection, f.viewer), f.files.operations.filter { it.first == "open" }.map { it.second }.toSet())
  }

  @Test fun inspectionDoesNotDependOnOrSetNormalRecoveryLatch() = Fixture().use { f ->
    f.healthy()
    for (checked in listOf(false, true)) {
      f.latch(checked)
      assertEquals(CONNECTION, value(f.inspect()).connection)
      assertEquals(checked, f.latch())
    }
    assertEquals(2, f.keyReads)
  }

  @Test fun everyPendingProofBlocksBeforeKeyOrRecordAccessEvenAfterNormalLatch() = Fixture().use { f ->
    f.healthy()
    f.latch(true)
    for (proof in listOf("confirmed-key-loss-v2", "damaged", "")) {
      f.pending.writeText(proof)
      f.files.operations.clear()
      unreadable(f.inspect())
      assertEquals(0, f.keyReads)
      assertTrue(f.files.operations.none { it.first == "open" })
    }
    f.pending.delete()
    f.pending.mkdir()
    unreadable(f.inspect())
    assertEquals(0, f.keyReads)
  }

  @Test fun halfPublishedPendingProofAlsoBlocksWithoutFinishingIt() = Fixture().use { f ->
    f.healthy()
    File(f.pending.path + ".new").writeText("confirmed-key-loss-v2")
    unreadable(f.inspect())
    assertEquals(0, f.keyReads)
  }

  @Test fun lostKeyPreservesAllNamespacesAndDoesNotBecomeMissing() = Fixture().use { f ->
    f.healthy()
    f.key = null
    unreadable(f.inspect())
    assertEquals(1, f.keyReads)
    assertTrue(f.files.operations.none { it.first == "open" })
  }

  @Test fun absentStoreAndAbsentKeyCreateNothing() = Fixture().use { f ->
    assertFalse(f.root.exists())
    f.key = null
    unreadable(f.inspect())
    assertFalse(f.root.exists())
    assertTrue(f.home.listFiles()!!.isEmpty())
  }

  @Test fun unavailableAndUnrecoverableKeysNeverRecover() = Fixture().use { f ->
    f.healthy()
    for (failure in listOf(IllegalStateException("fixture unavailable"), UnrecoverableKeyException("fixture lost"))) {
      f.keyFailure = failure
      unreadable(f.inspect())
    }
    assertEquals(2, f.keyReads)
  }

  @Test fun permanentlyInvalidatedKeyLookupNeverResets() = Fixture().use { f ->
    f.healthy()
    f.keyFailure = KeyPermanentlyInvalidatedException()
    unreadable(f.inspect())
  }

  @Test fun unusableExistingKeyIsRejectedEvenWithoutRequestedRecords() = Fixture().use { f ->
    f.key = SecretKeySpec(ByteArray(3), "AES")
    unreadable(f.inspect())
    assertFalse(f.root.exists())
  }

  @Test fun confirmedMissingRecordsAreNullWithAHealthyExistingKey() = Fixture().use { f ->
    var pair = value(f.inspect())
    assertNull(pair.connection)
    assertNull(pair.viewer)
    assertFalse(f.root.exists())
    f.healthy()
    f.connection.delete()
    pair = value(f.inspect())
    assertNull(pair.connection)
    assertEquals(VIEWER, pair.viewer)
    f.seal("queues", "network.selected.v1", CONNECTION.toByteArray(Charsets.UTF_8))
    f.viewer.delete()
    pair = value(f.inspect())
    assertEquals(CONNECTION, pair.connection)
    assertNull(pair.viewer)
  }

  @Test fun uncertainPendingOrRecordMetadataNeverMeansMissing() = Fixture().use { f ->
    f.healthy()
    for (target in listOf(f.pending, f.root, f.connection, f.viewer)) {
      f.files.beforeMetadata = { if (it == target) throw IOException("fixture denied") }
      unreadable(f.inspect())
    }
  }

  @Test fun ioFailureInEitherRecordWithholdsTheWholePair() = Fixture().use { f ->
    f.healthy()
    for (target in listOf(f.connection, f.viewer)) {
      f.files.beforeOpen = { if (it == target) throw IOException("fixture unreadable") }
      unreadable(f.inspect())
    }
  }

  @Test fun corruptEnvelopeOrTagNeverReturnsPartialPlaintext() = Fixture().use { f ->
    f.healthy()
    val original = f.viewer.readBytes()
    for (bad in listOf(byteArrayOf(), byteArrayOf(1), original.copyOf().also { it[0] = 2 },
        original.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }, ByteArray((1 shl 20) + 1))) {
      f.viewer.writeBytes(bad)
      unreadable(f.inspect())
    }
  }

  @Test fun ciphertextBoundToAnotherAccountIsNotAccepted() = Fixture().use { f ->
    f.healthy()
    f.seal("queues", "network.selected.v1", CONNECTION.toByteArray(Charsets.UTF_8), "queues\u0000another-account")
    unreadable(f.inspect())
  }

  @Test fun realStreamBoundAndCapturedLengthAreBothEnforced() = Fixture().use { f ->
    f.healthy()
    for (bytes in listOf(ByteArray((1 shl 20) + 1), f.viewer.readBytes().dropLast(1).toByteArray())) {
      f.files.replacementInput = { if (it == f.viewer) ByteArrayInputStream(bytes) else null }
      unreadable(f.inspect())
    }
  }

  @Test fun streamReaderAcceptsExactBoundAndRefusesOverflowOrNoProgress() {
    assertArrayEquals(byteArrayOf(1, 2), readInspectionBytes(ByteArrayInputStream(byteArrayOf(1, 2)), 2))
    assertArrayEquals(byteArrayOf(), readInspectionBytes(ByteArrayInputStream(byteArrayOf()), 0))
    refuses { readInspectionBytes(ByteArrayInputStream(byteArrayOf(1, 2, 3)), 2) }
    refuses { readInspectionBytes(object : InputStream() {
      override fun read() = 0
      override fun read(bytes: ByteArray, offset: Int, length: Int) = 0
    }, 2) }
  }

  @Test fun quarantineHidesCorruptViewerWithoutInspectingItsPath() = Fixture().use { f ->
    f.healthy()
    f.viewer.writeText("fixture damaged")
    val pair = value(f.inspect { true })
    assertEquals(CONNECTION, pair.connection)
    assertNull(pair.viewer)
    assertTrue(f.files.operations.none { it.second == f.viewer || it.second == f.viewer.parentFile })
    unreadable(f.inspect { false })
  }

  @Test fun quarantineDoesNotHideAConnectionFailure() = Fixture().use { f ->
    f.healthy()
    f.connection.writeText("fixture damaged")
    unreadable(f.inspect { true })
  }

  @Test fun unavailableQuarantineWithholdsBothRecordsBeforeKeyLookup() = Fixture().use { f ->
    f.healthy()
    unreadable(f.inspect { throw IOException("fixture flags unavailable") })
    assertEquals(0, f.keyReads)
    assertTrue(f.files.operations.isEmpty())
  }

  @Test fun rootNamespaceAndRecordSymlinksFailClosed() = Fixture().use { f ->
    f.healthy()
    val moved = File(f.home, "held")
    for (target in listOf(f.viewer, f.viewer.parentFile!!, f.root)) {
      assertTrue(target.renameTo(moved))
      Files.createSymbolicLink(target.toPath(), moved.toPath())
      unreadable(f.inspect())
      Files.delete(target.toPath())
      assertTrue(moved.renameTo(target))
    }
  }

  @Test fun directoryInPlaceOfRecordIsUnreadable() = Fixture().use { f ->
    f.healthy()
    f.viewer.delete()
    f.viewer.mkdir()
    unreadable(f.inspect())
  }

  @Test fun oneMonitorCoversKeyLookupAndBothReads() {
    for (phase in listOf("key", "connection", "viewer")) Fixture().use { f ->
      f.healthy()
      val entered = CountDownLatch(1)
      val release = CountDownLatch(1)
      val competitorStarted = CountDownLatch(1)
      val competitorEntered = CountDownLatch(1)
      val executor = Executors.newFixedThreadPool(2)
      val hold = {
        assertTrue(Thread.holdsLock(f.store))
        entered.countDown()
        check(release.await(5, TimeUnit.SECONDS))
      }
      if (phase == "key") f.beforeKey = hold
      else f.files.beforeOpen = { if (it == if (phase == "connection") f.connection else f.viewer) hold() }
      try {
        val inspected = executor.submit<SessionRecordInspection> { f.inspect() }
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        val competitor = executor.submit {
          competitorStarted.countDown()
          f.store.transaction { competitorEntered.countDown() }
        }
        assertTrue(competitorStarted.await(5, TimeUnit.SECONDS))
        assertFalse(competitorEntered.await(100, TimeUnit.MILLISECONDS))
        release.countDown()
        assertEquals(CONNECTION, value(inspected.get(5, TimeUnit.SECONDS)).connection)
        competitor.get(5, TimeUnit.SECONDS)
        assertEquals(0L, competitorEntered.count)
      } finally { release.countDown(); executor.shutdownNow() }
    }
  }

  @Test fun preferenceGuardNeverCreatesMissingDirectoryOrAssumesAnAbsentFileIsHealthy() = Fixture().use { f ->
    val directory = File(f.home, "shared_prefs")
    refuses { requireInspectionPreferences(f.home, f.files) }
    assertFalse(directory.exists())
    directory.mkdir()
    refuses { requireInspectionPreferences(f.home, f.files) }
    File(directory, "portico.xml").writeText("fixture readable bytes; no test XML parser")
    requireInspectionPreferences(f.home, f.files)
    File(directory, "portico.xml.bak").writeText("fixture backup")
    refuses { requireInspectionPreferences(f.home, f.files) }
  }

  @Test fun preferenceGuardRejectsUncertainMetadataAndReadability() = Fixture().use { f ->
    val directory = File(f.home, "shared_prefs").also { it.mkdir() }
    val file = File(directory, "portico.xml").also { it.writeText("fixture") }
    f.files.beforeMetadata = { if (it.name.endsWith(".bak")) throw IOException("fixture metadata") }
    try { requireInspectionPreferences(f.home, f.files); fail() } catch (_: IOException) { }
    f.files.beforeMetadata = {}
    f.files.beforeOpen = { if (it == file) throw IOException("fixture denied") }
    try { requireInspectionPreferences(f.home, f.files); fail() } catch (_: IOException) { }
  }

  @Test fun preferenceGuardRejectsSymlinkDirectoriesAndFiles() = Fixture().use { f ->
    val directory = File(f.home, "shared_prefs").also { it.mkdir() }
    val file = File(directory, "portico.xml").also { it.writeText("fixture") }
    val moved = File(f.home, "held-preferences")
    for (target in listOf(file, directory)) {
      assertTrue(target.renameTo(moved))
      Files.createSymbolicLink(target.toPath(), moved.toPath())
      refuses { requireInspectionPreferences(f.home, f.files) }
      Files.delete(target.toPath())
      assertTrue(moved.renameTo(target))
    }
  }

  @Test fun coldOrUnknownQuarantineNeverInvokesAFalseDefault() {
    var reads = 0
    refuses { inspectionQuarantine(false) { reads++; false } }
    assertEquals(0, reads)
    for (unknown in listOf(null, "false", 0)) refuses { inspectionQuarantine(true) { unknown } }
    assertTrue(inspectionQuarantine(true) { true })
    assertFalse(inspectionQuarantine(true) { false })
  }

  companion object {
    private const val CONNECTION = "{ \"fixture\": \"connection\", \"refreshToken\": \"fixture-only\" }"
    private const val VIEWER = "{\"fixture\":\"viewer \\u263a\"}"
  }
}
