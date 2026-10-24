package tv.getportico.portico.native

import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Outline
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.ReplacementSpan
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.UIManagerHelper
import tv.getportico.portico.BuildConfig
import java.util.ArrayDeque

/** No app state, strings, props, assets or image bytes cross this DEBUG-only boundary. */
class PorticoLayoutObservation(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  @Volatile private var retired = false
  override fun getName() = "PorticoLayoutObservation"
  override fun invalidate() { retired = true; super.invalidate() }

  @ReactMethod
  fun observe(rootReactTag: Double, fixtureReactTag: Double, hostReactTags: ReadableArray, promise: Promise) {
    val tags = try {
      if (hostReactTags.size() > LayoutObservationPolicy.MAX_HOSTS) null else (0 until hostReactTags.size()).map {
        if (hostReactTags.getType(it) != ReadableType.Number) return@map Double.NaN
        hostReactTags.getDouble(it)
      }
    } catch (_: Exception) { null }
    val activity = reactApplicationContext.currentActivity
    val intent = activity?.intent
    if (retired || activity == null || intent == null || tags == null || !LayoutObservationPolicy.admitted(
        BuildConfig.DEBUG, intent.action, intent.dataString, rootReactTag, fixtureReactTag, tags)) {
      promise.reject("layout_observation_scope", "layout_observation_scope"); return
    }
    UiThreadUtil.runOnUiThread {
      try {
        fun intentCurrent() = !retired && reactApplicationContext.currentActivity === activity && activity.intent === intent &&
          LayoutObservationPolicy.publicIntent(BuildConfig.DEBUG, intent.action, intent.dataString) && !activity.isFinishing && !activity.isDestroyed
        if (!intentCurrent()) { promise.reject("layout_observation_scope", "layout_observation_scope"); return@runOnUiThread }
        // Only this captured root is resolved by RN. All other IDs are found below it.
        val root = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, rootReactTag.toInt())?.resolveView(rootReactTag.toInt())
        val decor = activity.window?.decorView
        if (root == null || root.id != rootReactTag.toInt() || decor == null || !root.isAttachedToWindow || root.windowToken == null ||
            root.windowToken != decor.windowToken || !descendant(root, decor)) {
          promise.reject("layout_observation_scope", "layout_observation_scope"); return@runOnUiThread
        }
        val window = root.windowToken
        val requested = tags.map { it.toInt() }
        val wanted = (requested + fixtureReactTag.toInt()).toSet()
        val found = LayoutObservationPolicy.collect(root, wanted, { it.id }, { if (it is ViewGroup) it.childCount else 0 },
          { view, index -> (view as ViewGroup).getChildAt(index) })
        if (found == null) { promise.reject("layout_observation_scope", "layout_observation_scope"); return@runOnUiThread }
        val fixture = found[fixtureReactTag.toInt()]
        fun scopeCurrent() = intentCurrent() && root.id == rootReactTag.toInt() && root.isAttachedToWindow && decor.isAttachedToWindow &&
          activity.window?.decorView === decor && root.windowToken == window && decor.windowToken == window &&
          descendant(root, decor) && fixture != null && fixture.id == fixtureReactTag.toInt() && fixture.isAttachedToWindow && fixture.windowToken == window && descendant(fixture, root)
        if (!scopeCurrent()) { promise.reject("layout_observation_scope", "layout_observation_scope"); return@runOnUiThread }
        val budget = LayoutObservationPolicy.TextBudget()
        val hosts = requested.map { tag ->
          val view = found[tag]
          val reason = when {
            view == null -> "host-not-found"
            !view.isAttachedToWindow -> "host-detached"
            !descendant(view, root) -> "host-outside-root"
            view.windowToken != window -> "host-window-mismatch"
            input(view, root) -> "input-opaque"
            else -> null
          }
          val observed = if (reason != null) unavailableFacts(reason) else try { facts(view!!, decor, budget) }
            catch (_: Exception) { unavailableFacts("paint-unprovable") }
          mapOf("reactTag" to tag, "facts" to if (view != null && (view.id != tag || !view.isAttachedToWindow ||
            view.windowToken != window || !descendant(view, root))) unavailableFacts("root-changed") else observed)
        }
        if (!scopeCurrent()) { promise.reject("layout_observation_scope", "layout_observation_scope"); return@runOnUiThread }
        promise.resolve(Arguments.makeNativeMap(mapOf("version" to 1, "unit" to "dp", "rootReactTag" to rootReactTag.toInt(),
          "fixtureReactTag" to fixtureReactTag.toInt(), "hosts" to hosts)))
      } catch (_: Exception) {
        // Neither target exception strings nor native paths are diagnostics for this public fixture.
        promise.reject("layout_observation_scope", "layout_observation_scope")
      }
    }
  }

  private fun facts(view: View, decor: View, budget: LayoutObservationPolicy.TextBudget): Map<String, Any> {
    val result = unavailableFacts("paint-unprovable").toMutableMap()
    val density = view.resources.displayMetrics.density.toDouble()
    if (!density.isFinite() || density <= 0) return result
    result["isFocused"] = value(view.isFocused, "android.View.isFocused")
    val chain = ancestry(view, decor) ?: return result
    val alpha = chain.map { if (Build.VERSION.SDK_INT >= 29 && it.layerType == View.LAYER_TYPE_NONE &&
      (it.animation == null || it.animation.hasEnded())) it.alpha.toDouble() * it.transitionAlpha.toDouble() else Double.NaN }
    LayoutObservationPolicy.opacity(alpha)?.let { result["effectiveOpacity"] = value(it, "android.View.alpha+transitionAlpha.decorAncestry") }
    val backgrounds = chain.map(::background)
    backgrounds.first()?.let { result["backgroundColor"] = value(LayoutObservationPolicy.rgba(it), if (view.background == null) "android.View.background.none" else "android.ColorDrawable.color+alpha") }
      ?: run { result["backgroundColor"] = missing("unsupported-background") }
    if (backgrounds.all { it != null } && LayoutObservationPolicy.opacity(alpha) != null) {
      val composite = LayoutObservationPolicy.background(backgrounds.map { it!! }, alpha)
      result["effectiveBackgroundColor"] = value(LayoutObservationPolicy.rgba(composite), "android.ColorDrawable+View.alpha.decorAncestry")
    } else result["effectiveBackgroundColor"] = missing("unsupported-background")
    result["borderRadius"] = radius(view, density)
    // Elevation/light geometry and RN shadows have no public exact CSS-equivalent paint getter.
    result["boxShadow"] = missing("unsupported-shadow")
    if (view !is TextView) {
      TEXT_FIELDS.forEach { result[it] = missing("not-text") }; return result
    }
    text(view, decor, density, budget).forEach { (key, observation) -> result[key] = observation }
    return result
  }

  private fun radius(view: View, density: Double): Map<String, Any> {
    if (!view.clipToOutline || view.outlineProvider == null) return missing("unsupported-outline")
    val outline = Outline(); view.outlineProvider.getOutline(view, outline)
    val rect = Rect()
    if (!outline.getRect(rect) || rect != Rect(0, 0, view.width, view.height) || !outline.radius.isFinite() || outline.radius < 0) return missing("unsupported-outline")
    return value(outline.radius / density, "android.ViewOutlineProvider+Outline.getRadius")
  }

  private fun text(view: TextView, decor: View, density: Double, budget: LayoutObservationPolicy.TextBudget): Map<String, Any> {
    val result = TEXT_FIELDS.associateWith { missing("paint-unprovable") }.toMutableMap()
    val layout = view.layout ?: return TEXT_FIELDS.associateWith { missing("unsupported-text-layout") }
    if (view.isLayoutRequested || layout.lineCount > LayoutObservationPolicy.MAX_LINES || !budget.lines(layout.lineCount) ||
        (0 until layout.lineCount).any { layout.getEllipsisCount(it) != 0 }) return TEXT_FIELDS.associateWith { missing("unsupported-text-layout") }
    // Layout's public span metadata is consulted without reading/subsequencing/serializing characters.
    // Reapply the same draw-state spans to detached TextPaints; base TextView defaults alone are not run paint.
    val content = layout.text
    val spanned = content as? Spanned
    val paints = mutableListOf<TextPaint>()
    var start = 0
    while (start < content.length) {
      if (paints.size >= LayoutObservationPolicy.MAX_RUNS || !budget.run()) return TEXT_FIELDS.associateWith { missing("unsupported-text-layout") }
      val end = spanned?.nextSpanTransition(start, content.length, CharacterStyle::class.java) ?: content.length
      if (end <= start) return result
      val paint = TextPaint(layout.paint); paint.color = view.currentTextColor; paint.drawableState = view.drawableState
      view.linkTextColors?.let { paint.linkColor = it.getColorForState(view.drawableState, it.defaultColor) }
      val spans = if (spanned == null) emptyList() else spanned.getSpans(start, end, CharacterStyle::class.java).filter {
        spanned.getSpanStart(it) < end && spanned.getSpanEnd(it) > start
      }
      if (spans.any { it is ReplacementSpan }) return TEXT_FIELDS.associateWith { missing("unsupported-text-layout") }
      for (span in spans) span.updateDrawState(paint)
      paints.add(paint); start = end
    }
    val colors = paints.map { it.color }.distinct()
    if (colors.size == 1 && paints.all { it.shader == null && it.colorFilter == null })
      result["textColor"] = value(LayoutObservationPolicy.rgba(colors.single()), "android.Layout.TextPaint+CharacterStyle")
    val sizes = paints.map { it.textSize.toDouble() }.distinct()
    if (sizes.size == 1 && sizes.single().isFinite() && sizes.single() > 0) result["fontSize"] = value(sizes.single() / density, "android.Layout.TextPaint.textSize+MetricAffectingSpan")
    if (Build.VERSION.SDK_INT >= 28 && paints.isNotEmpty() && paints.all { it.typeface != null && !it.isFakeBoldText }) {
      val weights = paints.map { it.typeface.weight }.distinct()
      if (weights.size == 1) result["fontWeight"] = value(weights.single(), "android.Layout.TextPaint.Typeface.getWeight")
    }
    result["fontFamily"] = missing("font-family-unavailable")
    if (Build.VERSION.SDK_INT >= 36 && paints.isNotEmpty()) {
      val families = paints.map { it.typeface?.systemFontFamilyName }.distinct()
      if (families.size == 1 && LayoutObservationPolicy.fontFamily(families.single())) result["fontFamily"] = value(families.single()!!, "android.Layout.TextPaint.Typeface.getSystemFontFamilyName")
    }
    val heights = (0 until layout.lineCount).map { layout.getLineBottom(it) - layout.getLineTop(it) }.distinct()
    if (heights.size == 1 && heights.single() > 0) result["lineHeight"] = value(heights.single() / density, "android.Layout.getLineTop+getLineBottom")
    result["textLineRects"] = missing("unsupported-transform")
    if (Build.VERSION.SDK_INT < 29 || ancestry(view, decor)?.any { it.animation != null && !it.animation.hasEnded() } != false) return result
    val matrix = Matrix(); view.transformMatrixToGlobal(matrix)
    val decorMatrix = Matrix(); decor.transformMatrixToGlobal(decorMatrix)
    val globalOrigin = floatArrayOf(0f, 0f); decorMatrix.mapPoints(globalOrigin)
    val windowOrigin = IntArray(2); decor.getLocationInWindow(windowOrigin)
    val dx = windowOrigin[0] - globalOrigin[0]; val dy = windowOrigin[1] - globalOrigin[1]
    val available = view.height - view.extendedPaddingTop - view.extendedPaddingBottom
    if (view.scrollX != 0 || view.scrollY != 0 || layout.lineCount > view.maxLines || layout.height > available)
      return result.apply { this["textLineRects"] = missing("unsupported-text-layout") }
    val vertical = when (view.gravity and Gravity.VERTICAL_GRAVITY_MASK) {
      Gravity.BOTTOM -> (available - layout.height).coerceAtLeast(0)
      Gravity.CENTER_VERTICAL -> (available - layout.height).coerceAtLeast(0) / 2
      else -> 0
    }
    val x = view.compoundPaddingLeft - view.scrollX
    val y = view.extendedPaddingTop + vertical - view.scrollY
    val rects = (0 until layout.lineCount).map { line ->
      val rect = RectF(layout.getLineLeft(line) + x, (layout.getLineTop(line) + y).toFloat(), layout.getLineRight(line) + x, (layout.getLineBottom(line) + y).toFloat())
      matrix.mapRect(rect); rect.offset(dx, dy)
      mapOf("x" to rect.left / density, "y" to rect.top / density, "width" to rect.width() / density, "height" to rect.height() / density)
    }
    if (rects.all { rect -> rect.values.all { it.isFinite() } && rect.getValue("width") >= 0 && rect.getValue("height") >= 0 })
      result["textLineRects"] = value(rects, "android.Layout.lineBounds+View.transformMatrixToGlobal.windowDp")
    return result
  }

  private fun background(view: View): Int? {
    val drawable = view.background ?: return Color.TRANSPARENT
    if (drawable !is ColorDrawable || drawable.colorFilter != null) return null
    return (drawable.color and 0x00ffffff) or (drawable.alpha shl 24)
  }

  private fun ancestry(view: View, root: View): List<View>? {
    val result = mutableListOf<View>(); var current: View? = view
    while (current != null && result.size < LayoutObservationPolicy.MAX_ANCESTORS) {
      if (!current.isAttachedToWindow || current.windowToken != root.windowToken) return null
      result.add(current); if (current === root) return result
      current = current.parent as? View
    }
    return null
  }
  private fun descendant(view: View, root: View) = ancestry(view, root) != null
  private fun input(view: View, root: View) = ancestry(view, root)?.any { it is EditText } != false
  private fun value(value: Any, source: String): Map<String, Any> = mapOf("value" to value, "source" to source)
  private fun missing(reason: String): Map<String, Any> = mapOf("unavailable" to reason)
  private fun unavailableFacts(reason: String): Map<String, Any> = FIELDS.associateWith { missing(reason) }

  companion object {
    private val TEXT_FIELDS = listOf("textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "textLineRects")
    private val FIELDS = listOf("isFocused", "effectiveOpacity", "backgroundColor", "effectiveBackgroundColor", "borderRadius", "boxShadow") + TEXT_FIELDS
  }
}

