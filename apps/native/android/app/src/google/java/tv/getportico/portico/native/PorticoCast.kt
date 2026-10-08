package tv.getportico.portico.native

import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.fragment.app.FragmentActivity
import androidx.mediarouter.app.MediaRouteChooserDialogFragment
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.cast.Cast
import com.google.android.gms.cast.CastDevice
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import tv.getportico.portico.TelevisionDisplay

/** What only this build has: Google Cast, on phones and tablets with Google Play services. */
internal fun flavorModules(context: ReactApplicationContext): List<NativeModule> =
    if (TelevisionDisplay.isTelevision) emptyList() else listOf(PorticoCast(context))

private fun castApplicationId(context: Context): String = try {
  context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData?.getString("PorticoCastApplicationID") ?: ""
} catch (_: Exception) { "" }

/** The Cast SDK asks this class for its options; the receiver is Portico's own. */
class PorticoCastOptions : OptionsProvider {
  override fun getCastOptions(context: Context): CastOptions = CastOptions.Builder().setReceiverApplicationId(castApplicationId(context)).build()
  override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}

/**
 * `NativeModules.PorticoCast`: the Android counterpart of `Native/PorticoCast.m`. The same five
 * methods and two events (`PorticoCastSession`, `PorticoCastMessage`), over Portico's own channel.
 * Main thread only: the Cast SDK requires it.
 */
class PorticoCast(context: ReactApplicationContext) : PorticoEventModule(context) {
  private val main = Handler(Looper.getMainLooper())
  private var cast: CastContext? = null
  private var attached: CastSession? = null
  private var listening = false

  override fun getName(): String = "PorticoCast"

  @ReactMethod fun addListener(eventName: String) { main.post { listening = true; context()?.sessionManager?.addSessionManagerListener(sessions, CastSession::class.java) } }

  @ReactMethod fun removeListeners(count: Double) {}

  override fun invalidate() {
    main.post {
      listening = false
      cast?.sessionManager?.removeSessionManagerListener(sessions, CastSession::class.java)
      detach()
    }
    super.invalidate()
  }

  /** The SDK's context, when this device can cast at all (Play services present, a receiver configured). */
  private fun context(): CastContext? {
    cast?.let { return it }
    val app = reactApplicationContext.applicationContext
    if (castApplicationId(app).isEmpty() || GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(app) != ConnectionResult.SUCCESS) return null
    return try { @Suppress("DEPRECATION") CastContext.getSharedInstance(app).also { cast = it } } catch (_: Exception) { null }
  }

  private fun emitSession(state: String, session: CastSession?, failed: Boolean) {
    if (!listening) return
    val body = Arguments.createMap()
    body.putString("state", state)
    body.putString("deviceName", session?.castDevice?.friendlyName ?: "")
    body.putString("error", if (failed) "cast_failed" else "")
    emit("PorticoCastSession", body)
  }

  private val messages = Cast.MessageReceivedCallback { _: CastDevice, namespace: String, message: String ->
    if (listening && namespace == NAMESPACE && message.length <= 65536) emit("PorticoCastMessage", Arguments.createMap().apply { putString("message", message) })
  }

  private fun attach(session: CastSession) {
    if (attached === session) return
    detach()
    try { session.setMessageReceivedCallbacks(NAMESPACE, messages); attached = session } catch (_: Exception) {}
  }

  private fun detach() {
    try { attached?.removeMessageReceivedCallbacks(NAMESPACE) } catch (_: Exception) {}
    attached = null
  }

  private val sessions = object : SessionManagerListener<CastSession> {
    override fun onSessionStarted(session: CastSession, sessionId: String) { attach(session); emitSession("started", session, false) }
    override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) { attach(session); emitSession("started", session, false) }
    override fun onSessionEnded(session: CastSession, error: Int) { detach(); emitSession("ended", session, error != 0) }
    override fun onSessionStartFailed(session: CastSession, error: Int) { detach(); emitSession("failed", session, true) }
    override fun onSessionResumeFailed(session: CastSession, error: Int) { detach(); emitSession("failed", session, true) }
    override fun onSessionStarting(session: CastSession) {}
    override fun onSessionEnding(session: CastSession) {}
    override fun onSessionResuming(session: CastSession, sessionId: String) {}
    override fun onSessionSuspended(session: CastSession, reason: Int) {}
  }

  @ReactMethod
  fun available(promise: Promise) { main.post { promise.resolve(context() != null) } }

  /** The current session, if one is connected (after an app relaunch the SDK may resume it). */
  @ReactMethod
  fun current(promise: Promise) {
    main.post {
      val session = context()?.sessionManager?.currentCastSession
      if (session == null || !session.isConnected) { promise.resolve(null); return@post }
      attach(session)
      promise.resolve(Arguments.createMap().apply { putString("deviceName", session.castDevice?.friendlyName ?: "") })
    }
  }

  /** The SDK's own device chooser; the session events report the outcome. */
  @ReactMethod
  fun choose() {
    main.post {
      val selector = context()?.mergedSelector ?: return@post
      val activity = reactApplicationContext.currentActivity as? FragmentActivity ?: return@post
      try {
        MediaRouteChooserDialogFragment().also { it.routeSelector = selector }.show(activity.supportFragmentManager, "portico.cast.chooser")
      } catch (_: Exception) {}
    }
  }

  @ReactMethod
  fun send(json: String?, promise: Promise) {
    main.post {
      val session = attached
      if (session == null || json == null || json.length > 65536) { promise.reject("cast_not_connected", "No Cast session."); return@post }
      try {
        session.sendMessage(NAMESPACE, json).setResultCallback { status ->
          if (status.isSuccess) promise.resolve(true) else promise.reject("cast_send_failed", "The message was not sent.")
        }
      } catch (_: Exception) {
        promise.reject("cast_send_failed", "The message was not sent.")
      }
    }
  }

  @ReactMethod
  fun end(stopReceiver: Boolean) { main.post { try { context()?.sessionManager?.endCurrentSession(stopReceiver) } catch (_: Exception) {} } }

  private companion object { const val NAMESPACE = "urn:x-cast:tv.getportico.cast" }
}
