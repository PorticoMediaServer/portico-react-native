package tv.getportico.portico.native

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import javax.crypto.SecretKey

/** No generated toString of either plaintext credential. Missing members are null, never errors. */
internal sealed interface SessionRecordInspection {
  data object Unreadable : SessionRecordInspection
  class Value(val connection: String?, val viewer: String?) : SessionRecordInspection
}

internal enum class InspectionFileKind { REGULAR, DIRECTORY, OTHER }
internal class InspectionFileMetadata(val kind: InspectionFileKind, val bytes: Long)

/** Only read capabilities. Tests inject I/O/key failures at the real store's inspection boundary. */
internal interface RecordInspectionFiles {
  /** Null means confirmed ENOENT; every uncertain result throws. Does not follow the final link. */
  fun metadata(file: File): InspectionFileMetadata?
  /** Opens an existing regular file for reading only, without following its final link. */
  fun open(file: File): InputStream
}

internal class RecordInspectionAccess(val files: RecordInspectionFiles, val existingKey: () -> SecretKey?)

/** Os.lstat/open are available on API21, including the app's API24 and Fire API25 minimums. */
internal object AndroidRecordInspectionFiles : RecordInspectionFiles {
  override fun metadata(file: File): InspectionFileMetadata? {
    val stat = try { Os.lstat(file.path) } catch (error: ErrnoException) {
      if (error.errno == OsConstants.ENOENT) return null
      throw error
    }
    val kind = when {
      OsConstants.S_ISREG(stat.st_mode) -> InspectionFileKind.REGULAR
      OsConstants.S_ISDIR(stat.st_mode) -> InspectionFileKind.DIRECTORY
      else -> InspectionFileKind.OTHER
    }
    return InspectionFileMetadata(kind, stat.st_size)
  }

  override fun open(file: File): InputStream {
    val descriptor = Os.open(file.path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW or
        OsConstants.O_CLOEXEC or OsConstants.O_NONBLOCK, 0)
    try {
      check(OsConstants.S_ISREG(Os.fstat(descriptor).st_mode))
      return FileInputStream(descriptor)
    } catch (error: Exception) {
      Os.close(descriptor)
      throw error
    }
  }
}

/** The stream itself is bounded, even if a file grows after its metadata was checked. */
internal fun readInspectionBytes(input: InputStream, maximum: Int): ByteArray {
  require(maximum >= 0 && maximum < Int.MAX_VALUE)
  val out = ByteArrayOutputStream(minOf(maximum, 8192))
  val buffer = ByteArray(8192)
  while (true) {
    val count = input.read(buffer, 0, minOf(buffer.size, maximum - out.size() + 1))
    if (count < 0) return out.toByteArray()
    check(count > 0 && count <= maximum - out.size())
    out.write(buffer, 0, count)
  }
}

/**
 * Metadata/readability preconditions only, never an XML parser or a quarantine fallback.
 * Construct [dataDirectory] from ApplicationInfo.dataDir; Context directory getters may mkdir.
 * These checks require cooperative writers. They do not make SharedPreferences loading atomic
 * with an external process, nor attest its load health. The runtime refuses a cold flag delegate.
 */
internal fun requireInspectionPreferences(dataDirectory: File, files: RecordInspectionFiles = AndroidRecordInspectionFiles) {
  check(files.metadata(dataDirectory)?.kind == InspectionFileKind.DIRECTORY)
  val directory = File(dataDirectory, "shared_prefs")
  check(files.metadata(directory)?.kind == InspectionFileKind.DIRECTORY)
  check(files.metadata(File(directory, "portico.xml.bak")) == null)
  val file = File(directory, "portico.xml")
  check(files.metadata(file)?.kind == InspectionFileKind.REGULAR)
  files.open(file).use { /* Confirm readability without parsing or replacing platform authority. */ }
}

/** Public preferences have no load-health result. Never initiate a cold load or infer false. */
internal fun inspectionQuarantine(warm: Boolean, readFlag: () -> Any?): Boolean {
  check(warm)
  val value = readFlag()
  check(value is Boolean)
  return value
}
