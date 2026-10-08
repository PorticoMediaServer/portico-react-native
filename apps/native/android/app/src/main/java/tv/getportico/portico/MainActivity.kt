package tv.getportico.portico

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import androidx.lifecycle.Lifecycle
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import tv.getportico.portico.native.PorticoAccountAuth
import tv.getportico.portico.native.PorticoPictureInPicture

class MainActivity : ReactActivity() {

  /** The component `index.js` registers (app.json's name), the same one the Apple apps start. */
  override fun getMainComponentName(): String = "Portico"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun attachBaseContext(newBase: Context) {
    super.attachBaseContext(TelevisionDisplay.context(newBase))
  }

  /**
   * The navigation stack lives in JavaScript, so a recreated activity starts from the app's own
   * saved sign-in rather than from restored fragments (react-native-screens requires this).
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    // A cold launch's link is filtered before React Native can read it.
    intent = PorticoUrlRoutes.filtered(intent)
    super.onCreate(null)
  }

  /** The small window opened, or closed: back at full size when the activity is still on screen, dismissed otherwise. */
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    PorticoPictureInPicture.changed(this, isInPictureInPictureMode, lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
  }

  /** Leaving the app while a film plays continues it in the small window (before Android 12, which does this itself). */
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    PorticoPictureInPicture.userLeaving(this)
  }

  private val keys = Handler(Looper.getMainLooper())
  private var menuHeld = false

  /**
   * A television remote's Menu key (the Fire TV remote has one) opens what a long press of
   * Select opens: it is delivered as Select held past the long-press delay, so every control's
   * own long-press action answers it and no screen has to know the key exists.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode != KeyEvent.KEYCODE_MENU || !TelevisionDisplay.isTelevision) return super.dispatchKeyEvent(event)
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 && !menuHeld) {
      menuHeld = true
      val down = SystemClock.uptimeMillis()
      super.dispatchKeyEvent(KeyEvent(down, down, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 0))
      keys.postDelayed({
        menuHeld = false
        super.dispatchKeyEvent(KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER, 0))
      }, MENU_HOLD_MS)
    }
    return true
  }

  /**
   * One allowlist (`PorticoUrlRoutes`) for every link handed to the app while it runs. A provider
   * sign-in's return goes to the sign-in that is waiting for it, as it does inside the system
   * sign-in browser on iPhone.
   */
  override fun onNewIntent(intent: Intent) {
    val allowed = PorticoUrlRoutes.filtered(intent) ?: intent
    if (PorticoAccountAuth.takeReturn(allowed)) allowed.data = null
    setIntent(allowed)
    super.onNewIntent(allowed)
  }

  companion object {
    /** Longer than React Native's long-press delay (500 ms), with room for a slow device. */
    private const val MENU_HOLD_MS = 800L
  }
}
