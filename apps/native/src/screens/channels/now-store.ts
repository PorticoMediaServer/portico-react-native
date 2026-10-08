/**
 * PERF-07: `now` as a tiny external store. Only the now-line (and its ruler tab) and one
 * `LiveProgress` child inside each on-air block subscribe; rows and programme blocks never do,
 * so a 30 s tick re-renders only those children. The store object itself is stable, so passing
 * it as a prop never invalidates a memoised row.
 *
 * Dependency-free (no React, no app imports) so node tests cover it directly.
 */
export type NowStore = Readonly<{
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => number;
  /** The current time without subscribing (for layout that must not re-render on tick). */
  get: () => number;
  dispose: () => void;
}>;

export function createNowStore(stepMs = 30_000): NowStore {
  let now = Date.now();
  const listeners = new Set<() => void>();
  const id = setInterval(() => {
    now = Date.now();
    for (const fn of [...listeners]) fn();
  }, stepMs);
  // Hermes/jest may not have `unref`; only use it when present.
  (id as unknown as {unref?: () => void}).unref?.();
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => now,
    get: () => now,
    dispose: () => clearInterval(id),
  };
}
