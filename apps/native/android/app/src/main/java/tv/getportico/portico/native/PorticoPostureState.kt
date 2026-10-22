package tv.getportico.portico.native

/** WindowMetrics bounds are screen-relative; FoldingFeature bounds are already window-relative. */
internal data class PostureRect(val left: Double, val top: Double, val right: Double, val bottom: Double) {
  fun dp(density: Double) = PostureRect(left / density, top / density, right / density, bottom / density)
}

internal data class PostureWindow(val width: Double, val height: Double)
internal data class PostureMetrics(val bounds: PostureRect, val density: Double) {
  init {
    require(density.isFinite() && density > 0)
    require(listOf(bounds.left, bounds.top, bounds.right, bounds.bottom).all { it.isFinite() })
    require(bounds.right > bounds.left && bounds.bottom > bounds.top)
  }
  fun window() = PostureWindow((bounds.right - bounds.left) / density, (bounds.bottom - bounds.top) / density)
}

internal data class PostureFold(
    val bounds: PostureRect,
    val state: String,
    val orientation: String,
    val isSeparating: Boolean,
    val occlusion: String,
) {
  fun dp(density: Double) = copy(bounds = bounds.dp(density))
}

internal data class PostureSnapshot(
    val status: String = "unavailable",
    val window: PostureWindow? = null,
    val folds: List<PostureFold> = emptyList(),
)

/** Main-thread state: an attachment token rejects late results from a paused/replaced Activity. */
internal class PorticoPostureState {
  var snapshot = PostureSnapshot(); private set
  var revision = 0L; private set
  private var attachment = 0L
  fun isCurrent(token: Long) = token == attachment

  private fun set(next: PostureSnapshot): Boolean {
    if (snapshot == next) return false
    snapshot = next
    revision++
    return true
  }

  fun begin(metrics: PostureMetrics): Long {
    attachment++
    set(PostureSnapshot("pending", metrics.window()))
    return attachment
  }

  fun available(token: Long, metrics: PostureMetrics, pixelFolds: List<PostureFold>): Boolean {
    if (token != attachment) return false
    return set(PostureSnapshot("available", metrics.window(), pixelFolds.map { it.dp(metrics.density) }))
  }

  fun clear(): Boolean {
    attachment++
    return set(PostureSnapshot())
  }
}
