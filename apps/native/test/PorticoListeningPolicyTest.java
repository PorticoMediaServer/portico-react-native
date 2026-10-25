import java.util.Map;
import java.util.Set;
import tv.getportico.portico.policy.PorticoListeningPolicy;

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
    check(!PorticoListeningPolicy.validPreferences(Map.of("bookRate", 1.5, "passoutMinutes", 30, "autoplayNext", true), rates, minutes));
    check(PorticoListeningPolicy.preferredRate(false, current) == 1.0);
    check(PorticoListeningPolicy.preferredRate(false, Map.of("musicRate", 2.0)) == 1.0);
    check(PorticoListeningPolicy.preferredRate(true, current) == 1.5);
    check(PorticoListeningPolicy.preferredRate(true, Map.of("musicRate", 2.0)) == null);
    check(PorticoListeningPolicy.mayAdvance(false, null));
    check(PorticoListeningPolicy.mayAdvance(false, Map.of("autoplay", true)));
    check(!PorticoListeningPolicy.mayAdvance(false, Map.of("autoplay", false)));
    check(!PorticoListeningPolicy.mayAdvance(true, Map.of("autoplay", true)));
    check(!PorticoListeningPolicy.rateAllowed(false, 1.5, rates));
    check(PorticoListeningPolicy.rateAllowed(false, 1.0, rates));
    check(PorticoListeningPolicy.rateAllowed(true, 1.5, rates));
    Map<String,Object> book=Map.of("skipBackMs",60000,"skipForwardMs",90000,"resumeRewindMs",5000);
    check(PorticoListeningPolicy.validAudiobookPreferences(book));
    check(!PorticoListeningPolicy.validAudiobookPreferences(null));
    check(!PorticoListeningPolicy.validAudiobookPreferences(Map.of("skipBackMs",60000,"skipForwardMs",90000,"resumeRewindMs",true)));
    check(PorticoListeningPolicy.skipSeconds(true,book,false)==60 && PorticoListeningPolicy.skipSeconds(true,book,true)==90);
    check(PorticoListeningPolicy.skipSeconds(false,book,false)==30 && PorticoListeningPolicy.skipSeconds(false,book,true)==30);
    check(PorticoListeningPolicy.skipSeconds(true,null,false)==15 && PorticoListeningPolicy.skipSeconds(true,null,true)==30);
    for(double amount:new double[]{0,5000,15000,30000}) {
      check(PorticoListeningPolicy.resumeDisplacement(299,100,amount)==0);
      check(PorticoListeningPolicy.resumeDisplacement(301,100,amount)==amount/1000);
      check(PorticoListeningPolicy.resumeDisplacement(3601,100,amount)==amount/1000);
      check(PorticoListeningPolicy.resumeDisplacement(3601,2,amount)==(amount>0?2:0));
    }
    check(PorticoListeningPolicy.resumeDisplacement(3601,100,7000)==0);
    System.out.println("Android listening policy assertions PASS; no device/runtime effect claim");
  }
}
