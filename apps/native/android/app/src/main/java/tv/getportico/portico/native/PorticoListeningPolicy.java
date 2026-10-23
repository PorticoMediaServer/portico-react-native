package tv.getportico.portico.native;

import java.util.Map;
import java.util.Set;

/** Pure projection of the canonical listening policy. Saved music rate and
 * autoplay-next no longer exist; queue postPlay owns automatic continuation. */
public final class PorticoListeningPolicy {
  private PorticoListeningPolicy() {}
  public static boolean validPreferences(Object value, Set<Double> bookRates, Set<Double> passoutMinutes) {
    if (value == null) return true;
    if (!(value instanceof Map<?, ?> preferences)) return false;
    return member(preferences.get("bookRate"), bookRates) && member(preferences.get("passoutMinutes"), passoutMinutes);
  }
  private static boolean member(Object value, Set<Double> values) {
    return value instanceof Number number && Double.isFinite(number.doubleValue()) && values.contains(number.doubleValue());
  }
  public static boolean mayAdvance(boolean timerStopped, Map<?, ?> postPlay) {
    return !timerStopped && (postPlay == null || !Boolean.FALSE.equals(postPlay.get("autoplay")));
  }
  public static Double preferredRate(boolean audiobook, Object value) {
    if (!audiobook) return 1.0;
    if (!(value instanceof Map<?, ?> preferences) || !(preferences.get("bookRate") instanceof Number number)) return null;
    return Double.isFinite(number.doubleValue()) ? number.doubleValue() : null;
  }
}
