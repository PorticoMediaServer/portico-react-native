package tv.getportico.portico.native

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.util.Rational
import android.util.TypedValue
import android.view.Gravity
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.media3.exoplayer.ExoPlayer
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * The picture: a surface letterboxed inside its bounds, with the app-drawn subtitle line over
 * it. Used by the `PorticoPlayer` view and by the Picture in Picture window.
 */
internal class PorticoVideoStage(context: Context) : FrameLayout(context) {
  val surface = SurfaceView(context)
  private val subtitle = TextView(context)
  private var attached: ExoPlayer? = null
  private val suppliedSurface: () -> android.view.Surface? = { surface.holder.surface }
  private val captioning = context.getSystemService(Context.CAPTIONING_SERVICE) as? android.view.accessibility.CaptioningManager
  private val captionsChanged = object : android.view.accessibility.CaptioningManager.CaptioningChangeListener() {
    override fun onFontScaleChanged(fontScale: Float) = place(PorticoPlaybackController.shared)
    override fun onUserStyleChanged(userStyle: android.view.accessibility.CaptioningManager.CaptionStyle) = place(PorticoPlaybackController.shared)
    override fun onEnabledChanged(enabled: Boolean) = place(PorticoPlaybackController.shared)
  }

  init {
    setBackgroundColor(Color.BLACK)
    addView(surface)
    subtitle.setTextColor(Color.WHITE)
    subtitle.setBackgroundColor(0xB3000000.toInt())
    subtitle.gravity = Gravity.CENTER
    subtitle.visibility = View.GONE
    subtitle.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
    addView(subtitle)
  }

  /** Shows [player]'s picture here (or nothing). A surface belongs to one player at a time. */
  fun show(player: ExoPlayer?) {
    if (player === attached) return
    val controller = PorticoPlaybackController.shared
    if (controller?.displaySurface === suppliedSurface) controller.displaySurface = null
    attached?.clearVideoSurfaceView(surface)
    attached = player
    player?.setVideoSurfaceView(surface)
    // The controller asks the display to match the title through the surface the picture is on.
    if (player != null) controller?.displaySurface = suppliedSurface
  }

  fun shows(player: ExoPlayer?): Boolean = player != null && attached === player

  fun update(controller: PorticoPlaybackController?, active: Boolean) {
    val cue = controller?.subtitleCue
    val text = if (active) cue?.text ?: "" else ""
    subtitle.text = text
    subtitle.visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
    place(controller)
  }

  /** React Native lays this view out but not its children: they are placed here. */
  fun place(controller: PorticoPlaybackController?) {
    val width = width
    val height = height
    if (width <= 0 || height <= 0) return
    val size = controller?.videoSize
    val videoWidth = (size?.width ?: 0) * (size?.pixelWidthHeightRatio ?: 1f)
    val videoHeight = (size?.height ?: 0).toFloat()
    var w = width
    var h = height
    if (videoWidth > 0 && videoHeight > 0) {
      val aspect = videoWidth / videoHeight
      if (width.toFloat() / height > aspect) w = Math.round(height * aspect) else h = Math.round(width / aspect)
    }
    val left = (width - w) / 2
    val top = (height - h) / 2
    surface.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    surface.layout(left, top, left + w, top + h)
    if (subtitle.visibility != View.VISIBLE) return
    val density = resources.displayMetrics.density
    val line = (w * 0.9f).toInt()
    // Portico's caption style (size and background) on top of the system's own caption settings.
    PorticoMpvSupport.styleCaptionLine(subtitle, context, controller?.subtitleStyle, Math.max(12 * density, Math.min(40 * density, w * 0.035f)), controller?.subtitleCue?.italic == true)
    subtitle.measure(MeasureSpec.makeMeasureSpec(line, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec((h * 0.6f).toInt(), MeasureSpec.AT_MOST))
    val textHeight = subtitle.measuredHeight
    val x = left + (w - line) / 2
    val y = if (controller?.subtitleCue?.top == true) top + (8 * density).toInt() else top + h - Math.max((8 * density).toInt(), (h * 0.08f).toInt()) - textHeight
    subtitle.layout(x, y, x + line, y + textHeight)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = place(PorticoPlaybackController.shared)

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    captioning?.addCaptioningChangeListener(captionsChanged)
  }

  override fun onDetachedFromWindow() {
    captioning?.removeCaptioningChangeListener(captionsChanged)
    super.onDetachedFromWindow()
  }

  override fun requestLayout() {
    super.requestLayout()
    post { measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)); layout(left, top, right, bottom) }
  }
}

