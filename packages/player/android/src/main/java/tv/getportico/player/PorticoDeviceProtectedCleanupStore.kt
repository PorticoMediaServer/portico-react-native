package tv.getportico.player

import android.content.Context
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import org.json.JSONObject

internal class PorticoDeviceProtectedCleanupStore(context: Context) {
  private val preferences = try {
    context.createDeviceProtectedStorageContext()
      .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
  } catch (_: Throwable) {
    throw StorageException(
      "PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE",
      "Android device-protected cleanup storage is unavailable.",
    )
  }

  fun read(): Map<String, Any> {
    val payload = preferences.getString(PAYLOAD_KEY, null)
    val digest = preferences.getString(DIGEST_KEY, null)
    if (payload == null && digest == null) {
      return availableState(quarantined = false)
    }
    if (payload.isNullOrEmpty() || digest.isNullOrEmpty() || sha256(payload) != digest) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT",
        "Android device-protected cleanup storage is corrupt.",
      )
    }
    return parsePayload(payload)
  }

  fun begin(generation: String): Map<String, Any> {
    val safeGeneration = validateGeneration(generation)
    val current = read()
    val currentGeneration = current["generation"] as? String
    val quarantined = current["quarantined"] == true
    if (quarantined && currentGeneration != null && currentGeneration != safeGeneration) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_GENERATION_CONFLICT",
        "Android cleanup generation is already quarantined.",
      )
    }
    return writePayload(
      quarantined = true,
      generation = safeGeneration,
      completedGeneration = current["completedGeneration"] as? String,
    )
  }

  fun markCompleted(generation: String): Map<String, Any> {
    val safeGeneration = validateGeneration(generation)
    val current = read()
    if (current["quarantined"] != true || current["generation"] != safeGeneration) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_GENERATION_CONFLICT",
        "Android cleanup generation is not active.",
      )
    }
    return writePayload(
      quarantined = true,
      generation = safeGeneration,
      completedGeneration = safeGeneration,
    )
  }

  fun release(generation: String): Map<String, Any> {
    val safeGeneration = validateGeneration(generation)
    val current = read()
    if (
      current["quarantined"] != true ||
      current["generation"] != safeGeneration ||
      current["completedGeneration"] != safeGeneration
    ) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_GENERATION_CONFLICT",
        "Android cleanup generation has not completed.",
      )
    }
    return writePayload(
      quarantined = false,
      generation = null,
      completedGeneration = safeGeneration,
    )
  }

  private fun writePayload(
    quarantined: Boolean,
    generation: String?,
    completedGeneration: String?,
  ): Map<String, Any> {
    val payloadObject = JSONObject()
      .put("version", 1)
      .put("quarantined", quarantined)
    if (generation != null) payloadObject.put("generation", generation)
    if (completedGeneration != null) payloadObject.put("completedGeneration", completedGeneration)
    val payload = payloadObject.toString()
    val digest = sha256(payload)
    val committed = preferences.edit()
      .putString(PAYLOAD_KEY, payload)
      .putString(DIGEST_KEY, digest)
      .commit()
    if (!committed) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE",
        "Android device-protected cleanup storage could not commit.",
      )
    }
    if (
      preferences.getString(PAYLOAD_KEY, null) != payload ||
      preferences.getString(DIGEST_KEY, null) != digest
    ) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE",
        "Android device-protected cleanup storage failed read-back verification.",
      )
    }
    return parsePayload(payload)
  }

  private fun parsePayload(payload: String): Map<String, Any> {
    val json = try {
      JSONObject(payload)
    } catch (_: Throwable) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT",
        "Android device-protected cleanup storage is corrupt.",
      )
    }
    val keys = mutableSetOf<String>()
    val iterator = json.keys()
    while (iterator.hasNext()) keys.add(iterator.next())
    if (!keys.all { it == "version" || it == "quarantined" || it == "generation" || it == "completedGeneration" }) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT",
        "Android device-protected cleanup storage has unknown fields.",
      )
    }
    if (json.optInt("version", -1) != 1 || !json.has("quarantined")) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT",
        "Android device-protected cleanup storage has an invalid schema.",
      )
    }
    val quarantined = try {
      json.getBoolean("quarantined")
    } catch (_: Throwable) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT",
        "Android device-protected cleanup storage has an invalid quarantine state.",
      )
    }
    val generation = optionalJsonGeneration(json, "generation")
    val completedGeneration = optionalJsonGeneration(json, "completedGeneration")
    if (!quarantined && generation != null) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT",
        "Android device-protected cleanup storage has an invalid released state.",
      )
    }
    return availableState(quarantined, generation, completedGeneration)
  }

  private fun optionalJsonGeneration(json: JSONObject, key: String): String? {
    if (!json.has(key) || json.isNull(key)) return null
    return try {
      validateGeneration(json.getString(key))
    } catch (error: StorageException) {
      throw error
    } catch (_: Throwable) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT",
        "Android device-protected cleanup storage has an invalid generation.",
      )
    }
  }

  private fun availableState(
    quarantined: Boolean,
    generation: String? = null,
    completedGeneration: String? = null,
  ): Map<String, Any> {
    val result = mutableMapOf<String, Any>(
      "status" to "available",
      "quarantined" to quarantined,
    )
    if (generation != null) result["generation"] = generation
    if (completedGeneration != null) result["completedGeneration"] = completedGeneration
    return result
  }

  private fun validateGeneration(value: String): String {
    val trimmed = value.trim()
    if (trimmed.isEmpty() || trimmed.length > 128 || !GENERATION_PATTERN.matches(trimmed)) {
      throw StorageException(
        "PORTICO_ANDROID_CLEANUP_STORAGE_CORRUPT",
        "Android cleanup generation is invalid.",
      )
    }
    return trimmed
  }

  private fun sha256(value: String): String {
    return MessageDigest.getInstance("SHA-256")
      .digest(value.toByteArray(StandardCharsets.UTF_8))
      .joinToString("") { byte -> "%02x".format(byte) }
  }

  class StorageException(
    val code: String,
    message: String,
  ) : Exception(message)

  companion object {
    private const val PREFERENCES_NAME = "portico_device_protected_cleanup_v1"
    private const val PAYLOAD_KEY = "payload"
    private const val DIGEST_KEY = "payload_sha256"
    private val GENERATION_PATTERN = Regex("[A-Za-z0-9._:-]{1,128}")
  }
}
