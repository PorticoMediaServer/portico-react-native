package tv.getportico.player

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = PorticoRuntimeModule.NAME)
internal class PorticoRuntimeModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> {
    return mapOf("androidRuntimeState" to PorticoAndroidRuntime.state(reactApplicationContext))
  }

  @ReactMethod
  fun getRuntimeState(promise: Promise) {
    try {
      promise.resolve(PorticoAndroidRuntime.state(reactApplicationContext))
    } catch (_: Throwable) {
      promise.reject(
        "PORTICO_ANDROID_RUNTIME_UNAVAILABLE",
        "Android runtime identity is unavailable.",
      )
    }
  }

  companion object {
    const val NAME = "PorticoRuntime"
  }
}
