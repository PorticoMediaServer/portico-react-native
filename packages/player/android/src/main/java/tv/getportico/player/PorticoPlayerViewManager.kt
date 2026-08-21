package tv.getportico.player

import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

internal class PorticoPlayerViewManager : SimpleViewManager<PorticoPlayerView>() {
  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): PorticoPlayerView {
    return PorticoPlayerView(context)
  }

  @ReactProp(name = "sourceURL")
  fun setSourceURL(view: PorticoPlayerView, value: String?) = view.setSourceURL(value)

  @ReactProp(name = "authorization")
  fun setAuthorization(view: PorticoPlayerView, value: String?) = view.setAuthorization(value)

  @ReactProp(name = "playbackDescriptor")
  fun setPlaybackDescriptor(view: PorticoPlayerView, value: ReadableMap?) = view.setPlaybackDescriptor(value)

  @ReactProp(name = "autoplay", defaultBoolean = true)
  fun setAutoplay(view: PorticoPlayerView, value: Boolean) = view.setAutoplay(value)

  @ReactProp(name = "allowsCellularAccess", defaultBoolean = true)
  fun setAllowsCellularAccess(view: PorticoPlayerView, value: Boolean) = view.setAllowsCellularAccess(value)

  @ReactProp(name = "allowsPictureInPicture", defaultBoolean = false)
  fun setAllowsPictureInPicture(view: PorticoPlayerView, value: Boolean) = view.setAllowsPictureInPicture(value)

  @ReactProp(name = "isLive", defaultBoolean = false)
  fun setIsLive(view: PorticoPlayerView, value: Boolean) = view.setIsLive(value)

  @ReactProp(name = "contentMode")
  fun setContentMode(view: PorticoPlayerView, value: String?) = view.setContentMode(value)

  @ReactProp(name = "metadataSubtitle")
  fun setMetadataSubtitle(view: PorticoPlayerView, value: String?) = view.setMetadataSubtitle(value)

  @ReactProp(name = "metadataTitle")
  fun setMetadataTitle(view: PorticoPlayerView, value: String?) = view.setMetadataTitle(value)

  @ReactProp(name = "watchWithFriendsControlPolicy")
  fun setWatchWithFriendsControlPolicy(view: PorticoPlayerView, value: String?) =
    view.setWatchWithFriendsControlPolicy(value)

  @ReactProp(name = "seekIntervalSeconds", defaultDouble = 15.0)
  fun setSeekIntervalSeconds(view: PorticoPlayerView, value: Double) = view.setSeekIntervalSeconds(value)

  @ReactProp(name = "startPositionSeconds", defaultDouble = 0.0)
  fun setStartPositionSeconds(view: PorticoPlayerView, value: Double) = view.setStartPositionSeconds(value)

  @ReactProp(name = "playbackGeneration", defaultInt = 0)
  fun setPlaybackGeneration(view: PorticoPlayerView, value: Int) = view.setPlaybackGeneration(value)

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> {
    fun registration(name: String): Map<String, String> = mapOf("registrationName" to name)
    return mapOf(
      PorticoPlayerEvent.EVENT_STATE to registration(PorticoPlayerEvent.EVENT_STATE),
      PorticoPlayerEvent.EVENT_PROGRESS to registration(PorticoPlayerEvent.EVENT_PROGRESS),
      PorticoPlayerEvent.EVENT_ERROR to registration(PorticoPlayerEvent.EVENT_ERROR),
      PorticoPlayerEvent.EVENT_END to registration(PorticoPlayerEvent.EVENT_END),
      PorticoPlayerEvent.EVENT_CAPABILITIES to registration(PorticoPlayerEvent.EVENT_CAPABILITIES),
      PorticoPlayerEvent.EVENT_TRACKS to registration(PorticoPlayerEvent.EVENT_TRACKS),
      PorticoPlayerEvent.EVENT_PICTURE_IN_PICTURE to registration(PorticoPlayerEvent.EVENT_PICTURE_IN_PICTURE),
      PorticoPlayerEvent.EVENT_INTERRUPTION to registration(PorticoPlayerEvent.EVENT_INTERRUPTION),
      PorticoPlayerEvent.EVENT_REMOTE_COMMAND to registration(PorticoPlayerEvent.EVENT_REMOTE_COMMAND),
    )
  }

  override fun onDropViewInstance(view: PorticoPlayerView) {
    view.release()
    super.onDropViewInstance(view)
  }

  companion object {
    const val NAME = "PorticoPlayerView"
  }
}