/** Pure admission/composition math; tests do not claim native paint/device coverage. */
internal object LayoutObservationPolicy {
  const val MAX_HOSTS = 2000
  const val MAX_NODES = 20000
  const val MAX_LINES = 512
  const val MAX_RUNS = 512
  const val MAX_ANCESTORS = 256
  class TextBudget {
    private var lines = 4096
    private var runs = 4096
    fun lines(count: Int): Boolean { if (count < 0 || count > lines) return false; lines -= count; return true }
    fun run(): Boolean { if (runs == 0) return false; runs--; return true }
  }
  private const val PUBLIC_URI = "portico://native-layout?specimen=signed-out-welcome"
  fun publicIntent(debug: Boolean, action: String?, uri: String?) = debug && action == "android.intent.action.VIEW" && uri == PUBLIC_URI
  fun fontFamily(value: String?) = value != null && value.isNotBlank() && value.length <= 128 && value.none { it.isISOControl() || it in "/\\:@?#" }
  private fun tag(value: Double) = value.isFinite() && value > 0 && value <= Int.MAX_VALUE && value == value.toInt().toDouble()
  fun admitted(debug: Boolean, action: String?, uri: String?, root: Double, fixture: Double, tags: List<Double>) =
    publicIntent(debug, action, uri) && tag(root) && tag(fixture) && root != fixture && tags.size <= MAX_HOSTS && tags.all(::tag) && tags.distinct().size == tags.size
  fun <T : Any> collect(root: T, wanted: Set<Int>, id: (T) -> Int, count: (T) -> Int, child: (T, Int) -> T): Map<Int, T>? {
    val found = linkedMapOf<Int, T>(); val pending = ArrayDeque<T>(); pending.add(root)
    var visited = 0
    while (pending.isNotEmpty()) {
      val view = pending.removeLast(); if (++visited > MAX_NODES) return null
      val tag = id(view)
      if (tag in wanted && found.put(tag, view) != null) return null
      val size = count(view)
      if (size < 0 || size.toLong() + pending.size + visited > MAX_NODES) return null
      for (index in 0 until size) pending.add(child(view, index))
    }
    return found
  }
  fun opacity(alpha: List<Double>): Double? = if (alpha.isEmpty() || alpha.any { !it.isFinite() || it < 0 || it > 1 }) null else alpha.fold(1.0) { a, b -> a * b }
  data class Rgba(val red: Double, val green: Double, val blue: Double, val alpha: Double)
  fun rgba(color: Int) = rgba(Rgba((color ushr 16 and 255).toDouble(), (color ushr 8 and 255).toDouble(), (color and 255).toDouble(), (color ushr 24 and 255) / 255.0))
  fun rgba(color: Rgba): String {
    fun number(value: Double) = java.math.BigDecimal.valueOf(value).setScale(8, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
    return "rgba(${number(color.red)}, ${number(color.green)}, ${number(color.blue)}, ${number(color.alpha)})"
  }
  fun background(colors: List<Int>, alpha: List<Double>): Rgba {
    var a = 0.0; var r = 0.0; var g = 0.0; var b = 0.0
    for (index in colors.indices) {
      val color = colors[index]; val ca = (color ushr 24 and 255) / 255.0
      r += (color ushr 16 and 255) * ca * (1 - a); g += (color ushr 8 and 255) * ca * (1 - a); b += (color and 255) * ca * (1 - a)
      a += ca * (1 - a)
      r *= alpha[index]; g *= alpha[index]; b *= alpha[index]; a *= alpha[index]
    }
    if (a == 0.0) return Rgba(0.0, 0.0, 0.0, 0.0)
    return Rgba(r / a, g / a, b / a, a)
  }
}
