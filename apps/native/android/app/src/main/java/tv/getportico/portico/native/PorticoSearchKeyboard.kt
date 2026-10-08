package tv.getportico.portico.native

import android.graphics.Color
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event

/**
 * The native view `PorticoSearchKeyboard` (`placeholder`, `onChangeText`): the platform's own
 * keyboard, with its dictation. On Apple TV this is the system search container; on Android it
 * is a plain text field that opens the system keyboard (Android TV's has voice input) and
 * reports what is typed. Results are drawn by React Native.
 */
class PorticoSearchKeyboardManager : SimpleViewManager<EditText>() {
  override fun getName(): String = "PorticoSearchKeyboard"

  override fun createViewInstance(context: ThemedReactContext): EditText {
    val field = EditText(context)
    field.isSingleLine = true
    field.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    field.imeOptions = EditorInfo.IME_ACTION_SEARCH or EditorInfo.IME_FLAG_NO_EXTRACT_UI
    field.setTextColor(Color.WHITE)
    field.setHintTextColor(0x99FFFFFF.toInt())
    field.background = null
    var last = ""
    field.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(text: Editable?) {
        val value = text?.toString() ?: ""
        if (value == last) return
        last = value
        UIManagerHelper.getEventDispatcherForReactTag(context, field.id)
            ?.dispatchEvent(ChangeText(UIManagerHelper.getSurfaceId(context), field.id, value))
      }
    })
    return field
  }

  @ReactProp(name = "placeholder")
  fun setPlaceholder(view: EditText, placeholder: String?) {
    view.hint = placeholder ?: ""
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
      mapOf(ChangeText.NAME to mapOf("registrationName" to "onChangeText"))

  private class ChangeText(surfaceId: Int, viewTag: Int, private val text: String) : Event<ChangeText>(surfaceId, viewTag) {
    override fun getEventName(): String = NAME

    override fun getEventData(): WritableMap = Arguments.createMap().apply { putString("text", text) }

    companion object { const val NAME = "topChangeText" }
  }
}