/** The native view `PorticoPlayer` (`lease`, `pictureInPictureRequest`). */
internal class PorticoPlayerView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {
  private val stage = PorticoVideoStage(reactContext)
  private var lease = ""
  private var request = 0
  private var listening = false
  private var announced = ""
  private val refresh: () -> Unit = { attach() }

  init { addView(stage, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }

  fun setLease(value: String?) {
    lease = value ?: ""
    attach()
  }

  fun snapshotTarget(expected: Map<String, Any?>): PorticoSnapshotTarget? {
    val controller = PorticoPlaybackController.shared ?: return null
    val token = controller.snapshotIdentity(expected) ?: return null
    val picture = stage.surface
    fun current() = PorticoPlaybackController.shared === controller && isAttachedToWindow && isShown &&
        owns(controller) && expected["lease"] == lease && !PorticoPictureInPicture.active && stage.shows(controller.player) &&
        controller.displaySurface?.invoke() === picture.holder.surface && controller.snapshotIdentity(expected) == token
    return if (current()) PorticoSnapshotTarget(picture, ::current) else null
  }

  /** A change of this number is the viewer asking for Picture in Picture (or to leave it). */
  fun setPictureInPictureRequest(value: Int) {
    if (value == request) return
    request = value
    val controller = PorticoPlaybackController.shared
    if (controller == null || !owns(controller)) {
      controller?.onPictureInPicture?.invoke(Arguments.createMap().apply { putString("lease", lease); putString("state", "unavailable") })
      return
    }
    PorticoPictureInPicture.toggle(reactContext.currentActivity, controller)
  }

  private fun owns(controller: PorticoPlaybackController) = lease.isNotEmpty() && lease == controller.lease

  private fun attach() {
    val controller = PorticoPlaybackController.shared
    val mine = controller != null && isAttachedToWindow && owns(controller)
    // While the Picture in Picture window has the picture, this view shows nothing.
    stage.show(if (mine && !PorticoPictureInPicture.active) controller?.player else null)
    stage.update(controller, mine)
    keepScreenOn = mine && controller?.paused == false
    PorticoPictureInPicture.playerView(reactContext.currentActivity, controller, mine)
    // A device without Picture in Picture (every television) says so once per playback, so the
    // shared player never offers the button there.
    if (mine && announced != lease && reactContext.currentActivity != null) {
      announced = lease
      PorticoPictureInPicture.announce(reactContext.currentActivity, controller!!)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    val controller = PorticoPlaybackController.shared
    if (controller != null && !listening) {
      listening = true
      controller.attachmentListeners.add(refresh)
      controller.subtitleListeners.add(refresh)
      controller.videoSizeListeners.add(refresh)
    }
    attach()
  }

  override fun onDetachedFromWindow() {
    val controller = PorticoPlaybackController.shared
    if (listening) {
      listening = false
      controller?.attachmentListeners?.remove(refresh)
      controller?.subtitleListeners?.remove(refresh)
      controller?.videoSizeListeners?.remove(refresh)
    }
    stage.show(null)
    keepScreenOn = false
    PorticoPictureInPicture.playerView(reactContext.currentActivity, controller, false)
    super.onDetachedFromWindow()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    stage.measure(MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(bottom - top, MeasureSpec.EXACTLY))
    stage.layout(0, 0, right - left, bottom - top)
  }
}

class PorticoPlayerManager : SimpleViewManager<FrameLayout>() {
  override fun getName(): String = "PorticoPlayer"

  override fun createViewInstance(context: ThemedReactContext): FrameLayout = PorticoPlayerView(context)

  @ReactProp(name = "lease")
  fun setLease(view: FrameLayout, lease: String?) = (view as PorticoPlayerView).setLease(lease)

  @ReactProp(name = "pictureInPictureRequest", defaultInt = 0)
  fun setPictureInPictureRequest(view: FrameLayout, request: Int) = (view as PorticoPlayerView).setPictureInPictureRequest(request)
}

/**
 * Picture in Picture on phones and tablets. Android shrinks the whole activity into the small
 * window, so while it is there the picture is drawn in a stage laid over everything else: the
 * window shows the film and its subtitles, whatever screen is underneath. The states reported
 * are the Apple ones (`started`, `restore`, `stopped`, `unavailable`).
 */
internal object PorticoPictureInPicture {
  var active = false
    private set
  private var overlay: PorticoVideoStage? = null
  private var eligible = false
  private val refresh: () -> Unit = { overlay?.update(PorticoPlaybackController.shared, true) }

  fun supported(activity: Activity?): Boolean =
      activity != null && Build.VERSION.SDK_INT >= 26 && activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) &&
          !activity.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

  fun announce(activity: Activity?, controller: PorticoPlaybackController) {
    if (!supported(activity)) report(controller, "unavailable")
  }

  private fun params(controller: PorticoPlaybackController?, auto: Boolean): PictureInPictureParams? {
    if (Build.VERSION.SDK_INT < 26) return null
    val builder = PictureInPictureParams.Builder()
    val size = controller?.videoSize
    if (size != null && size.width > 0 && size.height > 0) {
      val ratio = (size.width * size.pixelWidthHeightRatio / size.height).coerceIn(0.42f, 2.38f)
      builder.setAspectRatio(Rational(Math.round(ratio * 1000), 1000))
    }
    // Leaving the app while a film plays continues it in the small window, as the system's own players do.
    if (Build.VERSION.SDK_INT >= 31) builder.setAutoEnterEnabled(auto)
    return builder.build()
  }

  /** The player view says whether a film is on screen in it; that decides the automatic entry. */
  fun playerView(activity: Activity?, controller: PorticoPlaybackController?, showing: Boolean) {
    eligible = showing && controller != null && controller.hasVideo && controller.videoSize.width > 0 && !controller.paused
    if (!supported(activity) || Build.VERSION.SDK_INT < 26) return
    try { params(controller, eligible)?.let { activity!!.setPictureInPictureParams(it) } } catch (_: Exception) {}
  }

  /** Before Android 12 there is no automatic entry: the activity asks when the viewer leaves it. */
  fun userLeaving(activity: Activity) {
    if (Build.VERSION.SDK_INT >= 31 || !eligible || !supported(activity)) return
    enter(activity, PorticoPlaybackController.shared ?: return)
  }

  fun toggle(activity: Activity?, controller: PorticoPlaybackController) {
    if (!supported(activity)) { report(controller, "unavailable"); return }
    if (Build.VERSION.SDK_INT >= 26 && activity!!.isInPictureInPictureMode) {
      // Leaving is the system's gesture; asked for from here, bring the app back to full size.
      activity.startActivity(Intent(activity, activity.javaClass).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
      return
    }
    if (!enter(activity!!, controller)) report(controller, "unavailable")
  }

  private fun enter(activity: Activity, controller: PorticoPlaybackController): Boolean = try {
    Build.VERSION.SDK_INT >= 26 && params(controller, eligible)?.let { activity.enterPictureInPictureMode(it) } == true
  } catch (_: Exception) {
    false
  }

  /** From the activity: the small window opened or closed. [visible] says the app came back to full size rather than being dismissed. */
  fun changed(activity: Activity, inPictureInPicture: Boolean, visible: Boolean) {
    val controller = PorticoPlaybackController.shared ?: return
    if (inPictureInPicture == active) return
    active = inPictureInPicture
    val content = activity.findViewById<ViewGroup>(android.R.id.content)
    if (inPictureInPicture) {
      val stage = PorticoVideoStage(activity)
      overlay = stage
      content.addView(stage, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      controller.subtitleListeners.add(refresh)
      controller.videoSizeListeners.add(refresh)
      // The player view lets go of the picture; the stage takes it.
      controller.attachmentListeners.toList().forEach { it() }
      stage.show(controller.player)
      stage.update(controller, true)
      report(controller, "started")
    } else {
      controller.subtitleListeners.remove(refresh)
      controller.videoSizeListeners.remove(refresh)
      overlay?.let { it.show(null); content.removeView(it) }
      overlay = null
      controller.attachmentListeners.toList().forEach { it() }
      if (visible) report(controller, "restore")
      report(controller, "stopped")
      // Dismissed, not expanded: the film stops with its window.
      if (!visible) PorticoSystemMedia.current?.dismissed()
    }
  }

  private fun report(controller: PorticoPlaybackController, state: String) {
    controller.onPictureInPicture?.invoke(Arguments.createMap().apply {
      putString("lease", controller.lease ?: "")
      putString("state", state)
      // The stage draws the app's subtitles in the small window too.
      if (state == "started") putBoolean("subtitlesCarried", true)
    })
  }
}
