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
import java.security.UnrecoverableKeyException
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
 * The key that seals the records is gone, or the system can no longer recover it, while records
 * it sealed remain. On Android 12 and later a missing key is a definite answer and the store
 * resets itself. Before that the same answer can also come from a Keystore service that is failing
 * for a moment, so nothing is removed on its strength: launch preparation reports this state and
 * the person decides whether to start again ([PorticoRecordStore.resetAfterConfirmation]).
 */
internal class RecordKeyLostException : IllegalStateException("The record key is lost.")

/**
 * The app's secure records: the counterpart of the Apple modules' Keychain items
 * (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
 *
 * One file per record under the app's no-backup directory, sealed with AES-256-GCM by a key that
 * never leaves the Android Keystore. The record's service and account are bound into the seal, so
 * a file moved to another name does not open. A write lands by atomic rename and is read back
 * before it is reported as saved. Ambiguous read failures never repair a record; a confirmed
 * missing or permanently invalidated store key resets all records together. Where the system
 * cannot say for certain that the key is gone, the reset waits for the person to ask for it.
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

  /**
   * The person asked to start again because this device cannot read its saved records. The key is
   * looked at once more first: if it answers now, nothing is removed and this returns false.
   * If it is still lost, the whole store is reset through the same fenced steps as an automatic
   * recovery (marker, records, key, notice) and this returns true. Any other failure throws and
   * removes nothing.
   */
  fun resetAfterConfirmation(): Boolean = synchronized(this) {
    if (resetPending.exists()) { resetLostRecords(); keyChecked = true; return true }
    if (!keyLost()) { keyChecked = true; return false }
    resetLostRecords()
    keyChecked = true
    true
  }

  /**
   * Whether records remain that the store's key can no longer open: the key is absent, the system
   * cannot recover it, or it has been invalidated for good. A key that opens and seals is not
   * lost. Anything else (a Keystore that will not answer) throws, and decides nothing.
   */
  private fun keyLost(): Boolean {
    val existing = try { key(create = false) } catch (_: UnrecoverableKeyException) { return hasRecords() }
    if (existing == null) return hasRecords()
    return try { verifyKey(existing); false } catch (_: KeyPermanentlyInvalidatedException) { true }
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
      // A key entry the system cannot recover will not come back by waiting, but that answer is
      // not certain either: it is reported, and only the person's confirmation resets the store.
      val existing = try { key(create = false) } catch (e: UnrecoverableKeyException) { if (hasRecords()) throw RecordKeyLostException() else throw e }
      if (existing == null && hasRecords()) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) throw RecordKeyLostException()
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
