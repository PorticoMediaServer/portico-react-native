package tv.getportico.player

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = PorticoCleanupQuarantineModule.NAME)
internal class PorticoCleanupQuarantineModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val store = PorticoDeviceProtectedCleanupStore(reactApplicationContext)

  override fun getName(): String = NAME

  @ReactMethod
  fun getState(promise: Promise) {
    resolve(promise) { store.read() }
  }

  @ReactMethod
  fun begin(generation: String, promise: Promise) {
    resolve(promise) { store.begin(generation) }
  }

  @ReactMethod
  fun markCompleted(generation: String, promise: Promise) {
    resolve(promise) { store.markCompleted(generation) }
  }

  @ReactMethod
  fun release(generation: String, promise: Promise) {
    resolve(promise) { store.release(generation) }
  }

  private fun resolve(promise: Promise, operation: () -> Map<String, Any>) {
    try {
      promise.resolve(operation())
    } catch (error: PorticoDeviceProtectedCleanupStore.StorageException) {
      promise.reject(error.code, error.message)
    } catch (_: Throwable) {
      promise.reject(
        "PORTICO_ANDROID_CLEANUP_STORAGE_UNAVAILABLE",
        "Android device-protected cleanup storage is unavailable.",
      )
    }
  }

  companion object {
    const val NAME = "PorticoCleanupQuarantine"
  }
}
