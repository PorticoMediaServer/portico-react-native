import java.util.Map;
import java.util.Set;
import tv.getportico.portico.native.PorticoListeningPolicy;

public final class PorticoListeningPolicyTest {
  private static void check(boolean value) {if (!value) throw new AssertionError();}
  public static void main(String[] args) {
    Set<Double> rates = Set.of(1.0, 1.5, 2.0), minutes = Set.of(0.0, 30.0, 60.0);
    Map<String, Object> current = Map.of("bookRate", 1.5, "passoutMinutes", 30);
    check(PorticoListeningPolicy.validPreferences(current, rates, minutes));
    check(PorticoListeningPolicy.validPreferences(null, rates, minutes));
    check(!PorticoListeningPolicy.validPreferences(Map.of("bookRate", 1.5), rates, minutes));
    check(!PorticoListeningPolicy.validPreferences(Map.of("bookRate", Double.NaN, "passoutMinutes", 0), rates, minutes));
    check(!PorticoListeningPolicy.validPreferences(Map.of("bookRate", 9, "passoutMinutes", 0), rates, minutes));
    check(PorticoListeningPolicy.preferredRate(false, current) == 1.0);
    check(PorticoListeningPolicy.preferredRate(false, Map.of("musicRate", 2.0)) == 1.0);
    check(PorticoListeningPolicy.preferredRate(true, current) == 1.5);
    check(PorticoListeningPolicy.preferredRate(true, Map.of("musicRate", 2.0)) == null);
    check(PorticoListeningPolicy.mayAdvance(false, null));
    check(PorticoListeningPolicy.mayAdvance(false, Map.of("autoplay", true)));
    check(!PorticoListeningPolicy.mayAdvance(false, Map.of("autoplay", false)));
    check(!PorticoListeningPolicy.mayAdvance(true, Map.of("autoplay", true)));
    System.out.println("13 Android listening policy assertions PASS; no device/runtime effect claim");
  }
}
