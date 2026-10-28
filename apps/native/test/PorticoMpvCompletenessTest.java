import tv.getportico.portico.policy.PorticoMpvCompleteness;

public final class PorticoMpvCompletenessTest {
  private static void check(boolean value) { if (!value) throw new AssertionError(); }
  public static void main(String[] args) {
    PorticoMpvCompleteness<String> evidence = new PorticoMpvCompleteness<>();
    long first = evidence.reset();
    // There is no wall-clock deadline: draining a large mpv cache cannot erase a missing tail.
    evidence.failed(first, "stream", "bytes=0-", 100L, 1000L, "truncated body");
    check("truncated body".equals(evidence.unresolved()));
    evidence.completed(first, "subtitle", null, 0L, 200L, true);
    evidence.completed(first, "other-segment", null, 0L, 400L, true);
    check("truncated body".equals(evidence.unresolved()));
    // Reading a prefix again is not a successful continuation past the failed offset.
    evidence.completed(first, "stream", "bytes=0-99", 0L, 100L, false);
    check(evidence.unresolved() != null);
    evidence.completed(first, "stream", "bytes=100-499", 100L, 500L, false);
    check(evidence.unresolved() != null);
    evidence.completed(first, "stream", "bytes=500-", 500L, 1000L, true);
    check(evidence.unresolved() == null);

    // Concurrent continuations may complete out of order, including a middle range.
    evidence.failed(first, "stream", null, 0L, 1000L, "another gap");
    evidence.completed(first, "stream", "bytes=200-799", 200L, 800L, false);
    evidence.completed(first, "stream", "bytes=800-", 800L, 1000L, true);
    check(evidence.unresolved() != null);
    evidence.completed(first, "stream", "bytes=0-199", 0L, 200L, false);
    check(evidence.unresolved() == null);

    // A successful full response repairs an earlier failed open-ended request.
    evidence.failed(first, "stream", "bytes=100-", 100L, null, "unanswered range");
    evidence.completed(first, "stream", "bytes=100-199", 100L, 200L, false);
    check(evidence.unresolved() != null);
    evidence.completed(first, "stream", null, 0L, 1000L, true);
    check(evidence.unresolved() == null);

    evidence.failed(first, "stream", "bytes=-100", null, null, "unknown suffix offset");
    evidence.completed(first, "stream", "bytes=0-99", 0L, 100L, false);
    check(evidence.unresolved() != null);
    evidence.completed(first, "stream", "bytes=-100", 900L, 1000L, true);
    check(evidence.unresolved() == null);

    // Unrelated failures are retained independently; fixing the newest does not fix the oldest.
    evidence.failed(first, "segment-a", null, 20L, 100L, "a");
    evidence.failed(first, "segment-b", null, 30L, 200L, "b");
    evidence.completed(first, "segment-b", null, 0L, 200L, true);
    check("a".equals(evidence.unresolved()));
    evidence.completed(first, "segment-a", null, 0L, 100L, true);
    check(evidence.unresolved() == null);

    evidence.failed(first, "stream", null, 0L, null, "old source");
    long second = evidence.reset();
    check(evidence.unresolved() == null);
    evidence.failed(first, "stream", null, 0L, null, "late old callback");
    check(evidence.unresolved() == null);
    evidence.failed(second, "stream", null, 0L, null, "new source");
    evidence.completed(first, "stream", null, 0L, 1000L, true);
    check("new source".equals(evidence.unresolved()));
    evidence.completed(second, "stream", null, 0L, 1000L, true);
    check(evidence.unresolved() == null);

    // Memory stays bounded without treating overflow as successful delivery.
    for (int i = 0; i < 80; i++) evidence.failed(second, "segment-" + i, null, 0L, 100L, "gap-" + i);
    for (int i = 0; i < 80; i++) evidence.completed(second, "segment-" + i, null, 0L, 100L, true);
    check(evidence.unresolved() != null);
    evidence.reset();
    check(evidence.unresolved() == null);
    System.out.println("Android mpv completeness assertions PASS; no device/network effect claim");
  }
}
