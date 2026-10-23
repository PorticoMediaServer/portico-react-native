package tv.getportico.portico.native

import android.view.Display
import android.view.Window
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.round

/** API24-29 TVs expose display modes, before Surface.setFrameRate exists. */
internal object PorticoDisplayRate {
  private var window = WeakReference<Window>(null)
  private var original = 0
  fun attach(value: Window) { if(window.get() !== value) { window=WeakReference(value);original=value.attributes.preferredDisplayModeId } }
  fun vote(display: Display?, fps: Float): Boolean {
    val target=window.get() ?: return false
    val current=display?.mode ?: return false
    val chosen=choose(display.supportedModes.toList(),current.physicalWidth,current.physicalHeight,fps) ?: return false
    target.attributes=target.attributes.apply { preferredDisplayModeId=chosen.modeId };return true
  }
  fun clear() { window.get()?.let { it.attributes=it.attributes.apply { preferredDisplayModeId=original } } }
  fun choose(modes: List<Display.Mode>,width: Int,height: Int,fps: Float): Display.Mode? = modes.filter { it.physicalWidth==width && it.physicalHeight==height && cadenceError(it.refreshRate,fps)<0.001 }.minByOrNull { it.refreshRate }
  fun cadenceError(refresh: Float,fps: Float): Double {
    if(!refresh.isFinite() || !fps.isFinite() || fps<=0 || refresh<fps*0.999) return Double.POSITIVE_INFINITY
    val ratio=refresh.toDouble()/fps;return abs(ratio-round(ratio))/ratio
  }
}
