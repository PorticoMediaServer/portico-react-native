package tv.getportico.portico.native

import org.junit.Assert.*
import org.junit.Test

class PorticoPostureStateTest {
  private val metrics = PostureMetrics(PostureRect(200.0, 100.0, 2600.0, 1900.0), 2.0)
  private fun fold(state: String = "half-opened", orientation: String = "vertical", separating: Boolean = true, occlusion: String = "full") =
      PostureFold(PostureRect(1180.0, 0.0, 1220.0, 1800.0), state, orientation, separating, occlusion)

  @Test fun windowOffsetIsRemovedFromWindowSizeButNeverSubtractedFromLocalFold() {
    val store = PorticoPostureState()
    val token = store.begin(metrics)
    assertTrue(store.available(token, metrics, listOf(fold())))
    assertEquals(PostureWindow(1200.0, 900.0), store.snapshot.window)
    assertEquals(PostureRect(590.0, 0.0, 610.0, 900.0), store.snapshot.folds.single().bounds)
  }

  @Test fun movingWindowOnScreenDoesNotMoveLocalHingeAgain() {
    val store = PorticoPostureState()
    store.available(store.begin(metrics), metrics, listOf(fold()))
    val original = store.snapshot
    val moved = metrics.copy(bounds = PostureRect(800.0, 500.0, 3200.0, 2300.0))
    store.available(store.begin(moved), moved, listOf(fold()))
    assertEquals(original, store.snapshot)
  }

  @Test fun fractionalDensityAndZeroThicknessFoldArePreserved() {
    val store = PorticoPostureState()
    val current = metrics.copy(density = 2.5)
    val fold = fold("flat", "horizontal", false, "none").copy(bounds = PostureRect(0.0, 750.0, 2400.0, 750.0))
    store.available(store.begin(current), current, listOf(fold))
    assertEquals(PostureWindow(960.0, 720.0), store.snapshot.window)
    assertEquals(PostureRect(0.0, 300.0, 960.0, 300.0), store.snapshot.folds.single().bounds)
    assertEquals("flat", store.snapshot.folds.single().state)
    assertEquals("horizontal", store.snapshot.folds.single().orientation)
    assertFalse(store.snapshot.folds.single().isSeparating)
    assertEquals("none", store.snapshot.folds.single().occlusion)
  }

  @Test fun emptyFeatureReportClearsPriorFoldWithoutInventingFlatPosture() {
    val store = PorticoPostureState()
    val token = store.begin(metrics)
    store.available(token, metrics, listOf(fold()))
    assertTrue(store.available(token, metrics, emptyList()))
    assertEquals("available", store.snapshot.status)
    assertTrue(store.snapshot.folds.isEmpty())
  }

  @Test fun changedActivityInvalidatesOldCallbackEvenWhenItsSizeIsIdentical() {
    val store = PorticoPostureState()
    val old = store.begin(metrics)
    val current = store.begin(metrics)
    assertFalse(store.available(old, metrics, listOf(fold())))
    assertEquals("pending", store.snapshot.status)
    assertTrue(store.available(current, metrics, emptyList()))
  }

  @Test fun pauseDestroyOrLastUnsubscribeClearsAndInvalidatesOutstandingCallbacks() {
    val store = PorticoPostureState()
    val old = store.begin(metrics)
    store.available(old, metrics, listOf(fold()))
    assertTrue(store.clear())
    assertEquals(PostureSnapshot(), store.snapshot)
    assertFalse(store.available(old, metrics, listOf(fold())))
    assertFalse(store.clear())
  }

  @Test fun duplicateReportsKeepRevisionAndSnapshotIdentity() {
    val store = PorticoPostureState()
    val token = store.begin(metrics)
    store.available(token, metrics, listOf(fold()))
    val old = store.snapshot
    val revision = store.revision
    assertFalse(store.available(token, metrics, listOf(fold())))
    assertSame(old, store.snapshot)
    assertEquals(revision, store.revision)
  }

  @Test fun multipleRealFeaturesAndHalfOpenedStateRemainIndependentFromWidth() {
    val store = PorticoPostureState()
    val features = listOf(fold(), fold("flat", separating = false, occlusion = "none"))
    store.available(store.begin(metrics), metrics, features)
    assertEquals(listOf("half-opened", "flat"), store.snapshot.folds.map { it.state })
    assertEquals(2, store.snapshot.folds.size)
    assertEquals(PostureWindow(1200.0, 900.0), store.snapshot.window)
  }

  @Test fun unavailableAndPendingNeverClaimNoFoldObservation() {
    val store = PorticoPostureState()
    assertEquals("unavailable", store.snapshot.status)
    assertNull(store.snapshot.window)
    store.begin(metrics)
    assertEquals("pending", store.snapshot.status)
    assertTrue(store.snapshot.folds.isEmpty())
  }

  @Test fun invalidDensityCannotCreateFabricatedCoordinates() {
    listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY).forEach { density ->
      try { metrics.copy(density = density); fail("Accepted invalid density $density") }
      catch (_: IllegalArgumentException) {}
    }
  }
}
