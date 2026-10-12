package tv.getportico.portico.native

import android.content.Context
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
  private val resetNotice = File(root.parentFile, root.name + ".key-loss-notice")

  /** Launch preparation also consumes the one-time signed-out notice after a verified reset. */
  fun prepareSecureRecords(): Boolean = synchronized(this) {
    recoverLostKey()
    check(key(create = true) != null)
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

  /** Only definitive key loss qualifies. I/O, lock state and damaged ciphertext do not. */
  private fun recoverLostKey() {
    if (resetPending.exists()) { resetLostRecords(); return }
    try {
      val existing = key(create = false)
      if (existing == null) {
        if (root.exists() && root.walkTopDown().any { it.isFile }) resetLostRecords()
      } else {
        // Decrypt initialization checks permanent invalidation without reading or changing a record.
        Cipher.getInstance(TRANSFORMATION).init(Cipher.DECRYPT_MODE, existing, GCMParameterSpec(TAG_BYTES * 8, ByteArray(IV_BYTES)))
      }
    } catch (e: KeyPermanentlyInvalidatedException) {
      resetLostRecords()
    }
  }

  /** A pending marker fences every operation until the whole lost store is removed. */
  private fun resetLostRecords() {
    mark(resetPending)
    check(!root.exists() || root.deleteRecursively())
    val keystore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    keystore.deleteEntry(KEY_ALIAS)
    mark(resetNotice)
    check(resetPending.delete())
  }

  private fun mark(file: File) {
    FileOutputStream(file).use { out -> out.write(1); out.flush(); out.fd.sync() }
  }

  private fun key(create: Boolean): SecretKey? {
    val keystore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (keystore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    if (keystore.containsAlias(KEY_ALIAS)) throw IllegalStateException("The record key is unavailable.")
    if (!create) return null
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
