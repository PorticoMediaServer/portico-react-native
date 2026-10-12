package tv.getportico.portico.native

import android.content.Context
import android.os.Build
import android.system.Os
import android.system.OsConstants
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.KeyPermanentlyInvalidatedException
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** What a read found. Missing and unreadable are different answers and stay different in JavaScript. */
internal sealed interface RecordRead {
  data object Missing : RecordRead
  data object Unreadable : RecordRead
  class Value(val bytes: ByteArray) : RecordRead
}

/**
 * The app's secure records: the counterpart of the Apple modules' Keychain items
 * (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
 *
 * One file per record under the app's no-backup directory, sealed with AES-256-GCM by a key that
 * never leaves the Android Keystore. The record's service and account are bound into the seal, so
 * a file moved to another name does not open. A write lands by atomic rename and is read back
 * before it is reported as saved. Ambiguous read failures never repair a record; a confirmed
 * missing or permanently invalidated store key resets all records together.
 *
 * Every operation holds the store's lock, and [transaction] holds it across a read-modify-write,
 * the guarantee the Apple runtime gives by serialising on its class.
 */
internal class PorticoRecordStore private constructor(private val root: File) {

  private val resetPending = File(root.parentFile, root.name + ".key-loss-pending")
  private var keyChecked = false
  private val resetNotice = File(root.parentFile, root.name + ".key-loss-notice")

  /** Launch preparation also consumes the one-time signed-out notice after a verified reset. */
  fun prepareSecureRecords(): Boolean = synchronized(this) {
    recoverLostKey()
    verifyKey(checkNotNull(key(create = true)))
    if (!resetNotice.exists()) return false
    check(resetNotice.delete())
    true
  }

  fun <T> transaction(block: () -> T): T = synchronized(this) { block() }

