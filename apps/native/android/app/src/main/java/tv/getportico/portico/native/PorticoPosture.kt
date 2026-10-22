package tv.getportico.portico.native

import android.app.Activity
import android.content.ComponentCallbacks
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.ViewTreeObserver
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import androidx.window.layout.WindowMetricsCalculator
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.LifecycleState

/** Read-only window posture. No device identity, preference, navigation or playback state. */
class PorticoPosture(context: ReactApplicationContext) : PorticoEventModule(context), LifecycleEventListener, ComponentCallbacks {
  private val main = Handler(Looper.getMainLooper())
  private val state = PorticoPostureState()
  private var listeners = 0
  private var resumed = false
  private var invalidated = false
  private var activity: Activity? = null
  private var observedMetrics: PostureMetrics? = null
  private var adapter: WindowInfoTrackerCallbackAdapter? = null
  private var consumer: Consumer<WindowLayoutInfo>? = null
  private var tree: ViewTreeObserver? = null
  private val layout = ViewTreeObserver.OnGlobalLayoutListener { ensureAttached() }

  override fun getName() = "PorticoPosture"

  override fun initialize() {
    super.initialize()
    reactApplicationContext.addLifecycleEventListener(this)
    reactApplicationContext.registerComponentCallbacks(this)
    main.post {
      if (!invalidated) {
        resumed = reactApplicationContext.lifecycleState == LifecycleState.RESUMED
        ensureAttached()
      }
    }
  }

  @ReactMethod fun addListener(event: String) {
    if (event != EVENT) return
    main.post { if (!invalidated) { listeners++; ensureAttached() } }
  }

  @ReactMethod fun removeListeners(count: Double) {
    main.post {
      if (!invalidated && count.isFinite() && count > 0) {
        listeners = (listeners - count.coerceAtMost(Int.MAX_VALUE.toDouble()).toInt()).coerceAtLeast(0)
        if (listeners == 0) stop()
      }
    }
  }

  @ReactMethod fun getSnapshot(promise: Promise) {
    main.post {
      if (!invalidated) ensureAttached()
      promise.resolve(wire())
    }
  }

  private fun rect(value: Rect) = PostureRect(value.left.toDouble(), value.top.toDouble(), value.right.toDouble(), value.bottom.toDouble())

  private fun metrics(host: Activity): PostureMetrics {
    val metrics = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(host)
    return PostureMetrics(rect(metrics.bounds), metrics.density.toDouble())
  }

  private fun fold(value: FoldingFeature): PostureFold = PostureFold(
      rect(value.bounds),
      when (value.state) {
        FoldingFeature.State.FLAT -> "flat"
        FoldingFeature.State.HALF_OPENED -> "half-opened"
        else -> error("Unknown FoldingFeature state")
      },
      when (value.orientation) {
        FoldingFeature.Orientation.HORIZONTAL -> "horizontal"
        FoldingFeature.Orientation.VERTICAL -> "vertical"
        else -> error("Unknown FoldingFeature orientation")
      },
      value.isSeparating,
      when (value.occlusionType) {
        FoldingFeature.OcclusionType.NONE -> "none"
        FoldingFeature.OcclusionType.FULL -> "full"
        else -> error("Unknown FoldingFeature occlusion")
      },
  )

  /** All entry points and callbacks are on the UI thread. Reobserve after window/density changes. */
  private fun ensureAttached() {
    val host = reactApplicationContext.currentActivity
    if (invalidated || !resumed || listeners == 0 || host == null || host.isDestroyed || host.isFinishing) { stop(); return }
    try {
      val current = metrics(host)
      if (activity === host && observedMetrics == current && consumer != null) return
      detachObservation()
      val token = state.begin(current)
      activity = host
      observedMetrics = current
      changed()
      val tracker = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(host))
      val callback = Consumer<WindowLayoutInfo> { info ->
        if (!state.isCurrent(token) || invalidated || !resumed || listeners == 0 || activity !== host || consumer == null) return@Consumer
        try {
          if (reactApplicationContext.currentActivity !== host || metrics(host) != current) { ensureAttached(); return@Consumer }
          if (state.available(token, current, info.displayFeatures.filterIsInstance<FoldingFeature>().map { fold(it) })) changed()
        } catch (_: Exception) { stop() }
      }
      adapter = tracker
      consumer = callback
      tree = host.window.decorView.viewTreeObserver.also { it.addOnGlobalLayoutListener(layout) }
      tracker.addWindowLayoutInfoListener(host, ContextCompat.getMainExecutor(host), callback)
    } catch (_: Exception) { stop() }
  }

  private fun detachObservation() {
    consumer?.let { callback -> adapter?.removeWindowLayoutInfoListener(callback) }
    tree?.takeIf { it.isAlive }?.removeOnGlobalLayoutListener(layout)
    consumer = null
    adapter = null
    tree = null
    activity = null
    observedMetrics = null
  }

  private fun stop() {
    detachObservation()
    if (state.clear()) changed()
  }

  private fun changed() { if (!invalidated && listeners > 0) emit(EVENT, wire()) }

  private fun wire(): WritableMap = Arguments.createMap().apply {
    putDouble("revision", state.revision.toDouble())
    putString("status", state.snapshot.status)
    val window = state.snapshot.window
    if (window == null) putNull("window") else putMap("window", Arguments.createMap().apply {
      putDouble("width", window.width); putDouble("height", window.height)
    })
    putArray("folds", Arguments.createArray().apply {
      state.snapshot.folds.forEach { feature -> pushMap(Arguments.createMap().apply {
        putString("state", feature.state)
        putString("orientation", feature.orientation)
        putBoolean("isSeparating", feature.isSeparating)
        putString("occlusion", feature.occlusion)
        putMap("bounds", Arguments.createMap().apply {
          putDouble("left", feature.bounds.left); putDouble("top", feature.bounds.top)
          putDouble("right", feature.bounds.right); putDouble("bottom", feature.bounds.bottom)
        })
      }) }
    })
  }

  override fun onHostResume() { main.post { if (!invalidated) { resumed = true; ensureAttached() } } }
  override fun onHostPause() { main.post { resumed = false; stop() } }
  override fun onHostDestroy() { main.post { resumed = false; stop() } }
  override fun onConfigurationChanged(configuration: Configuration) { main.post { ensureAttached() } }
  override fun onLowMemory() {}

  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    reactApplicationContext.unregisterComponentCallbacks(this)
    main.post { invalidated = true; listeners = 0; stop() }
    super.invalidate()
  }

  private companion object { const val EVENT = "PorticoPostureChanged" }
}
