import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import tv.getportico.portico.policy.PorticoLocalAudioCatalogue;

public final class PorticoLocalAudioCatalogueTest {
  private record Option(Object group, int index, String format) {}
  private record Group(String id, List<String> formats) {}
  private static void check(boolean value) { if (!value) throw new AssertionError(); }
  public static void main(String[] args) {
    PorticoLocalAudioCatalogue<Option> catalogue = new PorticoLocalAudioCatalogue<>();
    Object mainGroup = new Object(), commentaryGroup = new Object();
    List<Option> tracks = List.of(new Option(mainGroup, 0, "AAC en"), new Option(commentaryGroup, 0, "AC3 en Commentary"));
    check(catalogue.replace("file-load-1", tracks));
    long first = catalogue.revision();
    check(first > 0);
    String main = catalogue.tracks().keySet().iterator().next();
    String commentary = catalogue.tracks().keySet().stream().skip(1).findFirst().orElseThrow();
    check(catalogue.find(first, main).group() == mainGroup);
    check(catalogue.find(first, commentary).group() == commentaryGroup);
    check(catalogue.find(first, "unknown") == null);
    check(catalogue.find(first + 1, commentary) == null);

    // A selected-state-only callback carries the same group/index/format inventory.
    check(!catalogue.replace("file-load-1", List.of(new Option(mainGroup, 0, "AAC en"), new Option(commentaryGroup, 0, "AC3 en Commentary"))));
    check(catalogue.revision() == first && catalogue.find(first, commentary).group() == commentaryGroup);
    // Identical labels on replacement TrackGroup objects are not permission to reuse a command.
    Object replacementGroup = new Object();
    check(catalogue.replace("file-load-1", List.of(tracks.get(0), new Option(replacementGroup, 0, "AC3 en Commentary"))));
    long replacement = catalogue.revision();
    check(replacement > first && catalogue.find(first, commentary) == null && catalogue.find(replacement, commentary) == null);
    String replacedId = catalogue.tracks().keySet().stream().skip(1).findFirst().orElseThrow();
    check(catalogue.find(replacement, replacedId).group() == replacementGroup);
    check(catalogue.replace("file-load-1", List.of(tracks.get(0), new Option(replacementGroup, 1, "AC3 en Commentary"))));
    check(catalogue.revision() > replacement && catalogue.find(replacement, replacedId) == null);

    long indexed = catalogue.revision();
    check(catalogue.replace("file-load-1", List.of(tracks.get(0), new Option(replacementGroup, 1, "EAC3 en Commentary"))));
    check(catalogue.revision() > indexed);
    long format = catalogue.revision();
    check(catalogue.replace("file-load-2", List.of(tracks.get(0), new Option(replacementGroup, 1, "EAC3 en Commentary"))));
    check(catalogue.revision() > format);
    long second = catalogue.revision();
    Map<String, Option> retired = catalogue.tracks();
    catalogue.clear();
    check(catalogue.revision() == 0 && catalogue.tracks().isEmpty());
    check(catalogue.find(second, retired.keySet().iterator().next()) == null);
    check(catalogue.replace("file-load-2", tracks));
    check(catalogue.revision() > second);
    // Exceeding the bound cannot leave a partially mapped or stale catalogue selectable.
    List<Option> tooMany = IntStream.range(0, PorticoLocalAudioCatalogue.MAX_TRACKS + 1).mapToObj(i -> new Option(mainGroup, i, "AAC")).toList();
    check(catalogue.replace("file-load-2", tooMany));
    check(catalogue.tracks().isEmpty());
    check(catalogue.replace("file-load-2", tooMany.subList(0, PorticoLocalAudioCatalogue.MAX_TRACKS)));
    check(catalogue.tracks().size() == PorticoLocalAudioCatalogue.MAX_TRACKS);
    boolean immutable = false;
    try { catalogue.tracks().clear(); } catch (UnsupportedOperationException expected) { immutable = true; }
    check(immutable);

    // Reopening the exact file creates new native objects. A unique full group/format identity
    // may restore a choice; a label, language, or ordinal alone may not.
    Group oldGroup = new Group("extractor-track-17", List.of("format-id-17:AAC:en:commentary"));
    var wanted = new PorticoLocalAudioCatalogue.Identity<>(oldGroup, 0, "format-id-17:AAC:en:commentary");
    var exact = new PorticoLocalAudioCatalogue.Identity<>(new Group("extractor-track-17", List.of("format-id-17:AAC:en:commentary")), 0, "format-id-17:AAC:en:commentary");
    var sameLanguageAndTitle = new PorticoLocalAudioCatalogue.Identity<>(new Group("extractor-track-18", List.of("format-id-18:AAC:en:commentary")), 0, "format-id-18:AAC:en:commentary");
    check(PorticoLocalAudioCatalogue.uniqueRetained(wanted, List.of(sameLanguageAndTitle, exact)) == exact);
    check(PorticoLocalAudioCatalogue.uniqueRetained(wanted, List.of(exact, sameLanguageAndTitle)) == exact);
    check(PorticoLocalAudioCatalogue.uniqueRetained(wanted, List.of(sameLanguageAndTitle)) == null);
    check(PorticoLocalAudioCatalogue.uniqueRetained(wanted, List.of(exact, exact)) == null);
    check(PorticoLocalAudioCatalogue.uniqueRetained(wanted, List.of()) == null);
    check(PorticoLocalAudioCatalogue.uniqueRetained(wanted, List.of(new PorticoLocalAudioCatalogue.Identity<>(exact.group, 1, exact.format))) == null);
    check(PorticoLocalAudioCatalogue.uniqueRetained(wanted, List.of(new PorticoLocalAudioCatalogue.Identity<>(exact.group, 0, "format-id-17:AC3:en:commentary"))) == null);
    // A changed group inventory, even with the old chosen format, is not the old exact group.
    check(PorticoLocalAudioCatalogue.uniqueRetained(wanted, List.of(new PorticoLocalAudioCatalogue.Identity<>(
        new Group("extractor-track-17", List.of(exact.format, "new-alternative")), 0, exact.format))) == null);
    check(PorticoLocalAudioCatalogue.uniqueRetained(new PorticoLocalAudioCatalogue.Identity<Group, String>(null, 0, exact.format), List.of(exact)) == null);
    check(PorticoLocalAudioCatalogue.uniqueRetained(new PorticoLocalAudioCatalogue.Identity<>(exact.group, -1, exact.format), List.of(exact)) == null);
    System.out.println("Android local audio catalogue assertions PASS; actual Media3 selection needs local validation");
  }
}