  fun read(service: String, account: String): RecordRead = synchronized(this) {
    val file = file(service, account)
    try {
      recoverLostKey()
      if (!file.exists()) return RecordRead.Missing
      if (file.length() > MAX_FILE_BYTES) return RecordRead.Unreadable
      val sealed = file.readBytes()
      if (sealed.size < 1 + IV_BYTES + TAG_BYTES || sealed[0] != FORMAT) return RecordRead.Unreadable
      val key = key(create = false) ?: return RecordRead.Unreadable
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BYTES * 8, sealed, 1, IV_BYTES))
      cipher.updateAAD(binding(service, account))
      RecordRead.Value(cipher.doFinal(sealed, 1 + IV_BYTES, sealed.size - 1 - IV_BYTES))
    } catch (_: Exception) {
      RecordRead.Unreadable
    }
  }

  /**
   * Whether an unreadable record is damaged for good: its file is there and was read in full, but
   * is not a sealed record at all (too large, too short, or not this format). That is decided
   * from the file alone, so it is the same answer every time and waiting cannot change it. A key
   * that is missing, or that will not open the record, is not decided here: the Keystore can fail
   * for a while, so that stays "cannot be read now". Nothing is repaired or removed.
   */
  fun damaged(service: String, account: String): Boolean = synchronized(this) {
    try {
      val file = file(service, account)
      if (!file.isFile) return false
      if (file.length() > MAX_FILE_BYTES) return true
      val sealed = file.readBytes()
      sealed.size < 1 + IV_BYTES + TAG_BYTES || sealed[0] != FORMAT
    } catch (_: Exception) {
      false
    }
  }

  /** Saves [bytes], or removes the record when [bytes] is null. True only when a read confirms it. */
  fun write(service: String, account: String, bytes: ByteArray?): Boolean = synchronized(this) {
    val file = file(service, account)
    try {
      recoverLostKey()
      if (bytes == null) {
        if (file.exists() && !file.delete()) return false
        return read(service, account) is RecordRead.Missing
      }
      val key = key(create = true) ?: return false
      val cipher = Cipher.getInstance(TRANSFORMATION)
      // The Keystore chooses the nonce; a caller-supplied one is refused for this key.
      cipher.init(Cipher.ENCRYPT_MODE, key)
      cipher.updateAAD(binding(service, account))
      val sealed = cipher.doFinal(bytes)
      val iv = cipher.iv
      if (iv.size != IV_BYTES) return false
      val directory = file.parentFile ?: return false
      if (!directory.isDirectory && !directory.mkdirs()) return false
      val pending = File(directory, file.name + ".new")
      FileOutputStream(pending).use { out ->
        out.write(byteArrayOf(FORMAT))
        out.write(iv)
        out.write(sealed)
        out.flush()
        out.fd.sync()
      }
      if (!pending.renameTo(file)) {
        pending.delete()
        return false
      }
      val confirmed = read(service, account)
      confirmed is RecordRead.Value && confirmed.bytes.contentEquals(bytes)
    } catch (_: Exception) {
      false
    }
  }

  private fun file(service: String, account: String): File =
      File(File(root, service), hex(MessageDigest.getInstance("SHA-256").digest(account.toByteArray(Charsets.UTF_8))))

  private fun binding(service: String, account: String): ByteArray =
      (service + "\u0000" + account).toByteArray(Charsets.UTF_8)

  /** Keystore1 hides service errors as absence. Never erase records on that ambiguous answer. */
  private fun recoverLostKey() {
    if (resetPending.exists()) { resetLostRecords(); keyChecked = true; return }
    if (keyChecked) return
    try {
      val existing = key(create = false)
      if (existing == null && hasRecords()) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) throw IllegalStateException("The record key cannot be verified.")
        resetLostRecords()
      } else if (existing != null) verifyKey(existing)
      keyChecked = true
    } catch (e: KeyPermanentlyInvalidatedException) {
      resetLostRecords()
      keyChecked = true
    }
  }

  /** Complete both operations so the launch check cannot retain a Keymaster operation slot. */
  private fun verifyKey(key: SecretKey) {
    val plain = byteArrayOf(1)
    val encrypt = Cipher.getInstance(TRANSFORMATION)
    encrypt.init(Cipher.ENCRYPT_MODE, key)
    val sealed = encrypt.doFinal(plain)
    val decrypt = Cipher.getInstance(TRANSFORMATION)
    decrypt.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BYTES * 8, encrypt.iv))
    check(decrypt.doFinal(sealed).contentEquals(plain))
  }

  private fun hasRecords(): Boolean = root.exists() && root.walkTopDown().any { it.isFile }

  /** A durable, versioned marker authorizes only completion of an already-proven reset. */
  private fun resetLostRecords() {
    if (resetPending.exists()) check(resetPending.readText() == RESET_PROOF)
    else mark(resetPending)
    syncDirectory()
    check(!root.exists() || root.deleteRecursively())
    syncDirectory()
    val keystore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    keystore.deleteEntry(KEY_ALIAS)
    verifyKey(checkNotNull(key(create = true)))
    mark(resetNotice)
    check(resetPending.delete())
    syncDirectory()
  }

  private fun mark(file: File) {
    val pending = File(file.parentFile, file.name + ".new")
    FileOutputStream(pending).use { out -> out.write(RESET_PROOF.toByteArray(Charsets.UTF_8)); out.flush(); out.fd.sync() }
    check(pending.renameTo(file))
    syncDirectory()
  }

  private fun syncDirectory() {
    val descriptor = Os.open(checkNotNull(root.parentFile).path, OsConstants.O_RDONLY, 0)
    try { Os.fsync(descriptor) } finally { Os.close(descriptor) }
  }

  private fun key(create: Boolean): SecretKey? {
    val keystore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (keystore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    if (keystore.containsAlias(KEY_ALIAS)) throw IllegalStateException("The record key is unavailable.")
    if (!create) return null
    // A key disappearing after launch must not be replaced behind retained ciphertext.
    check(!hasRecords())
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
        KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
    return generator.generateKey()
  }

  companion object {
    private const val RESET_PROOF = "confirmed-key-loss-v2"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "tv.getportico.portico.records.v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val FORMAT: Byte = 1
    private const val IV_BYTES = 12
    private const val TAG_BYTES = 16
    /** The largest record any caller may save is 256 KB; anything far beyond it is not ours. */
    private const val MAX_FILE_BYTES = 1L shl 20

    /** The services the Apple modules keep as separate Keychain namespaces. */
    const val QUEUES = "queues"
    const val CREDENTIALS = "credentials"
    const val PLAYBACK = "playback"
    const val PROFILE_TRUST = "profile-trust"
    const val NETWORK = "network"

    @Volatile private var shared: PorticoRecordStore? = null

    fun get(context: Context): PorticoRecordStore =
        shared ?: synchronized(this) {
          shared ?: PorticoRecordStore(File(context.applicationContext.noBackupFilesDir, "portico-records")).also { shared = it }
        }

    fun hex(bytes: ByteArray): String {
      val out = StringBuilder(bytes.size * 2)
      for (b in bytes) {
        out.append(Character.forDigit((b.toInt() shr 4) and 0xf, 16))
        out.append(Character.forDigit(b.toInt() and 0xf, 16))
      }
      return out.toString()
    }
  }
}
