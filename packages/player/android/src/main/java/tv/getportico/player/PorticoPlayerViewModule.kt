package tv.getportico.player

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.UIManager
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.UIManagerHelper

@ReactModule(name = PorticoPlayerViewModule.NAME)
internal class PorticoPlayerViewModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> {
    val state = PorticoAndroidRuntime.state(reactApplicationContext)
    val result = mutableMapOf<String, Any>("androidRuntimeState" to state)
    val capabilities = state["capabilities"] as? Map<*, *>
    val profile = capabilities?.get("profile")
    if (profile != null) result["androidPlaybackProfile"] = profile
    return result
  }

  @ReactMethod
  fun getRuntimeState(promise: Promise) {
    promise.resolve(PorticoAndroidRuntime.state(reactApplicationContext))
  }

  @ReactMethod
  fun probeCapabilities(promise: Promise) {
    val state = PorticoAndroidRuntime.state(reactApplicationContext)
    val capabilities = state["capabilities"] as? Map<*, *>
    val profile = capabilities?.get("profile")
    if (capabilities?.get("status") == "available" && profile != null) {
      promise.resolve(profile)
    } else {
      promise.reject(
        "PORTICO_ANDROID_BASELINE_CODEC_UNAVAILABLE",
        "Android playback capabilities are unavailable.",
      )
    }
  }

  /*
   * The one-argument methods are intentionally fenced off on Android. The
   * shared JS surface uses the generation-qualified methods below; accepting an
   * unfenced command would let a stale view/controller mutate a new session.
   */
  @ReactMethod
  fun play(tag: Int) = withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun pause(tag: Int) = withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun seekTo(tag: Int, seconds: Double) = withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun setPlaybackRate(tag: Int, rate: Double) = withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun setVolume(tag: Int, volume: Double) = withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun setSleepTimerDeadline(tag: Int, deadlineMilliseconds: Double) =
    withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun startPictureInPicture(tag: Int) = withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun stopPictureInPicture(tag: Int) = withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun completePictureInPictureRestore(tag: Int, requestId: String, restored: Boolean) =
    withView(tag) { it.rejectUnfencedCommand() }

  @ReactMethod
  fun playAtGeneration(tag: Int, generation: Int) =
    withGeneration(tag, generation) { it.playAtGeneration(generation) }

  @ReactMethod
  fun pauseAtGeneration(tag: Int, generation: Int) =
    withGeneration(tag, generation) { it.pauseAtGeneration(generation) }

  @ReactMethod
  fun seekToAtGeneration(tag: Int, seconds: Double, generation: Int) =
    withGeneration(tag, generation) { it.seekToAtGeneration(generation, seconds) }

  @ReactMethod
  fun setPlaybackRateAtGeneration(tag: Int, rate: Double, generation: Int) =
    withGeneration(tag, generation) { it.setPlaybackRateAtGeneration(generation, rate) }

  @ReactMethod
  fun setVolumeAtGeneration(tag: Int, volume: Double, generation: Int) =
    withGeneration(tag, generation) { it.setVolumeAtGeneration(generation, volume) }

  @ReactMethod
  fun setSleepTimerDeadlineAtGeneration(tag: Int, deadlineMilliseconds: Double, generation: Int) =
    withGeneration(tag, generation) {
      it.setSleepTimerDeadlineAtGeneration(generation, deadlineMilliseconds)
    }

  @ReactMethod
  fun startPictureInPictureAtGeneration(tag: Int, generation: Int) =
    withGeneration(tag, generation) { it.startPictureInPictureAtGeneration(generation) }

  @ReactMethod
  fun stopPictureInPictureAtGeneration(tag: Int, generation: Int) =
    withGeneration(tag, generation) { it.stopPictureInPictureAtGeneration(generation) }

  @ReactMethod
  fun completePictureInPictureRestoreAtGeneration(
    tag: Int,
    requestId: String,
    restored: Boolean,
    generation: Int,
  ) = withGeneration(tag, generation) {
    it.completePictureInPictureRestoreAtGeneration(generation, requestId, restored)
  }

  @ReactMethod
  fun selectAudioTrack(tag: Int, trackId: String, generation: Int) =
    withGeneration(tag, generation) { it.selectAudioTrackAtGeneration(generation, trackId) }

  @ReactMethod
  fun selectTextTrack(tag: Int, trackId: String, generation: Int) =
    withGeneration(tag, generation) { it.selectTextTrackAtGeneration(generation, trackId) }

  private fun withGeneration(
    tag: Int,
    generation: Int,
    operation: (PorticoPlayerView) -> Unit,
  ) {
    UiThreadUtil.runOnUiThread {
      val uiManager: UIManager =
        UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag)
          ?: return@runOnUiThread
      val view = uiManager.resolveView(tag) as? PorticoPlayerView
        ?: return@runOnUiThread
      if (view.acceptsGeneration(generation)) operation(view)
    }
  }

  private fun withView(tag: Int, operation: (PorticoPlayerView) -> Unit) {
    UiThreadUtil.runOnUiThread {
      val uiManager: UIManager =
        UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag)
          ?: return@runOnUiThread
      val view = uiManager.resolveView(tag) as? PorticoPlayerView
        ?: return@runOnUiThread
      operation(view)
    }
  }

  companion object {
    const val NAME = "PorticoPlayerView"
  }
}
