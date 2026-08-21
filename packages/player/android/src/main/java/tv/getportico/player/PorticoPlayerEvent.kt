package tv.getportico.player

import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.facebook.react.uimanager.events.EventDispatcher
import com.facebook.react.bridge.ReactContext
import android.view.View

internal class PorticoPlayerEvent(
  surfaceId: Int,
  viewTag: Int,
  private val name: String,
  private val payload: WritableMap,
) : Event<PorticoPlayerEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = name

  override fun getEventData(): WritableMap = payload

  override fun canCoalesce(): Boolean {
    return name == EVENT_PROGRESS
  }

  companion object {
    const val EVENT_STATE = "onPlaybackState"
    const val EVENT_PROGRESS = "onPlaybackProgress"
    const val EVENT_ERROR = "onPlaybackError"
    const val EVENT_END = "onPlaybackEnd"
    const val EVENT_CAPABILITIES = "onPlaybackCapabilities"
    const val EVENT_TRACKS = "onPlaybackTracks"
    const val EVENT_PICTURE_IN_PICTURE = "onPictureInPictureChange"
    const val EVENT_INTERRUPTION = "onPlaybackInterruption"
    const val EVENT_REMOTE_COMMAND = "onRemotePlaybackCommand"

    fun dispatch(view: View, eventName: String, payload: WritableMap) {
      val context = view.context as? ReactContext ?: return
      val dispatcher: EventDispatcher = UIManagerHelper
        .getEventDispatcherForReactTag(context, view.id)
        ?: return
      dispatcher.dispatchEvent(
        PorticoPlayerEvent(
          UIManagerHelper.getSurfaceId(view),
          view.id,
          eventName,
          payload,
        ),
      )
    }
  }
}
